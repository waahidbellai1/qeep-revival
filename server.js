/*
 * qeep revival - tiny multiplayer server
 * Zero dependencies. Just run:  node server.js
 *
 * Serves the retro phone UI from /public and provides:
 *   - nickname login + profiles + coins
 *   - realtime global chat (Server-Sent Events)
 *   - turn-based multiplayer games (Tic-Tac-Toe, Connect Four)
 *   - a friendly bot opponent if nobody else is around
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ------------------------------------------------------------------ *
 *  In-memory world state (resets when the server restarts)
 * ------------------------------------------------------------------ */

const players = new Map();      // token -> player object
const streams = new Map();      // token -> Set<res>  (open SSE connections)
const matches = new Map();      // matchId -> match object
const queues = { tictactoe: [], connect4: [] };
const botTimers = new Map();    // matchId -> timeout handle

const ROOM_NAMES = { lobby: 'The Lobby', sayhi: 'Say Hi', gamers: 'Game Central' };
const rooms = {};
for (const id of Object.keys(ROOM_NAMES)) {
  rooms[id] = { id, name: ROOM_NAMES[id], messages: [] };
}
const CHAT_LIMIT = 60;

const BOT_NAMES = ['QeepBot', 'NokiaFan', 'S60Legend', 'SnakeKing', 'GprsGuru', 'BsnlBoi'];

function uid() { return crypto.randomBytes(9).toString('hex'); }
function now() { return Date.now(); }

function makePlayer(nick) {
  const p = {
    token: uid(),
    nick: String(nick || 'guest').slice(0, 14).replace(/[^\w \-]/g, '') || 'guest',
    coins: 100,
    wins: 0,
    losses: 0,
    draws: 0,
    avatar: 1 + Math.floor(Math.random() * 8),
    created: now(),
    lastSeen: now(),
  };
  players.set(p.token, p);
  return p;
}

function publicProfile(p) {
  if (!p) return null;
  return {
    token: p.token, nick: p.nick, coins: p.coins,
    wins: p.wins, losses: p.losses, draws: p.draws, avatar: p.avatar,
  };
}

function send(res, code, type, body) {
  const payload = Buffer.isBuffer(body) ? body
    : (typeof body === 'string' ? body : JSON.stringify(body ?? {}));
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(payload);
}

function json(res, code, body) { send(res, code, 'application/json', body); }

/* ------------------------------------------------------------------ *
 *  Realtime push (SSE)
 * ------------------------------------------------------------------ */

function push(token, event) {
  const set = streams.get(token);
  if (!set) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of set) {
    try { res.write(data); } catch (_) { /* dropped connection */ }
  }
}

function broadcastRoom(roomId, event) {
  for (const [token] of streams) push(token, event);
  void roomId;
}

function onlineCount() {
  let n = 0;
  for (const [, set] of streams) if (set.size) n++;
  return n;
}

/* ------------------------------------------------------------------ *
 *  Chat
 * ------------------------------------------------------------------ */

function postChat(roomId, player, text, system) {
  const room = rooms[roomId] || rooms.lobby;
  const msg = {
    id: uid(),
    room: room.id,
    from: system ? null : player.token,
    nick: system ? 'system' : player.nick,
    avatar: system ? 0 : player.avatar,
    text: String(text).slice(0, 160),
    system: !!system,
    at: now(),
  };
  room.messages.push(msg);
  if (room.messages.length > CHAT_LIMIT) room.messages.shift();
  broadcastRoom(room.id, { type: 'chat', room: room.id, msg });
  return msg;
}

/* ------------------------------------------------------------------ *
 *  Games
 * ------------------------------------------------------------------ */

function makeTicTacToe(a, b) {
  return {
    id: uid(), game: 'tictactoe', status: 'playing',
    board: Array(9).fill(null),
    seats: [a, b], turn: 0, winner: null, line: null,
    createdAt: now(),
  };
}

function makeConnect4(a, b) {
  // board stored as 7 columns of 6 cells (bottom-up)
  return {
    id: uid(), game: 'connect4', status: 'playing',
    board: Array.from({ length: 7 }, () => []),
    seats: [a, b], turn: 0, winner: null, line: null,
    createdAt: now(),
  };
}

function seatView(seat) {
  return {
    token: seat.token, nick: seat.nick, avatar: seat.avatar,
    bot: !!seat.bot, mark: seat.mark,
  };
}

function matchView(m) {
  return {
    id: m.id, game: m.game, status: m.status, board: m.board,
    turn: m.turn, winner: m.winner, line: m.line,
    seats: m.seats.map(seatView),
  };
}

function pushMatch(m, extra = {}) {
  for (const seat of m.seats) {
    if (seat.bot) continue;
    push(seat.token, { type: 'matchUpdate', match: matchView(m), ...extra });
  }
}

function newSeat(token, nick, avatar, mark, bot) {
  return { token, nick, avatar, mark, bot: !!bot };
}

function botSeat(mark) {
  const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
  return newSeat('bot_' + uid(), name, 1 + Math.floor(Math.random() * 8), mark, true);
}

function startMatch(game, a, b) {
  let m;
  if (game === 'tictactoe') { a.mark = 'X'; b.mark = 'O'; m = makeTicTacToe(a, b); }
  else { a.mark = 'R'; b.mark = 'Y'; m = makeConnect4(a, b); }
  matches.set(m.id, m);
  pushMatch(m, { matched: true });
  scheduleBotIfNeeded(m);
  return m;
}

function enqueue(game, player) {
  const q = queues[game];
  const opponent = q.find((t) => t !== player.token && players.has(t));
  if (opponent) {
    queues[game] = q.filter((t) => t !== player.token && t !== opponent);
    cancelQueue(game, player.token);
    cancelQueue(game, opponent);
    const b = players.get(opponent);
    const first = Math.random() < 0.5 ? player : b;   // randomize who goes first
    const second = first === player ? b : player;
    return startMatch(game, newSeat(first.token, first.nick, first.avatar), newSeat(second.token, second.nick, second.avatar));
  }

  // nobody around yet -> wait, then pit the player against a friendly bot
  cancelQueue(game, player.token);
  if (!q.includes(player.token)) q.push(player.token);
  if (!player.botTimers) player.botTimers = {};
  player.botTimers[game] = setTimeout(() => {
    const idx = queues[game].indexOf(player.token);
    if (idx === -1) return; // already matched with a human
    queues[game].splice(idx, 1);
    const p = players.get(player.token);
    if (!p) return;
    const human = newSeat(p.token, p.nick, p.avatar);
    const bot = botSeat('X');
    const botFirst = Math.random() < 0.5;
    startMatch(game, botFirst ? bot : human, botFirst ? human : bot);
  }, 9000);
  return null;
}

function cancelQueue(game, token) {
  const q = queues[game];
  for (let i = q.length - 1; i >= 0; i--) if (q[i] === token) q.splice(i, 1);
  const p = players.get(token);
  if (p && p.botTimers && p.botTimers[game]) { clearTimeout(p.botTimers[game]); delete p.botTimers[game]; }
}

/* -- win detection ------------------------------------------------- */

const TT_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
function ttWinner(b) {
  for (const [x, y, z] of TT_LINES) {
    if (b[x] && b[x] === b[y] && b[y] === b[z]) return { mark: b[x], line: [x, y, z] };
  }
  return b.every(Boolean) ? { mark: 'draw', line: null } : null;
}

function c4Winner(cols) {
  const grid = Array.from({ length: 6 }, () => Array(7).fill(null));
  cols.forEach((col, c) => col.forEach((cell, r) => { grid[r][c] = cell; }));
  const dirs = [[1,0],[0,1],[1,1],[1,-1]];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) {
    const v = grid[r][c];
    if (!v) continue;
    for (const [dc, dr] of dirs) {
      const cells = [[r, c]];
      for (let k = 1; k < 4; k++) {
        const rr = r + dr * k, cc = c + dc * k;
        if (rr < 0 || rr > 5 || cc < 0 || cc > 6 || grid[rr][cc] !== v) { cells.length = 0; break; }
        cells.push([rr, cc]);
      }
      if (cells.length === 4) return { mark: v, line: cells };
    }
  }
  return cols.every((col) => col.length === 6) ? { mark: 'draw', line: null } : null;
}

/* -- move application ---------------------------------------------- */

function applyMove(m, seatIndex, move) {
  if (m.status !== 'playing') return { error: 'Game is over' };
  if (m.turn !== seatIndex) return { error: 'Not your turn' };
  const mark = m.seats[seatIndex].mark;

  if (m.game === 'tictactoe') {
    const i = Number(move);
    if (!Number.isInteger(i) || i < 0 || i > 8) return { error: 'Bad square' };
    if (m.board[i]) return { error: 'Square taken' };
    m.board[i] = mark;
    const w = ttWinner(m.board);
    if (w) finish(m, w.mark === 'draw' ? null : w.mark, w.line);
  } else {
    const c = Number(move);
    if (!Number.isInteger(c) || c < 0 || c > 6) return { error: 'Bad column' };
    if (m.board[c].length >= 6) return { error: 'Column full' };
    m.board[c].push(mark);
    const w = c4Winner(m.board);
    if (w) finish(m, w.mark === 'draw' ? null : w.mark, w.line);
  }

  if (m.status === 'playing') m.turn = 1 - m.turn;
  return { ok: true };
}

function finish(m, winMark, line) {
  m.status = 'finished';
  m.winner = winMark;
  m.line = line;
  const botTimer = botTimers.get(m.id);
  if (botTimer) { clearTimeout(botTimer); botTimers.delete(m.id); }

  m.seats.forEach((seat, i) => {
    if (seat.bot) return;
    const p = players.get(seat.token);
    if (!p) return;
    if (winMark === null) { p.draws++; p.coins += 5; }
    else if (seat.mark === winMark) { p.wins++; p.coins += 25; }
    else { p.losses++; p.coins += 5; }
    push(seat.token, { type: 'profile', profile: publicProfile(p) });
  });
}

/* -- bot brain ----------------------------------------------------- */

function botChooseMove(m) {
  if (m.game === 'tictactoe') {
    const empty = m.board.map((v, i) => (v ? null : i)).filter((v) => v !== null);
    const mark = m.seats[m.turn].mark;
    const foe = mark === 'X' ? 'O' : 'X';
    const wouldWin = (idx, who) => {
      const copy = m.board.slice(); copy[idx] = who;
      return ttWinner(copy) && ttWinner(copy).mark === who;
    };
    for (const i of empty) if (wouldWin(i, mark)) return i;
    for (const i of empty) if (wouldWin(i, foe)) return i;
    if (empty.includes(4)) return 4;
    const corners = [0, 2, 6, 8].filter((i) => empty.includes(i));
    if (corners.length && Math.random() < 0.8) return corners[Math.floor(Math.random() * corners.length)];
    return empty[Math.floor(Math.random() * empty.length)];
  }
  // connect four: win, block, else prefer center
  const legal = [];
  for (let c = 0; c < 7; c++) if (m.board[c].length < 6) legal.push(c);
  const mark = m.seats[m.turn].mark;
  const foe = mark === 'R' ? 'Y' : 'R';
  const tryDrop = (c, who) => {
    const copy = m.board.map((col) => col.slice());
    copy[c].push(who);
    const w = c4Winner(copy);
    return w && w.mark === who;
  };
  for (const c of legal) if (tryDrop(c, mark)) return c;
  for (const c of legal) if (tryDrop(c, foe)) return c;
  const order = [3, 2, 4, 1, 5, 0, 6].filter((c) => legal.includes(c));
  return order[0];
}

function scheduleBotIfNeeded(m) {
  if (m.status !== 'playing') return;
  const seat = m.seats[m.turn];
  if (!seat || !seat.bot) return;
  const delay = 700 + Math.random() * 900;
  const t = setTimeout(() => {
    botTimers.delete(m.id);
    if (m.status !== 'playing') return;
    const mv = botChooseMove(m);
    applyMove(m, m.turn, mv);
    pushMatch(m);
    scheduleBotIfNeeded(m);
  }, delay);
  botTimers.set(m.id, t);
}

/* ------------------------------------------------------------------ *
 *  HTTP handling
 * ------------------------------------------------------------------ */

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });
}

function auth(req, body) {
  const token = body.token || new URL(req.url, 'http://x').searchParams.get('token');
  const p = players.get(token);
  if (p) p.lastSeen = now();
  return p;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  try {
    if (req.method === 'GET' && p === '/health') {
      return json(res, 200, { ok: true, online: onlineCount(), matches: matches.size, uptime: Math.round(process.uptime()) });
    }

    if (req.method === 'GET' && p === '/api/rooms') {
      return json(res, 200, {
        rooms: Object.values(rooms).map((r) => ({ id: r.id, name: r.name, last: r.messages.at(-1) || null })),
        online: onlineCount(),
      });
    }

    if (req.method === 'GET' && p === '/api/leaderboard') {
      const top = [...players.values()].sort((a, b) => b.wins - a.wins || b.coins - a.coins).slice(0, 10);
      return json(res, 200, { top: top.map(publicProfile), online: onlineCount() });
    }

    if (req.method === 'GET' && p === '/events') {
      const token = url.searchParams.get('token');
      if (!players.has(token)) return send(res, 401, 'text/plain', 'unknown player');
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`retry: 2000\n\n`);
      if (!streams.has(token)) streams.set(token, new Set());
      streams.get(token).add(res);
      push(token, { type: 'hello', online: onlineCount() });

      const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);
      req.on('close', () => {
        clearInterval(beat);
        const set = streams.get(token);
        if (set) { set.delete(res); if (!set.size) streams.delete(token); }
      });
      return;
    }

    if (req.method === 'POST' && p === '/api/join') {
      const body = await readBody(req);
      let player = auth(req, body);
      if (!player) {
        // A token that no longer exists (e.g. server restarted) with no nickname to create one.
        if (body.token && !String(body.nick || '').trim()) return json(res, 200, { stale: true });
        player = makePlayer(body.nick);
        postChat('lobby', player, `${player.nick} just joined qeep`, true);
      } else if (body.nick) {
        player.nick = String(body.nick).slice(0, 14).replace(/[^\w \-]/g, '') || player.nick;
      }
      return json(res, 200, {
        player: publicProfile(player),
        rooms: Object.values(rooms).map((r) => ({ id: r.id, name: r.name })),
        online: onlineCount(),
      });
    }

    if (req.method === 'POST' && p === '/api/history') {
      const body = await readBody(req);
      const player = auth(req, body);
      if (!player) return json(res, 401, { error: 'no session' });
      const room = rooms[body.room] || rooms.lobby;
      return json(res, 200, { room: room.id, messages: room.messages });
    }

    if (req.method === 'POST' && p === '/api/chat') {
      const body = await readBody(req);
      const player = auth(req, body);
      if (!player) return json(res, 401, { error: 'no session' });
      if (!String(body.text || '').trim()) return json(res, 200, { ok: true });
      postChat(body.room, player, body.text);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && p === '/api/queue') {
      const body = await readBody(req);
      const player = auth(req, body);
      if (!player) return json(res, 401, { error: 'no session' });
      const game = body.game === 'connect4' ? 'connect4' : 'tictactoe';
      const match = enqueue(game, player);
      return json(res, 200, { queued: !match, match: match ? matchView(match) : null });
    }

    if (req.method === 'POST' && p === '/api/cancel') {
      const body = await readBody(req);
      const player = auth(req, body);
      if (!player) return json(res, 401, { error: 'no session' });
      cancelQueue(body.game === 'connect4' ? 'connect4' : 'tictactoe', player.token);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && p === '/api/move') {
      const body = await readBody(req);
      const player = auth(req, body);
      if (!player) return json(res, 401, { error: 'no session' });
      const m = matches.get(body.matchId);
      if (!m) return json(res, 404, { error: 'no such match' });
      const seatIndex = m.seats.findIndex((s) => !s.bot && s.token === player.token);
      if (seatIndex === -1) return json(res, 403, { error: 'not a player' });
      const result = applyMove(m, seatIndex, body.move);
      if (result.error) return json(res, 400, { error: result.error });
      pushMatch(m);
      scheduleBotIfNeeded(m);
      return json(res, 200, { ok: true, match: matchView(m) });
    }

    if (req.method === 'POST' && p === '/api/resign') {
      const body = await readBody(req);
      const player = auth(req, body);
      const m = matches.get(body.matchId);
      if (!player || !m) return json(res, 404, { error: 'no match' });
      const seatIndex = m.seats.findIndex((s) => !s.bot && s.token === player.token);
      if (seatIndex === -1) return json(res, 403, { error: 'not a player' });
      const foe = m.seats[1 - seatIndex];
      finish(m, foe.mark, null);
      pushMatch(m);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET') return serveStatic(req, res, p);
    return send(res, 405, 'text/plain', 'Method not allowed');
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: 'server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ============================================');
  console.log('   qeep revival is online');
  console.log(`   open your browser at:  http://localhost:${PORT}`);
  console.log('  ============================================');
  console.log('');
});
