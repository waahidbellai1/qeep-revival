/* ============================================================
   qeep revival - world: players, social, chat, DMs, economy
   ============================================================ */

const crypto = require('crypto');
const C = require('./content');

const uid = () => crypto.randomBytes(9).toString('hex');
const now = () => Date.now();

const MAX_ROOM_MSGS = 80;
const MAX_DM_MSGS = 120;

/* ------------------------------- state ------------------------------- */

const players = new Map();   // token -> player
const dms = new Map();       // pairKey -> messages[]
const rooms = {};            // id -> { id, name, topic, messages[] }

for (const id of Object.keys(C.ROOMS)) rooms[id] = { ...C.ROOMS[id], messages: [] };

let push = () => {};
function setPush(fn) { push = fn; }
function notify(token, event) { push(token, event); }

/* ------------------------------- players ------------------------------- */

function defaultPlayer(nick) {
  return {
    token: uid(),
    nick: nick || 'guest',
    avatar: 1 + Math.floor(Math.random() * 8),
    title: 'rookie',
    bio: '',
    coins: 100,
    xp: 0,
    level: 1,
    wins: 0, losses: 0, draws: 0,
    games: {},
    friends: [], reqOut: [], reqIn: [],
    owned: [...C.FREE_AVATARS],
    badges: [],
    stats: { chat: 0, played: 0, bought: 0, giftsSent: 0 },
    dailyAt: 0, streak: 0,
    created: now(), lastSeen: now(), online: false,
  };
}

function normalize(p) {
  const base = defaultPlayer(p.nick);
  const out = Object.assign(base, p);
  out.stats = Object.assign({ chat: 0, played: 0, bought: 0, giftsSent: 0 }, p.stats || {});
  out.games = p.games || {};
  out.friends = Array.isArray(p.friends) ? p.friends : [];
  out.reqOut = Array.isArray(p.reqOut) ? p.reqOut : [];
  out.reqIn = Array.isArray(p.reqIn) ? p.reqIn : [];
  out.owned = Array.isArray(p.owned) ? p.owned : [...C.FREE_AVATARS];
  out.badges = Array.isArray(p.badges) ? p.badges : [];
  out.online = false;
  out.botTimers = {};
  return out;
}

function makePlayer(nick) {
  let base = String(nick || 'guest').slice(0, 14).replace(/[^\w \-]/g, '').trim() || 'guest';
  let name = base, n = 1;
  const taken = new Set([...players.values()].map((p) => p.nick.toLowerCase()));
  while (taken.has(name.toLowerCase())) { n++; name = base.slice(0, 11) + n; }
  const p = defaultPlayer(name);
  players.set(p.token, p);
  return p;
}

const get = (token) => players.get(token) || null;
const findByNick = (nick) => [...players.values()].find((p) => p.nick.toLowerCase() === String(nick || '').toLowerCase()) || null;

function publicProfile(p) {
  if (!p) return null;
  return {
    token: p.token, nick: p.nick, avatar: p.avatar, title: p.title, bio: p.bio,
    coins: p.coins, xp: p.xp, level: p.level,
    xpPrev: C.xpForLevel(p.level), xpNext: C.xpForLevel(p.level + 1),
    wins: p.wins, losses: p.losses, draws: p.draws,
    games: p.games, badges: p.badges, owned: p.owned,
    stats: p.stats, streak: p.streak,
    friends: p.friends.map((t) => { const f = players.get(t); return f ? { token: f.token, nick: f.nick, avatar: f.avatar, level: f.level, online: f.online } : null; }).filter(Boolean),
    reqIn: p.reqIn.map((t) => { const f = players.get(t); return f ? { token: f.token, nick: f.nick, avatar: f.avatar, level: f.level } : null; }).filter(Boolean),
    reqOut: p.reqOut.map((t) => { const f = players.get(t); return f ? { token: f.token, nick: f.nick, avatar: f.avatar, level: f.level } : null; }).filter(Boolean),
    online: p.online,
  };
}

function touch(p) { if (p) p.lastSeen = now(); }

/* ------------------------------- xp + badges ------------------------------- */

function grantXp(p, amount) {
  const before = p.level;
  p.xp += amount;
  p.level = C.levelFromXp(p.xp);
  if (p.level > before) {
    p.coins += p.level * 20;
    notify(p.token, { type: 'levelUp', level: p.level, coins: p.level * 20 });
  }
  return p.level > before;
}

function checkBadges(p) {
  const have = new Set(p.badges);
  const winsByGame = Object.values(p.games).filter((g) => g && g.w >= 1).length;
  const cond = {
    first_win: p.wins >= 1,
    wins_10: p.wins >= 10,
    wins_50: p.wins >= 50,
    gamer: p.stats.played >= 10,
    allrounder: winsByGame >= 3,
    rich: p.coins >= 1000,
    social: p.friends.length >= 5,
    chatter: p.stats.chat >= 50,
    shopper: p.stats.bought >= 3,
    level5: p.level >= 5,
    level10: p.level >= 10,
    streak7: p.streak >= 7,
  };
  for (const b of C.BADGES) {
    if (!have.has(b.id) && cond[b.id]) {
      p.badges.push(b.id);
      p.coins += b.coins;
      notify(p.token, { type: 'badge', badge: b });
    }
  }
}

/* ------------------------------- chat ------------------------------- */

function postChat(roomId, player, text, system) {
  const room = rooms[roomId] || rooms.lobby;
  const msg = {
    id: uid(), room: room.id,
    from: system ? null : player.token, nick: system ? 'system' : player.nick,
    avatar: system ? 0 : player.avatar, text: String(text).slice(0, 200),
    system: !!system, at: now(),
  };
  room.messages.push(msg);
  if (room.messages.length > MAX_ROOM_MSGS) room.messages.shift();
  if (!system) {
    player.stats.chat++;
    grantXp(player, 2);
    checkBadges(player);
  }
  return msg;
}

/* ------------------------------- direct messages ------------------------------- */

const pairKey = (a, b) => [a, b].sort().join('|');
const dmThread = (a, b) => { const k = pairKey(a, b); if (!dms.has(k)) dms.set(k, []); return dms.get(k); };

function sendDM(from, toToken, text) {
  const to = players.get(toToken);
  if (!to) return { error: 'No such player' };
  const thread = dmThread(from.token, toToken);
  const msg = { id: uid(), from: from.token, to: toToken, text: String(text).slice(0, 200), at: now(), read: false };
  thread.push(msg);
  if (thread.length > MAX_DM_MSGS) thread.shift();
  notify(toToken, { type: 'dm', msg: { ...msg, fromNick: from.nick, fromAvatar: from.avatar } });
  return { ok: true, msg };
}

function markDMRead(readerToken, otherToken) {
  const thread = dmThread(readerToken, otherToken);
  let changed = false;
  for (const m of thread) if (m.to === readerToken && !m.read) { m.read = true; changed = true; }
  return changed;
}

function dmHistory(a, b) { return dmThread(a, b); }

/* Summary of everyone this player has a conversation with */
function dmThreads(token) {
  const out = [];
  for (const [key, thread] of dms) {
    const parts = key.split('|');
    if (!parts.includes(token)) continue;
    const otherToken = parts[0] === token ? parts[1] : parts[0];
    const other = players.get(otherToken);
    if (!other) continue;
    const last = thread[thread.length - 1];
    let unread = 0;
    for (const m of thread) if (m.to === token && !m.read) unread++;
    out.push({
      token: other.token, nick: other.nick, avatar: other.avatar, level: other.level, online: other.online,
      unread, last: last ? { text: last.text, at: last.at, mine: last.from === token } : null,
    });
  }
  return out.sort((a, b) => (b.last ? b.last.at : 0) - (a.last ? a.last.at : 0));
}

function unreadCount(token) {
  let n = 0;
  for (const [, thread] of dms) for (const m of thread) if (m.to === token && !m.read) n++;
  return n;
}

/* ------------------------------- friends ------------------------------- */

function friendRequest(from, target) {
  if (!target) return { error: 'Player not found' };
  if (target.token === from.token) return { error: "You can't add yourself" };
  if (from.friends.includes(target.token)) return { error: 'Already friends' };
  if (from.reqOut.includes(target.token)) return { error: 'Request already sent' };
  if (from.reqIn.includes(target.token)) return friendAccept(from, target); // mutual -> accept
  from.reqOut.push(target.token);
  target.reqIn.push(from.token);
  notify(target.token, { type: 'friendRequest', from: { token: from.token, nick: from.nick, avatar: from.avatar, level: from.level } });
  return { ok: true, sent: true };
}

function friendAccept(from, target) {
  if (!from.reqIn.includes(target.token) && !target.reqOut.includes(from.token)) {
    if (!from.reqOut.includes(target.token)) return { error: 'No request from them' };
  }
  from.reqIn = from.reqIn.filter((t) => t !== target.token);
  target.reqOut = target.reqOut.filter((t) => t !== from.token);
  if (!from.friends.includes(target.token)) from.friends.push(target.token);
  if (!target.friends.includes(from.token)) target.friends.push(from.token);
  checkBadges(from); checkBadges(target);
  notify(target.token, { type: 'friendAccepted', who: { token: from.token, nick: from.nick, avatar: from.avatar, level: from.level } });
  notify(from.token, { type: 'friendAccepted', who: { token: target.token, nick: target.nick, avatar: target.avatar, level: target.level } });
  return { ok: true };
}

function friendRemove(a, bToken) {
  a.friends = a.friends.filter((t) => t !== bToken);
  a.reqIn = a.reqIn.filter((t) => t !== bToken);
  a.reqOut = a.reqOut.filter((t) => t !== bToken);
  const b = players.get(bToken);
  if (b) { b.friends = b.friends.filter((t) => t !== a.token); b.reqIn = b.reqIn.filter((t) => t !== a.token); b.reqOut = b.reqOut.filter((t) => t !== a.token); }
  return { ok: true };
}

/* ------------------------------- gifts ------------------------------- */

function gift(from, toToken, amount) {
  const to = players.get(toToken);
  if (!to) return { error: 'Player not found' };
  const amt = Math.floor(Number(amount));
  if (!Number.isFinite(amt) || amt < 1) return { error: 'Bad amount' };
  if (from.coins < amt) return { error: 'Not enough coins' };
  from.coins -= amt;
  to.coins += amt;
  from.stats.giftsSent++;
  checkBadges(to); checkBadges(from);
  notify(toToken, { type: 'gift', from: { token: from.token, nick: from.nick, avatar: from.avatar }, amount: amt });
  return { ok: true };
}

/* ------------------------------- daily bonus ------------------------------- */

function claimDaily(p) {
  const day = 86400000;
  const today = new Date().setHours(0, 0, 0, 0);
  const last = p.dailyAt ? new Date(p.dailyAt).setHours(0, 0, 0, 0) : 0;
  if (last === today) return { error: 'Already claimed today' };
  p.streak = (today - last === day) ? p.streak + 1 : 1;
  p.dailyAt = now();
  const base = 30 + Math.min(p.streak, 7) * 10;
  p.coins += base;
  grantXp(p, 15);
  checkBadges(p);
  return { ok: true, amount: base, streak: p.streak };
}

/* ------------------------------- shop + profile ------------------------------- */

function buy(p, itemId) {
  const item = C.SHOP.find((i) => i.id === itemId);
  if (!item) return { error: 'No such item' };
  if (p.owned.includes(itemId)) return { error: 'Already owned' };
  if (p.coins < item.cost) return { error: 'Not enough coins' };
  p.coins -= item.cost;
  p.owned.push(itemId);
  p.stats.bought++;
  checkBadges(p);
  return { ok: true, item };
}

function updateProfile(p, patch) {
  if (typeof patch.nick === 'string' && patch.nick.trim()) {
    const cleaned = patch.nick.slice(0, 14).replace(/[^\w \-]/g, '').trim();
    if (cleaned) {
      const clash = findByNick(cleaned);
      if (clash && clash.token !== p.token) return { error: 'That nickname is taken' };
      p.nick = cleaned;
    }
  }
  if (typeof patch.bio === 'string') p.bio = patch.bio.slice(0, 80);
  if (patch.avatar != null) {
    const av = 'av' + Number(patch.avatar);
    if (!p.owned.includes(av)) return { error: 'You do not own that avatar' };
    p.avatar = Number(patch.avatar);
  }
  if (typeof patch.title === 'string') {
    const t = C.TITLES.find((x) => x.id === patch.title);
    if (!t) return { error: 'No such title' };
    if (t.cost > 0 && !p.owned.includes('title_' + t.id)) return { error: 'You do not own that title' };
    p.title = t.id;
  }
  return { ok: true };
}

/* ------------------------------- game rewards ------------------------------- */

function rewardGame(m) {
  const game = m.game;
  for (const seat of m.seats) {
    if (seat.bot) continue;
    const p = players.get(seat.token);
    if (!p) continue;
    if (!p.games[game]) p.games[game] = { w: 0, l: 0, d: 0 };
    p.stats.played++;
    if (m.winner === null) { p.draws++; p.games[game].d++; p.coins += 10; grantXp(p, 15); }
    else if (seat.mark === m.winner) { p.wins++; p.games[game].w++; p.coins += 30; grantXp(p, 45); }
    else { p.losses++; p.games[game].l++; p.coins += 8; grantXp(p, 12); }
    checkBadges(p);
    notify(p.token, { type: 'profile', profile: publicProfile(p) });
  }
}

/* ------------------------------- leaderboards ------------------------------- */

function leaderboard(board) {
  const all = [...players.values()];
  const sorters = {
    wins: (a, b) => b.wins - a.wins || b.coins - a.coins,
    coins: (a, b) => b.coins - a.coins || b.wins - a.wins,
    level: (a, b) => b.level - a.level || b.xp - a.xp,
  };
  return all.sort(sorters[board] || sorters.wins).slice(0, 20).map((p) => ({
    token: p.token, nick: p.nick, avatar: p.avatar, level: p.level,
    coins: p.coins, wins: p.wins, losses: p.losses, online: p.online,
  }));
}

/* ------------------------------- persistence ------------------------------- */

function snapshot() {
  const cleanPlayers = [...players.values()].map((p) => {
    const c = { ...p };
    delete c.botTimers; delete c.online;
    return c;
  });
  const roomData = {};
  for (const id of Object.keys(rooms)) roomData[id] = { messages: rooms[id].messages };
  return { v: 2, savedAt: now(), players: cleanPlayers, rooms: roomData, dms: [...dms.entries()] };
}

function hydrate(data) {
  if (!data) return false;
  try {
    players.clear(); dms.clear();
    for (const p of data.players || []) players.set(p.token, normalize(p));
    for (const [id, r] of Object.entries(data.rooms || {})) if (rooms[id]) rooms[id].messages = r.messages || [];
    for (const [k, thread] of data.dms || []) dms.set(k, thread);
    return true;
  } catch (_) { return false; }
}

/* ------------------------------- misc ------------------------------- */

function stats() {
  return {
    players: players.size,
    online: [...players.values()].filter((p) => p.online).length,
    rooms: Object.keys(rooms).length,
    badges: C.BADGES.length,
    games: 6,
  };
}

module.exports = {
  players, dms, rooms, get, findByNick, publicProfile, makePlayer, normalize, touch,
  setPush, notify, postChat, sendDM, markDMRead, dmHistory, dmThreads, unreadCount,
  friendRequest, friendAccept, friendRemove, gift, claimDaily, buy, updateProfile,
  rewardGame, leaderboard, snapshot, hydrate, stats, grantXp, checkBadges,
};
