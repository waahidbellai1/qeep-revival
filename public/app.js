/* ============================================================
   qeep revival - front-end (vanilla JS, no build step)
   ============================================================ */
(() => {
  'use strict';

  /* ----------------------------- helpers ----------------------------- */

  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const AVATARS = [
    { ch: '☺', c: '#a6ff2e' }, { ch: '☻', c: '#4fd1ff' }, { ch: '♥', c: '#ff5d5d' }, { ch: '★', c: '#ffcf3f' },
    { ch: '◆', c: '#c08bff' }, { ch: '●', c: '#ff9f3f' }, { ch: '▲', c: '#4fffb0' }, { ch: '♣', c: '#ff7bd1' },
  ];
  function avatarHTML(n, big) {
    const a = AVATARS[((Number(n) || 1) - 1) % AVATARS.length];
    return `<span class="av${big ? ' big' : ''}" style="background:${a.c}">${a.ch}</span>`;
  }

  const API = {
    async post(path, body) {
      const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      try { return await r.json(); } catch { return {}; }
    },
    async get(path) { try { return await (await fetch(path)).json(); } catch { return {}; } },
  };

  /* ----------------------------- sound ----------------------------- */

  let actx = null;
  function beep(freq = 440, dur = 0.05, type = 'square', vol = 0.035) {
    if (!S.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.value = vol;
      o.connect(g); g.connect(actx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.stop(actx.currentTime + dur);
    } catch (_) { /* ignore */ }
  }
  const sfx = {
    nav: () => beep(600, 0.03, 'square', 0.02),
    ok: () => beep(820, 0.05),
    back: () => beep(280, 0.05),
    msg: () => { beep(950, 0.035); setTimeout(() => beep(1250, 0.05), 55); },
    move: () => beep(500, 0.04),
    win: () => [660, 880, 1180].forEach((f, i) => setTimeout(() => beep(f, 0.09), i * 90)),
    lose: () => [420, 300, 210].forEach((f, i) => setTimeout(() => beep(f, 0.1, 'sawtooth'), i * 110)),
    coin: () => { beep(1200, 0.04); setTimeout(() => beep(1600, 0.06), 60); },
    boot: () => [320, 500, 700, 950].forEach((f, i) => setTimeout(() => beep(f, 0.07), i * 85)),
  };

  /* ----------------------------- state ----------------------------- */

  const S = {
    token: localStorage.getItem('qeep.token') || null,
    profile: null,
    screen: 'boot',
    data: {},
    sel: 0,
    rows: [],
    soft: {},
    stack: [],
    rooms: [],
    online: 0,
    unread: {},
    match: null,
    history: {},
    chatRoom: null,
    sound: localStorage.getItem('qeep.sound') !== 'off',
    es: null,
    booted: false,
  };

  let timers = [];
  const every = (fn, ms) => { const t = setInterval(fn, ms); timers.push(t); return t; };
  const clearTimers = () => { timers.forEach(clearInterval); timers = []; };

  const ROOM_FALLBACK = { lobby: 'The Lobby', sayhi: 'Say Hi', gamers: 'Game Central' };
  const GAME_NAMES = { tictactoe: 'Tic-Tac-Toe', connect4: 'Connect Four' };
  const roomName = (id) => (S.rooms.find((r) => r.id === id) || {}).name || ROOM_FALLBACK[id] || id;
  const gameName = (id) => GAME_NAMES[id] || id;
  const me = () => S.profile;

  /* ----------------------------- boot ----------------------------- */

  const screens = {};

  screens.boot = {
    view() {
      return {
        html: `<div class="page center" style="padding-top:46px">
            <div class="hdr center" style="font-size:24px;color:var(--lime);text-shadow:0 0 16px rgba(166,255,46,.6)">qeep</div>
            <div class="txt dim center small" style="margin-top:4px">mobile social · revival build</div>
            <div class="bar" style="margin-top:34px"><i id="bootbar"></i></div>
            <div class="txt center dim small" id="bootmsg">loading midlet...</div>
          </div>`,
        rows: [],
        soft: { left: null, right: null },
        after: runBoot,
      };
    },
  };

  function runBoot() {
    const steps = [['loading midlet...', 22], ['starting KVM...', 48], ['opening GPRS link...', 72], ['syncing profile...', 94]];
    let i = 0;
    const bar = el('bootbar'), msg = el('bootmsg');
    every(() => {
      if (i < steps.length) {
        if (bar) bar.style.width = steps[i][1] + '%';
        if (msg) msg.textContent = steps[i][0];
        i++;
      } else {
        clearTimers();
        if (bar) bar.style.width = '100%';
        sfx.boot();
        setTimeout(finishBoot, 350);
      }
    }, 400);
  }

  async function finishBoot() {
    if (S.token) {
      const r = await API.post('/api/join', { token: S.token });
      if (r && r.player) {
        S.profile = r.player; S.rooms = r.rooms || []; S.online = r.online || 0;
        S.booted = true; connectEvents(); return show('home');
      }
    }
    show('login');
  }

  /* ----------------------------- login ----------------------------- */

  screens.login = {
    view() {
      return {
        html: `<div class="page">
            <div class="hdr center" style="font-size:15px;color:var(--lime)">qeep</div>
            <div class="txt center dim small">choose a nickname to sign in</div>
            <form id="loginForm" autocomplete="off">
              <div class="field"><span class="cur">_</span>
                <input id="loginName" maxlength="14" placeholder="nickname" autocomplete="off">
              </div>
              <div class="btnrow">
                <button class="btn primary" type="submit">Sign in ▶</button>
                <button class="btn" type="button" data-act="random">Random</button>
              </div>
            </form>
            <div class="card tiny dim" style="margin-top:16px">
              ${S.online || 0} player(s) online.<br>
              Chat in public rooms, play turn-based games vs
              other players or bots, and collect <span class="gold">coins</span>.
            </div>
          </div>`,
        rows: [],
        soft: { left: { label: 'Sign in', act: submitLogin }, right: null },
        after: () => el('loginName') && el('loginName').focus(),
      };
    },
  };

  const NICK_POOL = ['SnakeKing', 'NokiaBoy', 'S60Fan', 'GprsGuru', 'MissMms', 'BluetoothBae', 'PolyBoi', 'JavaJunkie', 'WapWizard', 'EdgeEnjoyer'];
  function randomNick() {
    return NICK_POOL[Math.floor(Math.random() * NICK_POOL.length)] + (10 + Math.floor(Math.random() * 89));
  }
  function submitLogin() {
    const input = el('loginName');
    const nick = (input && input.value.trim()) || randomNick();
    doLogin(nick);
  }
  async function doLogin(nick) {
    const r = await API.post('/api/join', { nick });
    if (!r || !r.player) return;
    S.profile = r.player;
    S.token = r.player.token;
    localStorage.setItem('qeep.token', S.token);
    S.rooms = r.rooms || [];
    S.online = r.online || 0;
    S.booted = true;
    sfx.ok();
    connectEvents();
    show('home');
  }

  /* ----------------------------- home ----------------------------- */

  function unreadTotal() { return Object.values(S.unread).reduce((a, b) => a + b, 0); }

  screens.home = {
    view() {
      const p = S.profile || {};
      const items = [
        { ico: '✉', label: 'Chat', meta: unreadTotal() ? String(unreadTotal()) : 'public rooms', act: () => show('rooms', {}, true) },
        { ico: '▦', label: 'Games', meta: 'play live', act: () => show('games', {}, true) },
        { ico: '★', label: 'Leaderboard', meta: 'top players', act: () => show('top', {}, true) },
        { ico: '☺', label: 'My profile', meta: p.nick, act: () => show('profile', {}, true) },
        { ico: '?', label: 'About qeep', meta: 'controls', act: () => show('about', {}, true) },
      ];
      const html = `<div class="page">
          <div class="card hi" style="display:flex;align-items:center;gap:10px">
            ${avatarHTML(p.avatar, true)}
            <div style="flex:1;min-width:0">
              <div class="txt" style="font-size:20px">${esc(p.nick || 'guest')}</div>
              <div class="tiny dim">${S.online} online · rank #${p.rank || '-'}</div>
            </div>
            <div class="center">
              <div class="txt gold" style="font-size:20px">${p.coins ?? 0}</div>
              <div class="tiny dim">coins</div>
            </div>
          </div>
          <div class="hdr">MENU</div>
          <div class="list">
            ${items.map((i, k) => `<div class="row${k === S.sel ? ' sel' : ''}" data-idx="${k}">
                <span class="ico">${i.ico}</span><span class="grow">${i.label}</span>
                <span class="meta">${i.meta || ''}</span></div>`).join('')}
          </div>
        </div>`;
      return { html, rows: items.map((i) => i.act), soft: { left: { label: 'Select', act: activate }, right: { label: 'Log out', act: logout } } };
    },
  };

  function logout() {
    localStorage.removeItem('qeep.token');
    if (S.es) { S.es.close(); S.es = null; }
    S.token = null; S.profile = null; S.stack = []; S.match = null;
    show('login');
  }

  /* ----------------------------- rooms ----------------------------- */

  screens.rooms = {
    view() {
      const rooms = S.rooms.length ? S.rooms : Object.keys(ROOM_FALLBACK).map((id) => ({ id, name: ROOM_FALLBACK[id] }));
      const rows = rooms.map((r) => () => show('chat', { room: r.id }, true));
      const html = `<div class="page">
          <div class="hdr">✉ CHAT ROOMS</div>
          <div class="list">
            ${rooms.map((r, k) => {
              const u = S.unread[r.id] || 0;
              return `<div class="row${k === S.sel ? ' sel' : ''}" data-idx="${k}">
                  <span class="ico">#</span><span class="grow">${esc(r.name)}</span>
                  ${u ? `<span class="badge">${u}</span>` : '<span class="meta">›</span>'}
                </div>`;
            }).join('')}
          </div>
          <div class="card tiny dim" style="margin-top:10px">${S.online} online. Be nice - it's the retro web out here.</div>
        </div>`;
      return { html, rows, soft: { left: { label: 'Open', act: activate }, right: { label: 'Back', act: back } } };
    },
  };

  /* ----------------------------- chat ----------------------------- */

  screens.chat = {
    view(d) {
      S.chatRoom = d.room;
      S.unread[d.room] = 0;
      const html = `<div class="chat">
          <div class="hdr" style="margin:0;padding:6px 10px 4px;border-bottom:1px solid #0d3b36"># ${esc(roomName(d.room))}</div>
          <div class="msgs" id="msgs"><div class="txt dim small">loading...</div></div>
          <form id="chatForm" class="field" style="margin:0;border-left:none;border-right:none;border-bottom:none;border-radius:0">
            <span class="cur">_</span>
            <input id="chatInput" maxlength="160" placeholder="say something..." autocomplete="off">
            <button class="btn primary" type="submit" style="padding:1px 9px">▶</button>
          </form>
        </div>`;
      return {
        html, rows: [],
        soft: { left: { label: 'Send', act: () => sendChat() }, right: { label: 'Back', act: back } },
        after: async () => {
          const r = await API.post('/api/history', { token: S.token, room: d.room });
          S.history[d.room] = (r && r.messages) || [];
          renderMessages(d.room);
          const inp = el('chatInput');
          if (inp) { inp.focus(); }
        },
      };
    },
  };

  function msgHTML(m) {
    const mine = m.from && S.profile && m.from === S.profile.token;
    if (m.system) return `<div class="msg sys">— ${esc(m.text)} —</div>`;
    return `<div class="msg${mine ? ' mine' : ''}">
        ${avatarHTML(m.avatar)} <span class="who">${esc(m.nick)}</span>
        <span class="t">${new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><br>
        ${esc(m.text)}</div>`;
  }
  function renderMessages(room) {
    const box = el('msgs');
    if (!box) return;
    const list = S.history[room] || [];
    box.innerHTML = list.length ? list.map(msgHTML).join('') : '<div class="txt dim small">no messages yet - say hi!</div>';
    box.scrollTop = box.scrollHeight;
  }
  function appendMessage(room, m) {
    (S.history[room] = S.history[room] || []).push(m);
    if (S.screen === 'chat' && S.chatRoom === room) {
      const box = el('msgs');
      if (box) {
        if (box.querySelector('.dim')) box.innerHTML = '';
        box.insertAdjacentHTML('beforeend', msgHTML(m));
        box.scrollTop = box.scrollHeight;
      }
    }
  }
  async function sendChat() {
    const inp = el('chatInput');
    if (!inp) return;
    const text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    await API.post('/api/chat', { token: S.token, room: S.chatRoom, text });
  }

  /* ----------------------------- games ----------------------------- */

  screens.games = {
    view() {
      const items = [
        { ico: '✕', label: 'Tic-Tac-Toe', meta: 'classic', act: () => queueGame('tictactoe') },
        { ico: '▤', label: 'Connect Four', meta: 'drop discs', act: () => queueGame('connect4') },
      ];
      const html = `<div class="page">
          <div class="hdr">▦ GAME LOBBY</div>
          <div class="list">
            ${items.map((i, k) => `<div class="row${k === S.sel ? ' sel' : ''}" data-idx="${k}">
                <span class="ico">${i.ico}</span><span class="grow">${i.label}</span><span class="meta">${i.meta}</span></div>`).join('')}
          </div>
          <div class="card tiny dim" style="margin-top:10px">
            Turn-based multiplayer. If no one is around, a friendly bot will join in after a few seconds.
            Win = <span class="gold">+25 coins</span>.
          </div>
        </div>`;
      return { html, rows: items.map((i) => i.act), soft: { left: { label: 'Play', act: activate }, right: { label: 'Back', act: back } } };
    },
  };

  async function queueGame(game) {
    show('queue', { game });
    const r = await API.post('/api/queue', { token: S.token, game });
    if (r && r.match) onMatchUpdate({ match: r.match, matched: true });
  }
  async function cancelQueue() {
    const game = (S.data && S.data.game) || 'tictactoe';
    await API.post('/api/cancel', { token: S.token, game });
    back();
  }

  screens.queue = {
    view(d) {
      const html = `<div class="page center" style="padding-top:34px">
          <div class="hdr center">${esc(gameName(d.game))}</div>
          <div class="spinner" id="spin">◐</div>
          <div class="txt center dim" style="margin-top:14px">searching for an opponent<span class="dots"></span></div>
          <div class="txt center tiny dim" style="margin-top:16px">hang tight - a bot joins if it's quiet</div>
        </div>`;
      return {
        html, rows: [],
        soft: { left: null, right: { label: 'Cancel', act: cancelQueue } },
        after: () => {
          const frames = ['◐', '◓', '◑', '◒'];
          let k = 0;
          every(() => { const s = el('spin'); if (s) s.textContent = frames[(k++) % frames.length]; }, 130);
        },
      };
    },
  };

  /* ----------------------------- game board ----------------------------- */

  screens.game = {
    view() {
      const m = S.match;
      if (!m) return { html: '<div class="page txt">no active game</div>', rows: [], soft: { right: { label: 'Back', act: back } } };
      const mySeat = m.seats.find((s) => !s.bot && s.token === S.token);
      const curSeat = m.seats[m.turn];
      const myTurn = m.status === 'playing' && curSeat && !curSeat.bot && curSeat.token === S.token;

      let status;
      if (m.status === 'finished') {
        if (m.winner === null) status = `<span class="gold">It's a draw!</span>`;
        else if (mySeat && m.winner === mySeat.mark) status = `<span class="lime">You win! +25 coins</span>`;
        else status = `<span class="red">You lost. Better luck next time.</span>`;
      } else status = myTurn ? `<span class="lime">Your turn</span>` : `<span class="dim">Waiting for ${esc(curSeat.nick)}<span class="dots"></span></span>`;

      const pcard = (seat) => {
        const isTurn = m.status === 'playing' && m.seats[m.turn] === seat;
        const isMe = mySeat === seat;
        return `<div class="pcard${isTurn ? ' turn' : ''}">
            ${avatarHTML(seat.avatar)}
            <span class="nm">${esc(seat.nick)}${isMe ? ' <span class="dim tiny">(you)</span>' : ''}${seat.bot ? ' <span class="dim tiny">bot</span>' : ''}</span>
          </div>`;
      };

      let boardHTML = '';
      if (m.game === 'tictactoe') {
        boardHTML = `<div class="ttt">${m.board.map((v, i) => {
          const win = m.line && m.line.includes(i);
          return `<div class="cell ${v || ''}${win ? ' win' : ''}${v ? ' taken' : ''}" data-move="${i}">${v || ''}</div>`;
        }).join('')}</div>`;
      } else {
        const winSet = new Set((m.line || []).map(([r, c]) => r + ',' + c));
        boardHTML = `<div class="c4">${m.board.map((col, c) => {
          const slots = [];
          for (let r = 5; r >= 0; r--) {
            const v = col[r] || '';
            const win = winSet.has(r + ',' + c);
            slots.push(`<div class="slot ${v}${win ? ' win' : ''} ${v ? '' : 'empty-hint'}"></div>`);
          }
          return `<div class="col" data-move="${c}">${slots.join('')}</div>`;
        }).join('')}</div>`;
      }

      const html = `<div class="page">
          <div class="hdr">▦ ${esc(gameName(m.game))}</div>
          <div class="players">${pcard(m.seats[0])}${pcard(m.seats[1])}</div>
          <div class="txt center small" style="margin:5px 0 8px">${status}</div>
          ${boardHTML}
          <div class="card tiny dim" style="margin-top:12px">${
            m.status === 'finished'
              ? 'Tap a button below to play again.'
              : (myTurn ? 'Your move - tap a square/column.' : 'Waiting for the opponent...')
          }</div>
        </div>`;

      const left = m.status === 'finished'
        ? { label: 'Rematch', act: () => { S.match = null; queueGame(m.game); } }
        : { label: 'Resign', act: resign };
      return { html, rows: [], soft: { left, right: { label: 'Leave', act: leaveGame } } };
    },
  };

  async function sendMove(move) {
    const m = S.match;
    if (!m || m.status !== 'playing') return;
    const cur = m.seats[m.turn];
    if (!cur || cur.bot || cur.token !== S.token) return;
    sfx.move();
    const r = await API.post('/api/move', { token: S.token, matchId: m.id, move });
    if (r && r.error) { toast(r.error); return; }
    if (r && r.match) { S.match = r.match; draw(); }
  }
  async function resign() {
    if (!S.match) return;
    await API.post('/api/resign', { token: S.token, matchId: S.match.id });
    back();
  }
  function leaveGame() { S.match = null; back(); }

  /* ----------------------------- profile ----------------------------- */

  screens.profile = {
    view() {
      const p = S.profile || {};
      const html = `<div class="page">
          <div class="card hi center" style="padding:14px">
            ${avatarHTML(p.avatar, true)}
            <div class="txt" style="font-size:22px;margin-top:6px">${esc(p.nick || 'guest')}</div>
            <div class="tiny dim">a qeep legend</div>
          </div>
          <div class="list">
            <div class="row"><span class="ico gold">◆</span><span class="grow">Coins</span><span class="meta gold">${p.coins ?? 0}</span></div>
            <div class="row"><span class="ico lime">▲</span><span class="grow">Wins</span><span class="meta">${p.wins ?? 0}</span></div>
            <div class="row"><span class="ico red">▼</span><span class="grow">Losses</span><span class="meta">${p.losses ?? 0}</span></div>
            <div class="row"><span class="ico dim">=</span><span class="grow">Draws</span><span class="meta">${p.draws ?? 0}</span></div>
          </div>
          <div class="btnrow"><button class="btn" data-act="leaderboard">View leaderboard</button></div>
        </div>`;
      return { html, rows: [], soft: { right: { label: 'Back', act: back } } };
    },
  };

  /* ----------------------------- leaderboard ----------------------------- */

  screens.top = {
    view() {
      return {
        html: `<div class="page">
            <div class="hdr">★ TOP PLAYERS</div>
            <div class="list" id="topList"><div class="row"><span class="meta">loading...</span></div></div>
            <div class="card tiny dim" id="topMeta"></div>
          </div>`,
        rows: [],
        soft: { right: { label: 'Back', act: back } },
        after: loadTop,
      };
    },
  };
  async function loadTop() {
    const r = await API.get('/api/leaderboard');
    const box = el('topList');
    if (!box) return;
    if (!r.top || !r.top.length) { box.innerHTML = '<div class="row"><span class="meta">no players yet</span></div>'; }
    else {
      box.innerHTML = r.top.map((p, i) => `<div class="row">
          <span class="ico">${i + 1}</span>${avatarHTML(p.avatar)}
          <span class="grow">${esc(p.nick)}</span>
          <span class="meta gold">${p.wins}W</span>
        </div>`).join('');
    }
    const meta = el('topMeta');
    if (meta) meta.innerHTML = `${r.online || 0} online now · coins: <span class="gold">◆</span> earned by winning`;
  }

  /* ----------------------------- about ----------------------------- */

  screens.about = {
    view() {
      return {
        html: `<div class="page">
            <div class="hdr">? ABOUT</div>
            <div class="txt small">A loving revival of <span class="lime">qeep</span>, the mobile social network that ran on Java (J2ME) phones back in the day.</div>
            <div class="card small dim" style="margin-top:10px">
              <b class="lime">Controls</b><br>
              • Arrow keys = navigate<br>
              • Enter / OK = select<br>
              • Esc = back<br>
              • Type on the keypad or keyboard to chat<br>
              • Click the qeep logo to toggle sound
            </div>
            <div class="card tiny dim">
              Original qeep had chat, photoblogs, multiplayer mini-games and coins.
              This rebuild keeps the soul: chat rooms, turn-based games, and coins.
            </div>
          </div>`,
        rows: [],
        soft: { right: { label: 'Back', act: back } },
      };
    },
  };

  /* ----------------------------- navigation ----------------------------- */

  function show(name, data = {}, push = false) {
    if (push) S.stack.push({ screen: S.screen, data: S.data });
    S.screen = name;
    S.data = data || {};
    S.sel = 0;
    draw();
  }
  function back() {
    sfx.back();
    if (S.stack.length) {
      const prev = S.stack.pop();
      S.screen = prev.screen; S.data = prev.data; S.sel = 0;
      draw();
    } else if (S.profile && S.screen !== 'home') {
      show('home');
    }
  }
  function activate() {
    const fn = S.rows[S.sel];
    if (typeof fn === 'function') { sfx.ok(); fn(); }
  }
  function moveSel(delta) {
    if (!S.rows.length) return;
    const next = Math.min(S.rows.length - 1, Math.max(0, S.sel + delta));
    if (next === S.sel) return;
    S.sel = next;
    sfx.nav();
    updateSelection();
  }
  function updateSelection() {
    document.querySelectorAll('#app .row').forEach((r) => {
      const i = Number(r.dataset.idx);
      const on = i === S.sel && !Number.isNaN(i);
      r.classList.toggle('sel', on);
      if (on) r.scrollIntoView({ block: 'nearest' });
    });
  }
  function updateSoft() {
    const L = S.soft.left, R = S.soft.right;
    const l = el('softLeft'), r = el('softRight');
    l.textContent = L ? L.label : '';
    l.disabled = !L;
    r.textContent = R ? R.label : '';
    r.disabled = !R;
  }
  function draw() {
    clearTimers();
    const def = screens[S.screen] || screens.home;
    const v = def.view(S.data) || {};
    el('app').innerHTML = v.html || '';
    S.rows = v.rows || [];
    S.soft = v.soft || {};
    if (S.sel >= S.rows.length) S.sel = Math.max(0, S.rows.length - 1);
    updateSelection();
    updateSoft();
    if (typeof v.after === 'function') v.after();
  }

  function toast(text) {
    const t = document.createElement('div');
    t.textContent = text;
    t.style.cssText = 'position:absolute;left:50%;bottom:56px;transform:translateX(-50%);background:#a6ff2e;color:#06281a;font-family:VT323,monospace;font-size:17px;padding:3px 10px;border-radius:3px;z-index:50;box-shadow:0 2px 8px rgba(0,0,0,.5)';
    el('screen').appendChild(t);
    setTimeout(() => t.remove(), 1300);
  }

  /* ----------------------------- events ----------------------------- */

  function connectEvents() {
    if (S.es) S.es.close();
    const es = new EventSource('/events?token=' + encodeURIComponent(S.token));
    S.es = es;
    es.onmessage = (e) => { try { handleEvent(JSON.parse(e.data)); } catch (_) {} };
    es.onerror = () => { /* EventSource auto-reconnects */ };
  }

  function handleEvent(ev) {
    switch (ev.type) {
      case 'hello':
        S.online = ev.online;
        break;
      case 'chat':
        if (S.screen === 'chat' && S.chatRoom === ev.room) { appendMessage(ev.room, ev.msg); sfx.msg(); }
        else appendMessage(ev.room, ev.msg);
        if (S.screen === 'home' || S.screen === 'rooms') draw();
        break;
      case 'matchUpdate':
        onMatchUpdate(ev);
        break;
      case 'profile':
        S.profile = ev.profile;
        if (S.screen === 'home' || S.screen === 'profile') draw();
        break;
      default: break;
    }
  }

  function onMatchUpdate(ev) {
    const m = ev.match;
    if (!m) return;
    const mine = m.seats.some((s) => !s.bot && s.token === S.token);
    if (!mine) return;
    S.match = m;
    if (ev.matched) { sfx.ok(); show('game'); return; }
    if (S.screen === 'game') {
      draw();
      if (m.status === 'finished') {
        const mySeat = m.seats.find((s) => !s.bot && s.token === S.token);
        if (m.winner && mySeat && m.winner === mySeat.mark) sfx.win(); else sfx.lose();
      }
    }
  }

  /* ----------------------------- input ----------------------------- */

  async function pressKey(key) {
    const typing = isTyping();
    if (key === 'up') { if (!typing) moveSel(-1); return; }
    if (key === 'down') { if (!typing) moveSel(1); return; }
    if (key === 'ok') { if (typing) submitTyping(); else activate(); return; }
    if (key === 'left') { if (!typing && S.soft.left) { sfx.ok(); S.soft.left.act(); } return; }
    if (key === 'right') { if (!typing) back(); return; }
  }

  function isTyping() {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  }
  function submitTyping() {
    const a = document.activeElement;
    if (a && a.id === 'loginName') submitLogin();
    else if (a && a.id === 'chatInput') sendChat();
  }

  /* on-screen keypad types into the focused field (T9 vibes) */
  function keypadChar(k) {
    const a = document.activeElement;
    const inp = (a && a.tagName === 'INPUT') ? a : (document.querySelector('#app input') || null);
    if (!inp) return;
    if (k === '#') return;
    inp.focus();
    inp.value += k;
    sfx.nav();
  }

  document.addEventListener('keydown', (e) => {
    if (e.target && e.target.id === 'loginName' || e.target && e.target.id === 'chatInput') {
      if (e.key === 'Enter') { e.preventDefault(); submitTyping(); }
      else if (e.key === 'Escape') { e.preventDefault(); back(); }
      return;
    }
    if (isTyping()) return;
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ok', ' ': 'ok', Escape: 'right', Backspace: 'right' };
    const key = map[e.key];
    if (key) { e.preventDefault(); pressKey(key); }
  });

  document.addEventListener('click', (e) => {
    const k = e.target.closest('[data-key]');
    if (k) {
      // keypad digit keys
      if (/^[0-9*#]$/.test(k.dataset.key)) return keypadChar(k.dataset.key);
      return pressKey(k.dataset.key);
    }
    const act = e.target.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'random') { const i = el('loginName'); if (i) i.value = randomNick(); return; }
      if (a === 'leaderboard') return show('top', {}, true);
      return;
    }
    const row = e.target.closest('#app .row[data-idx]');
    if (row) {
      S.sel = Number(row.dataset.idx);
      updateSelection();
      activate();
      return;
    }
    const mv = e.target.closest('[data-move]');
    if (mv) { sendMove(Number(mv.dataset.move)); return; }
  });

  document.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.id === 'loginForm') submitLogin();
    else if (e.target.id === 'chatForm') sendChat();
  });

  el('softLeft').addEventListener('click', () => { if (S.soft.left) { sfx.ok(); S.soft.left.act(); } });
  el('softRight').addEventListener('click', () => back());
  document.querySelector('.statusbar .sbrand').addEventListener('click', (e) => {
    S.sound = !S.sound;
    localStorage.setItem('qeep.sound', S.sound ? 'on' : 'off');
    e.target.style.opacity = S.sound ? '1' : '.35';
    if (S.sound) sfx.ok();
  });

  /* ----------------------------- go ----------------------------- */

  document.querySelector('.statusbar .sbrand').style.opacity = S.sound ? '1' : '.35';
  draw();
})();
