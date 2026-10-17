/* ============================================================
   qeep revival v2 - server
   Zero required dependencies. Run:  node server.js
   Optional: set DATABASE_URL to persist to Postgres instead of a file.
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');

const store = require('./lib/store');
const world = require('./lib/world');
const games = require('./lib/games');
const C = require('./lib/content');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ------------------------------- realtime ------------------------------- */

const streams = new Map();     // token -> Set<res>
const botTimers = new Map();   // "matchId:seat" -> timeout

function push(token, event) {
  const set = streams.get(token);
  if (!set) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of set) { try { res.write(data); } catch (_) {} }
}
world.setPush(push);

function onlineCount() { let n = 0; for (const [, s] of streams) if (s.size) n++; return n; }

/* ------------------------------- matches ------------------------------- */

const queues = {};
const matches = new Map();     // matchId -> match
const matchById = (id) => matches.get(id) || null;

function persist() { store.scheduleSave(() => world.snapshot()); }

function newSeat(p) { return { token: p.token, nick: p.nick, avatar: p.avatar, mark: null, bot: false }; }
function botSeat() {
  const names = ['QeepBot', 'NokiaFan', 'S60Legend', 'SnakeKing', 'GprsGuru', 'BsnlBoi', 'WapWizard', 'EdgeEnjoyer'];
  return { token: 'bot_' + Math.random().toString(36).slice(2), nick: names[Math.floor(Math.random() * names.length)], avatar: 1 + Math.floor(Math.random() * 8), mark: null, bot: true };
}

function pushMatch(m) {
  const view = games.matchView(m);
  for (const seat of m.seats) if (!seat.bot) push(seat.token, { type: 'matchUpdate', match: view });
}

function afterChange(m, wasPlaying) {
  if (wasPlaying && m.status === 'finished') world.rewardGame(m);
  pushMatch(m);
  scheduleBots(m);
  persist();
}

function scheduleBots(m) {
  if (m.status !== 'playing') return;
  for (const si of games.botSeats(m)) {
    const key = m.id + ':' + si;
    if (botTimers.has(key)) continue;
    botTimers.set(key, setTimeout(() => {
      botTimers.delete(key);
      if (m.status !== 'playing') return;
      const wasPlaying = m.status === 'playing';
      const mv = games.botMove(m, si);
      let r = games.applyMove(m, si, mv);
      if (r.error) {
        // safety net: never leave a game stuck
        const fb = games.fallbackMove(m, si);
        if (fb != null) r = games.applyMove(m, si, fb);
        if (r.error) console.warn('[bot] unrecoverable move', m.game, r.error);
      }
      afterChange(m, wasPlaying);
    }, 700 + Math.random() * 900));
  }
}

function startMatch(game, a, b) {
  const m = games.createMatch(game, a, b);
  matches.set(m.id, m);
  for (const seat of m.seats) if (!seat.bot) push(seat.token, { type: 'matchUpdate', match: games.matchView(m), matched: true });
  scheduleBots(m);
  persist();
  return m;
}

function cancelQueue(game, token) {
  const q = queues[game] || (queues[game] = []);
  for (let i = q.length - 1; i >= 0; i--) if (q[i] === token) q.splice(i, 1);
  const p = world.get(token);
  if (p && p.botTimers && p.botTimers[game]) { clearTimeout(p.botTimers[game]); delete p.botTimers[game]; }
}

function enqueue(game, player) {
  const q = queues[game] || (queues[game] = []);
  const oppTok = q.find((t) => t !== player.token && world.get(t));
  if (oppTok) {
    cancelQueue(game, player.token); cancelQueue(game, oppTok);
    const b = world.get(oppTok);
    const first = Math.random() < 0.5 ? player : b;
    const second = first === player ? b : player;
    return startMatch(game, newSeat(first), newSeat(second));
  }
  cancelQueue(game, player.token);
  q.push(player.token);
  if (!player.botTimers) player.botTimers = {};
  player.botTimers[game] = setTimeout(() => {
    const idx = q.indexOf(player.token);
    if (idx === -1) return;
    q.splice(idx, 1);
    const p = world.get(player.token);
    if (!p) return;
    const human = newSeat(p), bot = botSeat();
    const botFirst = Math.random() < 0.5;
    startMatch(game, botFirst ? bot : human, botFirst ? human : bot);
  }, 9000);
  return null;
}

/* ------------------------------- chat helpers ------------------------------- */

const chatTimes = new Map(); // token -> [timestamps]
function rateLimited(token) {
  const t = Date.now();
  const arr = (chatTimes.get(token) || []).filter((x) => t - x < 6000);
  if (arr.length >= 8) { chatTimes.set(token, arr); return true; }
  arr.push(t); chatTimes.set(token, arr); return false;
}

function decorate(text) {
  let out = String(text);
  for (const [k, v] of Object.entries(C.EMOTICONS)) out = out.split(k).join(v);
  return out;
}

function handleCommand(player, roomId, text) {
  const [cmd, ...rest] = text.slice(1).split(' ');
  const arg = rest.join(' ');
  if (cmd === 'me' && arg) { world.postChat(roomId, player, `* ${player.nick} ${arg} *`, false); return true; }
  if (cmd === 'roll') { const n = 1 + Math.floor(Math.random() * 100); world.postChat(roomId, player, `* ${player.nick} rolls a ${n} (1-100) *`, false); return true; }
  if (cmd === 'help') {
    push(player.token, { type: 'info', title: 'Commands', lines: ['/me <action> - emote', '/roll - roll a dice', '/help - this list'] });
    return true;
  }
  return false;
}

/* ------------------------------- http helpers ------------------------------- */

function send(res, code, type, body) {
  const payload = Buffer.isBuffer(body) ? body : (typeof body === 'string' ? body : JSON.stringify(body ?? {}));
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(payload);
}
const json = (res, code, body) => send(res, code, 'application/json; charset=utf-8', body);

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
  });
}

function auth(req, body) {
  const token = body.token || new URL(req.url, 'http://x').searchParams.get('token');
  const p = world.get(token);
  if (p) world.touch(p);
  return p;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[\\/])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'text/plain', 'Forbidden');
  fs.readFile(filePath, (err, buf) => {
    if (err) return send(res, 404, 'text/plain', 'Not found');
    send(res, 200, MIME[path.extname(filePath)] || 'application/octet-stream', buf);
  });
}

/* ------------------------------- routes ------------------------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const POST = req.method === 'POST';

  try {
    /* ---------- public data ---------- */
    if (req.method === 'GET' && p === '/health') return json(res, 200, { ok: true, online: onlineCount(), uptime: Math.round(process.uptime()) });
    if (req.method === 'GET' && p === '/api/stats') return json(res, 200, { ...world.stats(), online: onlineCount(), store: store.info().mode });
    if (req.method === 'GET' && p === '/api/games') return json(res, 200, { games: games.meta() });
    if (req.method === 'GET' && p === '/api/content') {
      return json(res, 200, { avatars: C.AVATARS, titles: C.TITLES, badges: C.BADGES, shop: C.SHOP, rooms: Object.values(world.rooms).map((r) => ({ id: r.id, name: r.name, topic: r.topic })) });
    }
    if (req.method === 'GET' && p === '/api/shop') return json(res, 200, { shop: C.SHOP });
    if (req.method === 'GET' && p === '/api/leaderboard') return json(res, 200, { board: url.searchParams.get('board') || 'wins', top: world.leaderboard(url.searchParams.get('board') || 'wins'), online: onlineCount() });
    if (req.method === 'GET' && p === '/api/rooms') {
      return json(res, 200, { rooms: Object.values(world.rooms).map((r) => ({ id: r.id, name: r.name, topic: r.topic, last: r.messages.at(-1) || null })), online: onlineCount() });
    }

    /* ---------- realtime ---------- */
    if (req.method === 'GET' && p === '/events') {
      const token = url.searchParams.get('token');
      const player = world.get(token);
      if (!player) return send(res, 401, 'text/plain', 'unknown player');
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n');
      if (!streams.has(token)) streams.set(token, new Set());
      streams.get(token).add(res);
      const wasOffline = !player.online;
      player.online = true;
      push(token, { type: 'hello', online: onlineCount(), serverTime: Date.now() });
      if (wasOffline) for (const f of player.friends) push(f, { type: 'presence', token, online: true });
      const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);
      req.on('close', () => {
        clearInterval(beat);
        const set = streams.get(token);
        if (set) { set.delete(res); if (!set.size) { streams.delete(token); player.online = false; for (const f of player.friends) push(f, { type: 'presence', token, online: false }); } }
      });
      return;
    }

    /* ---------- session ---------- */
    if (POST && p === '/api/join') {
      const body = await readBody(req);
      let player = auth(req, body);
      if (!player) {
        if (body.token && !String(body.nick || '').trim()) return json(res, 200, { stale: true });
        player = world.makePlayer(body.nick);
        world.postChat('lobby', player, `${player.nick} just joined qeep`, true);
        persist();
      }
      return json(res, 200, { player: world.publicProfile(player), rooms: Object.values(world.rooms).map((r) => ({ id: r.id, name: r.name, topic: r.topic })), online: onlineCount(), unreadDm: world.unreadCount(player.token) });
    }

    if (POST && p === '/api/state') {
      const body = await readBody(req);
      const player = auth(req, body);
      if (!player) return json(res, 401, { error: 'no session' });
      return json(res, 200, {
        player: world.publicProfile(player),
        rooms: Object.values(world.rooms).map((r) => ({ id: r.id, name: r.name, topic: r.topic, last: r.messages.at(-1) || null })),
        threads: world.dmThreads(player.token),
        unreadDm: world.unreadCount(player.token),
        online: onlineCount(),
      });
    }

    /* ---------- chat ---------- */
    if (POST && p === '/api/history') {
      const body = await readBody(req);
      const player = auth(req, body);
      if (!player) return json(res, 401, { error: 'no session' });
      const room = world.rooms[body.room] || world.rooms.lobby;
      return json(res, 200, { room: room.id, messages: room.messages });
    }

    if (POST && p === '/api/chat') {
      const body = await readBody(req);
      const player = auth(req, body);
      if (!player) return json(res, 401, { error: 'no session' });
      const text = String(body.text || '').trim();
      if (!text) return json(res, 200, { ok: true });
      if (rateLimited(player.token)) return json(res, 429, { error: 'Slow down a little!' });
      if (text.startsWith('/') && handleCommand(player, body.room, text)) return json(res, 200, { ok: true });
      const msg = world.postChat(body.room, player, decorate(text), false);
      persist();
      return json(res, 200, { ok: true, msg });
    }

    /* ---------- direct messages ---------- */
    if (POST && p === '/api/dm/history') {
      const body = await readBody(req);
      const player = auth(req, body);
      if (!player) return json(res, 401, { error: 'no session' });
      const other = world.get(body.with);
      if (!other) return json(res, 404, { error: 'No such player' });
      world.markDMRead(player.token, other.token);
      persist();
      return json(res, 200, { with: { token: other.token, nick: other.nick, avatar: other.avatar, level: other.level, online: other.online }, messages: world.dmHistory(player.token, other.token) });
    }

    if (POST && p === '/api/dm') {
      const body = await readBody(req);
      const player = auth(req, body);
      if (!player) return json(res, 401, { error: 'no session' });
      const text = String(body.text || '').trim();
      if (!text) return json(res, 200, { ok: true });
      if (rateLimited(player.token)) return json(res, 429, { error: 'Slow down a little!' });
      const r = world.sendDM(player, body.to, decorate(text));
      if (r.error) return json(res, 400, r);
      persist();
      return json(res, 200, r);
    }

    /* ---------- profile / economy ---------- */
    if (POST && p === '/api/profile') {
      const body = await readBody(req);
      const player = auth(req, body);
      if (!player) return json(res, 401, { error: 'no session' });
      const r = world.updateProfile(player, body.patch || {});
      if (r.error) return json(res, 400, r);
      persist();
      return json(res, 200, { ok: true, profile: world.publicProfile(player) });
    }

    if (POST && p === '/api/shop/buy') {
      const body = await readBody(req);
      const player = auth(req, body);
      if (!player) return json(res, 401, { error: 'no session' });
      const r = world.buy(player, body.item);
      if (r.error) return json(res, 400, r);
      persist();
      return json(res, 200, { ok: true, profile: world.publicProfile(player) });
    }

    if (POST && p === '/api/daily') {
      const body = await readBody(req);
      const player = auth(req, body);
      if (!player) return json(res, 401, { error: 'no session' });
      const r = world.claimDaily(player);
      if (r.error) return json(res, 400, r);
      persist();
      return json(res, 200, { ...r, profile: world.publicProfile(player) });
    }

    /* ---------- friends ---------- */
    if (POST && p === '/api/friend/request') {
      const body = await readBody(req);
      const player = auth(req, body);
      if (!player) return json(res, 401, { error: 'no session' });
      const target = (body.target ? world.get(body.target) : null) || world.findByNick(body.nick);
      const r = world.friendRequest(player, target);
      if (r.error) return json(res, 400, r);
      persist();
      return json(res, 200, { ok: true, profile: world.publicProfile(player) });
    }

    if (POST && p === '/api/friend/accept') {
      const body = await readBody(req);
      const player = auth(req, body);
      if (!player) return json(res, 401, { error: 'no session' });
      const target = world.get(body.target);
      if (!target) return json(res, 404, { error: 'No such player' });
      const r = world.friendAccept(player, target);
      if (r.error) return json(res, 400, r);
      persist();
      return json(res, 200, { ok: true, profile: world.publicProfile(player) });
    }

    if (POST && p === '/api/friend/remove') {
      const body = await readBody(req);
      const player = auth(req, body);
      if (!player) return json(res, 401, { error: 'no session' });
      world.friendRemove(player, body.target);
      persist();
      return json(res, 200, { ok: true, profile: world.publicProfile(player) });
    }

    if (POST && p === '/api/gift') {
      const body = await readBody(req);
      const player = auth(req, body);
      if (!player) return json(res, 401, { error: 'no session' });
      const target = world.get(body.to) || world.findByNick(body.nick);
      if (!target) return json(res, 404, { error: 'No such player' });
      const r = world.gift(player, target.token, body.amount);
      if (r.error) return json(res, 400, r);
      persist();
      return json(res, 200, { ok: true, profile: world.publicProfile(player) });
    }

    if (POST && p === '/api/players/find') {
      const body = await readBody(req);
      const player = auth(req, body);
      if (!player) return json(res, 401, { error: 'no session' });
      const target = world.findByNick(body.nick);
      if (!target) return json(res, 404, { error: 'No player called "' + String(body.nick || '').slice(0, 16) + '"' });
      return json(res, 200, { player: { token: target.token, nick: target.nick, avatar: target.avatar, level: target.level, online: target.online, bio: target.bio } });
    }

    /* ---------- games ---------- */
    if (POST && p === '/api/queue') {
      const body = await readBody(req);
      const player = auth(req, body);
      if (!player) return json(res, 401, { error: 'no session' });
      const game = games.isValidGame(body.game) ? body.game : 'tictactoe';
      const m = enqueue(game, player);
      return json(res, 200, { queued: !m, match: m ? games.matchView(m) : null });
    }

    if (POST && p === '/api/cancel') {
      const body = await readBody(req);
      const player = auth(req, body);
      if (!player) return json(res, 401, { error: 'no session' });
      cancelQueue(games.isValidGame(body.game) ? body.game : 'tictactoe', player.token);
      return json(res, 200, { ok: true });
    }

    if (POST && p === '/api/move') {
      const body = await readBody(req);
      const player = auth(req, body);
      if (!player) return json(res, 401, { error: 'no session' });
      const m = matchById(body.matchId);
      if (!m) return json(res, 404, { error: 'No such match' });
      const si = m.seats.findIndex((s) => !s.bot && s.token === player.token);
      if (si === -1) return json(res, 403, { error: 'Not a player here' });
      const wasPlaying = m.status === 'playing';
      const r = games.applyMove(m, si, body.move);
      if (r.error) return json(res, 400, { error: r.error });
      afterChange(m, wasPlaying);
      return json(res, 200, { ok: true, match: games.matchView(m) });
    }

    if (POST && p === '/api/resign') {
      const body = await readBody(req);
      const player = auth(req, body);
      if (!player) return json(res, 401, { error: 'no session' });
      const m = matchById(body.matchId);
      if (!m) return json(res, 404, { error: 'No such match' });
      const si = m.seats.findIndex((s) => !s.bot && s.token === player.token);
      if (si === -1) return json(res, 403, { error: 'Not a player here' });
      if (m.status === 'playing') {
        m.status = 'finished';
        m.winner = m.seats[1 - si].mark;
        const wasPlaying = true;
        afterChange(m, wasPlaying);
      }
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET') return serveStatic(req, res, p);
    return send(res, 405, 'text/plain', 'Method not allowed');
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: 'server error' });
  }
});

/* ------------------------------- boot ------------------------------- */

(async () => {
  await store.init();
  const data = await store.load();
  if (world.hydrate(data)) console.log('[store] loaded saved world');
  for (const game of ['tictactoe', 'connect4', 'reversi', 'nim', 'rps', 'quiz']) queues[game] = [];
  // prune finished matches occasionally
  setInterval(() => { const cut = Date.now() - 1000 * 60 * 30; for (const [id, m] of matches) if (m.status === 'finished' && m.createdAt < cut) matches.delete(id); }, 60000).unref?.();

  server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  ============================================');
    console.log('   qeep revival v2 is online');
    console.log(`   http://localhost:${PORT}`);
    console.log(`   storage: ${store.info().mode}`);
    console.log('  ============================================');
    console.log('');
  });
})();

async function shutdown() {
  console.log('\n[qeep] saving and shutting down...');
  try { await store.flushNow(() => world.snapshot()); } catch (_) {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
