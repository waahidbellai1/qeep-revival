/* ============================================================
   qeep revival - game engine
   Every game is a module: { id, name, icon, blurb, marks,
     create(m), move(m, seatIndex, move), bot(m, seatIndex),
     view?(m), botSeats?(m) }
   ============================================================ */

const crypto = require('crypto');
const { QUIZ } = require('./content');

const uid = () => crypto.randomBytes(9).toString('hex');
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];

function seatView(s) {
  return { token: s.token, nick: s.nick, avatar: s.avatar, bot: !!s.bot, mark: s.mark };
}

const GAMES = {};

/* ============================ TIC-TAC-TOE ============================ */

const TT_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
function ttResult(b) {
  for (const [x, y, z] of TT_LINES) if (b[x] && b[x] === b[y] && b[y] === b[z]) return { mark: b[x], line: [x, y, z] };
  return b.every(Boolean) ? { mark: 'draw', line: null } : null;
}
GAMES.tictactoe = {
  id: 'tictactoe', name: 'Tic-Tac-Toe', icon: '✕', blurb: 'Three in a row', marks: ['X', 'O'],
  create() { return { board: Array(9).fill(null), turn: 0 }; },
  move(m, si, mv) {
    if (m.turn !== si) return { error: 'Not your turn' };
    const i = Number(mv);
    if (!Number.isInteger(i) || i < 0 || i > 8) return { error: 'Bad square' };
    if (m.board[i]) return { error: 'Square taken' };
    m.board[i] = m.seats[si].mark;
    const w = ttResult(m.board);
    if (w) { m.status = 'finished'; m.winner = w.mark === 'draw' ? null : w.mark; m.line = w.line; }
    else m.turn = 1 - m.turn;
    return {};
  },
  bot(m, si) {
    const mark = m.seats[si].mark, foe = mark === 'X' ? 'O' : 'X';
    const empty = m.board.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    const wins = (i, who) => { const c = m.board.slice(); c[i] = who; const r = ttResult(c); return r && r.mark === who; };
    for (const i of empty) if (wins(i, mark)) return i;
    for (const i of empty) if (wins(i, foe)) return i;
    if (empty.includes(4)) return 4;
    const corners = [0, 2, 6, 8].filter((i) => empty.includes(i));
    if (corners.length && Math.random() < 0.8) return pick(corners);
    return pick(empty);
  },
};

/* ============================ CONNECT FOUR ============================ */

function c4Result(cols) {
  const g = Array.from({ length: 6 }, () => Array(7).fill(null));
  cols.forEach((col, c) => col.forEach((v, r) => { g[r][c] = v; }));
  for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) {
    const v = g[r][c]; if (!v) continue;
    for (const [dc, dr] of [[1,0],[0,1],[1,1],[1,-1]]) {
      const cells = [];
      for (let k = 0; k < 4; k++) {
        const rr = r + dr * k, cc = c + dc * k;
        if (rr < 0 || rr > 5 || cc < 0 || cc > 6 || g[rr][cc] !== v) { cells.length = 0; break; }
        cells.push([rr, cc]);
      }
      if (cells.length === 4) return { mark: v, line: cells };
    }
  }
  return cols.every((col) => col.length === 6) ? { mark: 'draw', line: null } : null;
}
GAMES.connect4 = {
  id: 'connect4', name: 'Connect Four', icon: '▤', blurb: 'Four in a line', marks: ['R', 'Y'],
  create() { return { board: Array.from({ length: 7 }, () => []), turn: 0 }; },
  move(m, si, mv) {
    if (m.turn !== si) return { error: 'Not your turn' };
    const c = Number(mv);
    if (!Number.isInteger(c) || c < 0 || c > 6) return { error: 'Bad column' };
    if (m.board[c].length >= 6) return { error: 'Column full' };
    m.board[c].push(m.seats[si].mark);
    const w = c4Result(m.board);
    if (w) { m.status = 'finished'; m.winner = w.mark === 'draw' ? null : w.mark; m.line = w.line; }
    else m.turn = 1 - m.turn;
    return {};
  },
  bot(m, si) {
    const mark = m.seats[si].mark, foe = mark === 'R' ? 'Y' : 'R';
    const legal = [];
    for (let c = 0; c < 7; c++) if (m.board[c].length < 6) legal.push(c);
    const wins = (c, who) => { const copy = m.board.map((x) => x.slice()); copy[c].push(who); const r = c4Result(copy); return r && r.mark === who; };
    for (const c of legal) if (wins(c, mark)) return c;
    for (const c of legal) if (wins(c, foe)) return c;
    return [3, 2, 4, 1, 5, 0, 6].find((c) => legal.includes(c));
  },
};

/* ============================ REVERSI ============================ */

const REV_DIRS = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
const rc = (c, r) => r * 8 + c;
function revFlips(board, i, who) {
  if (board[i]) return [];
  const foe = who === 'B' ? 'W' : 'B';
  const c = i % 8, r = Math.floor(i / 8), out = [];
  for (const [dc, dr] of REV_DIRS) {
    const line = [];
    let cc = c + dc, rr = r + dr;
    while (cc >= 0 && cc < 8 && rr >= 0 && rr < 8 && board[rc(cc, rr)] === foe) { line.push(rc(cc, rr)); cc += dc; rr += dr; }
    if (line.length && cc >= 0 && cc < 8 && rr >= 0 && rr < 8 && board[rc(cc, rr)] === who) out.push(...line);
  }
  return out;
}
function revLegal(board, who) {
  const map = {};
  for (let i = 0; i < 64; i++) { const f = revFlips(board, i, who); if (f.length) map[i] = f; }
  return map;
}
function revEnd(m) {
  let b = 0, w = 0;
  for (const v of m.board) { if (v === 'B') b++; else if (v === 'W') w++; }
  m.status = 'finished';
  m.winner = b === w ? null : (b > w ? 'B' : 'W');
  m.extra.count = { B: b, W: w };
}
function revAdvance(m) {
  m.turn = 1 - m.turn;
  const who = m.seats[m.turn].mark, other = m.seats[1 - m.turn].mark;
  if (Object.keys(revLegal(m.board, who)).length) return;
  if (Object.keys(revLegal(m.board, other)).length) { m.turn = 1 - m.turn; m.extra.passed = who; return; }
  revEnd(m);
}
GAMES.reversi = {
  id: 'reversi', name: 'Reversi', icon: '◐', blurb: 'Flip to win', marks: ['B', 'W'],
  create() {
    const board = Array(64).fill(null);
    board[rc(3, 3)] = 'W'; board[rc(4, 3)] = 'B'; board[rc(3, 4)] = 'B'; board[rc(4, 4)] = 'W';
    return { board, turn: 0, extra: {} };
  },
  move(m, si, mv) {
    if (m.turn !== si) return { error: 'Not your turn' };
    const who = m.seats[si].mark;
    const i = Number(mv);
    const legal = revLegal(m.board, who);
    if (!legal[i]) return { error: 'Illegal move' };
    m.board[i] = who;
    for (const f of legal[i]) m.board[f] = who;
    m.extra.passed = null;
    revAdvance(m);
    return {};
  },
  bot(m, si) {
    const who = m.seats[si].mark;
    const legal = revLegal(m.board, who);
    const keys = Object.keys(legal).map(Number);
    let best = keys[0], bestScore = -1e9;
    for (const i of keys) {
      const c = i % 8, r = Math.floor(i / 8);
      let s = legal[i].length + Math.random() * 2;
      if ((c === 0 || c === 7) && (r === 0 || r === 7)) s += 100;
      else if (c === 0 || c === 7 || r === 0 || r === 7) s += 8;
      if (s > bestScore) { bestScore = s; best = i; }
    }
    return best;
  },
};

/* ============================ NIM ============================ */

GAMES.nim = {
  id: 'nim', name: 'Nim', icon: '⚱', blurb: 'Take the last to win', marks: ['A', 'B'],
  create() { return { board: { piles: [3, 4, 5] }, turn: 0 }; },
  move(m, si, mv) {
    if (m.turn !== si) return { error: 'Not your turn' };
    const p = Number(mv && mv.p), take = Number(mv && mv.take);
    const piles = m.board.piles;
    if (!Number.isInteger(p) || p < 0 || p >= piles.length) return { error: 'Bad pile' };
    if (!Number.isInteger(take) || take < 1 || take > piles[p]) return { error: 'Bad amount' };
    piles[p] -= take;
    m.extra.last = { p, take };
    if (piles.every((x) => x === 0)) { m.status = 'finished'; m.winner = m.seats[si].mark; }
    else m.turn = 1 - m.turn;
    return {};
  },
  bot(m, si) {
    const piles = m.board.piles;
    let x = 0; for (const p of piles) x ^= p;
    if (x !== 0) {
      for (let i = 0; i < piles.length; i++) {
        const t = piles[i] - (piles[i] ^ x);
        if (t > 0) return { p: i, take: t };
      }
    }
    const i = piles.findIndex((p) => p > 0);
    return { p: i, take: 1 };
  },
};

/* ============================ ROCK PAPER SCISSORS ============================ */

const RPS_BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
GAMES.rps = {
  id: 'rps', name: 'Rock Paper Scissors', icon: '✊', blurb: 'Best of three', marks: ['1', '2'],
  create() { return { board: { round: 1, score: [0, 0], picks: [null, null], reveal: null }, turn: 0, extra: {} }; },
  move(m, si, mv) {
    if (!RPS_BEATS[mv]) return { error: 'Pick rock, paper or scissors' };
    if (m.board.picks[si]) return { error: 'Already picked' };
    m.board.picks[si] = mv;
    m.board.reveal = null;
    if (m.board.picks.every(Boolean)) {
      const [a, b] = m.board.picks;
      const w = a === b ? -1 : (RPS_BEATS[a] === b ? 0 : 1);
      if (w >= 0) m.board.score[w]++;
      m.board.reveal = { picks: [a, b], winner: w };
      m.board.picks = [null, null];
      const target = 2;
      if (m.board.score[0] === target || m.board.score[1] === target) {
        m.status = 'finished';
        const wi = m.board.score[0] > m.board.score[1] ? 0 : 1;
        m.winner = m.seats[wi].mark;
      } else m.board.round++;
    }
    return {};
  },
  bot() { return pick(['rock', 'paper', 'scissors']); },
  botSeats(m) {
    if (m.status !== 'playing') return [];
    return m.seats.map((s, i) => (s.bot && !m.board.picks[i] ? i : -1)).filter((i) => i >= 0);
  },
};

/* ============================ QUIZ ============================ */

GAMES.quiz = {
  id: 'quiz', name: 'Retro Quiz', icon: '?', blurb: 'Trivia showdown', marks: ['1', '2'],
  create(m) {
    const order = [];
    while (order.length < 6) { const i = rnd(QUIZ.length); if (!order.includes(i)) order.push(i); }
    return { board: { qi: 0, total: 6, scores: [0, 0], order, lastResult: null }, turn: 0, extra: {} };
  },
  move(m, si, mv) {
    if (m.turn !== si) return { error: 'Not your turn' };
    const b = m.board;
    if (b.qi >= b.total) return { error: 'Quiz over' };
    const q = QUIZ[b.order[b.qi]];
    const choice = Number(mv);
    if (!Number.isInteger(choice) || choice < 0 || choice >= q.o.length) return { error: 'Bad answer' };
    const correct = choice === q.a;
    if (correct) b.scores[si]++;
    b.lastResult = { seat: si, nick: m.seats[si].nick, correct, picked: q.o[choice], answer: q.o[q.a], q: q.q };
    b.qi++;
    if (b.qi >= b.total) {
      m.status = 'finished';
      const [s0, s1] = b.scores;
      if (s0 === s1) m.winner = null; else m.winner = m.seats[s0 > s1 ? 0 : 1].mark;
    } else m.turn = 1 - m.turn;
    return {};
  },
  bot(m, si) {
    const q = QUIZ[m.board.order[m.board.qi]];
    if (Math.random() < 0.72) return q.a;
    const others = q.o.map((_, i) => i).filter((i) => i !== q.a);
    return pick(others);
  },
  view(m) {
    const b = m.board;
    const cur = b.qi < b.total ? QUIZ[b.order[b.qi]] : null;
    return {
      board: {
        qi: b.qi, total: b.total, scores: b.scores, lastResult: b.lastResult,
        question: cur ? { q: cur.q, o: cur.o } : null,
      },
    };
  },
};

/* ============================ framework ============================ */

function meta() {
  return Object.values(GAMES).map((g) => ({ id: g.id, name: g.name, icon: g.icon, blurb: g.blurb }));
}

function createMatch(game, a, b) {
  const mod = GAMES[game];
  a.mark = mod.marks[0]; b.mark = mod.marks[1];
  const m = {
    id: uid(), game, status: 'playing', seats: [a, b], turn: 0,
    winner: null, line: null, board: null, extra: {}, createdAt: Date.now(),
  };
  Object.assign(m, mod.create(m) || {});
  return m;
}

function applyMove(m, si, mv) {
  const mod = GAMES[m.game];
  if (m.status !== 'playing') return { error: 'Game over' };
  return mod.move(m, si, mv) || {};
}

function botSeats(m) {
  if (m.status !== 'playing') return [];
  const mod = GAMES[m.game];
  if (mod.botSeats) return mod.botSeats(m);
  return m.seats[m.turn] && m.seats[m.turn].bot ? [m.turn] : [];
}

function botMove(m, si) { return GAMES[m.game].bot(m, si); }

function matchView(m) {
  const mod = GAMES[m.game];
  const base = {
    id: m.id, game: m.game, status: m.status, seats: m.seats.map(seatView),
    turn: m.turn, winner: m.winner, line: m.line,
  };
  const v = mod.view ? mod.view(m) : { board: m.board, extra: m.extra };
  return Object.assign(base, v);
}

function isValidGame(id) { return !!GAMES[id]; }

/* A guaranteed-legal move for a seat, used as a safety net so a game can never stall. */
function fallbackMove(m, si) {
  const who = m.seats[si].mark;
  switch (m.game) {
    case 'tictactoe': return m.board.findIndex((v) => !v);
    case 'connect4': return m.board.findIndex((c) => c.length < 6);
    case 'nim': return { p: m.board.piles.findIndex((p) => p > 0), take: 1 };
    case 'reversi': { for (let i = 0; i < 64; i++) if (revFlips(m.board, i, who).length) return i; return null; }
    case 'rps': return pick(['rock', 'paper', 'scissors']);
    case 'quiz': return 0;
    default: return null;
  }
}

module.exports = { meta, createMatch, applyMove, botSeats, botMove, matchView, isValidGame, seatView, fallbackMove, GAMES };
