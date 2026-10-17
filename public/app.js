/* ============================================================
   qeep revival v2 - front-end
   ============================================================ */
(() => {
  'use strict';

  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ----------------------------- content ----------------------------- */

  let CONTENT = {
    avatars: [{ id: 1, ch: '☺', c: '#a6ff2e' }],
    titles: [{ id: 'rookie', name: 'Rookie', cost: 0 }],
    badges: [], shop: [], rooms: [],
  };
  let GAMEMETA = [
    { id: 'tictactoe', name: 'Tic-Tac-Toe', icon: '✕', blurb: 'Three in a row' },
    { id: 'connect4', name: 'Connect Four', icon: '▤', blurb: 'Four in a line' },
    { id: 'reversi', name: 'Reversi', icon: '◐', blurb: 'Flip to win' },
    { id: 'nim', name: 'Nim', icon: '⚱', blurb: 'Take the last to win' },
    { id: 'rps', name: 'Rock Paper Scissors', icon: '✊', blurb: 'Best of three' },
    { id: 'quiz', name: 'Retro Quiz', icon: '?', blurb: 'Trivia showdown' },
  ];

  function avInfo(n) { return CONTENT.avatars.find((a) => a.id === Number(n)) || CONTENT.avatars[0]; }
  function avatarHTML(n, big) { const a = avInfo(n); return `<span class="av${big ? ' big' : ''}" style="background:${a.c}">${a.ch}</span>`; }
  function titleName(id) { const t = CONTENT.titles.find((x) => x.id === id); return t ? t.name : ''; }
  function badgeInfo(id) { return CONTENT.badges.find((b) => b.id === id) || { icon: '?', name: id, desc: '' }; }
  function gameMeta(id) { return GAMEMETA.find((g) => g.id === id) || { name: id, icon: '▦' }; }

  /* ----------------------------- api ----------------------------- */

  const API = {
    async post(path, body) {
      try {
        const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return await r.json();
      } catch { return {}; }
    },
    async get(path) { try { return await (await fetch(path)).json(); } catch { return {}; } },
  };

  /* ----------------------------- sound ----------------------------- */

  let actx = null;
  function beep(freq = 440, dur = 0.05, type = 'square', vol = 0.032) {
    if (!S.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = freq; g.gain.value = vol;
      o.connect(g); g.connect(actx.destination); o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.stop(actx.currentTime + dur);
    } catch (_) {}
  }
  const sfx = {
    nav: () => beep(600, 0.03, 'square', 0.018),
    ok: () => beep(820, 0.05),
    back: () => beep(280, 0.05),
    msg: () => { beep(950, 0.035); setTimeout(() => beep(1250, 0.05), 55); },
    move: () => beep(500, 0.04),
    win: () => [660, 880, 1180].forEach((f, i) => setTimeout(() => beep(f, 0.09), i * 90)),
    lose: () => [420, 300, 210].forEach((f, i) => setTimeout(() => beep(f, 0.1, 'sawtooth'), i * 110)),
    coin: () => { beep(1200, 0.04); setTimeout(() => beep(1600, 0.06), 60); },
    badge: () => [700, 950, 1250, 1550].forEach((f, i) => setTimeout(() => beep(f, 0.08), i * 70)),
    boot: () => [320, 500, 700, 950].forEach((f, i) => setTimeout(() => beep(f, 0.07), i * 85)),
  };

  /* ----------------------------- state ----------------------------- */

  const S = {
    token: localStorage.getItem('qeep.token') || null,
    profile: null, screen: 'boot', data: {}, sel: 0, rows: [], soft: {}, stack: [],
    rooms: [], threads: [], unreadDm: 0, online: 0, unread: {},
    match: null, history: {}, chatRoom: null, dmWith: null,
    sound: localStorage.getItem('qeep.sound') !== 'off', es: null, edit: {},
  };

  let timers = [];
  const every = (fn, ms) => { const t = setInterval(fn, ms); timers.push(t); return t; };
  const clearTimers = () => { timers.forEach(clearInterval); timers = []; };

  const ROOM_FALLBACK = { lobby: 'The Lobby', sayhi: 'Say Hi', gamers: 'Game Central', retro: 'Retro Corner', helpline: 'Help Desk' };
  const roomName = (id) => (S.rooms.find((r) => r.id === id) || {}).name || ROOM_FALLBACK[id] || id;
  const me = () => S.profile || { nick: 'guest', coins: 0, level: 1, xp: 0, xpPrev: 0, xpNext: 100, badges: [], owned: [], friends: [], reqIn: [], reqOut: [] };
  const meIndex = (m) => m.seats.findIndex((s) => !s.bot && s.token === S.token);

  /* ----------------------------- shared bits ----------------------------- */

  function xpBarHTML(p) {
    const span = Math.max(1, (p.xpNext || 100) - (p.xpPrev || 0));
    const pct = Math.max(0, Math.min(100, Math.round(((p.xp || 0) - (p.xpPrev || 0)) / span * 100)));
    return `<div class="xpwrap"><div class="xpbar"><i style="width:${pct}%"></i></div>
      <div class="tiny dim">LVL ${p.level} · ${(p.xp || 0) - (p.xpPrev || 0)}/${span} xp</div></div>`;
  }

  function rowHTML(i, k, sel) {
    return `<div class="row${k === sel ? ' sel' : ''}" data-idx="${k}">
      <span class="ico">${i.ico || ''}</span>
      <span class="grow">${i.label}</span>
      ${i.badge ? `<span class="badge">${i.badge}</span>` : `<span class="meta">${i.meta || ''}</span>`}
    </div>`;
  }

  function listView(items, soft, extraHTML, key) {
    const html = `<div class="page">${extraHTML || ''}
      <div class="list">${items.map((i, k) => rowHTML(i, k, S.sel)).join('')}</div></div>`;
    return { html, rows: items.map((i) => i.act), soft: soft, key };
  }

  /* ----------------------------- boot ----------------------------- */

  const screens = {};

  screens.boot = {
    view() {
      return {
        html: `<div class="page center" style="padding-top:40px">
            <div class="hdr center" style="font-size:24px;color:var(--lime);text-shadow:0 0 16px rgba(166,255,46,.6)">qeep</div>
            <div class="txt dim center small">mobile social · revival v2</div>
            <div class="bar" style="margin-top:30px"><i id="bootbar"></i></div>
            <div class="txt center dim small" id="bootmsg">loading midlet...</div>
          </div>`,
        rows: [], soft: { left: null, right: null }, after: runBoot,
      };
    },
  };

  function runBoot() {
    const steps = [['loading midlet...', 20], ['starting KVM...', 44], ['opening GPRS link...', 68], ['syncing profile...', 90]];
    let i = 0;
    const bar = el('bootbar'), msg = el('bootmsg');
    every(() => {
      if (i < steps.length) {
        if (bar) bar.style.width = steps[i][1] + '%';
        if (msg) msg.textContent = steps[i][0];
        i++;
      } else { clearTimers(); if (bar) bar.style.width = '100%'; sfx.boot(); setTimeout(finishBoot, 300); }
    }, 260);
  }

  async function finishBoot() {
    if (S.token) {
      const r = await API.post('/api/join', { token: S.token });
      if (r && r.player) { applyState(r); connectEvents(); show('home'); refreshState(); return; }
    }
    if (S.profile) return show('home');
    show('login');
  }

  function applyState(r) {
    if (!r) return;
    if (r.player) S.profile = r.player;
    if (r.rooms) S.rooms = r.rooms;
    if (r.threads) S.threads = r.threads;
    if (typeof r.unreadDm === 'number') S.unreadDm = r.unreadDm;
    if (typeof r.online === 'number') S.online = r.online;
  }

  async function refreshState() {
    const r = await API.post('/api/state', { token: S.token });
    if (r && r.player) { applyState(r); if (isLiveScreen()) draw(); }
  }
  const LIVE = new Set(['home', 'friends', 'messages', 'profile', 'badges', 'shop', 'top']);
  const isLiveScreen = () => LIVE.has(S.screen);

  /* ----------------------------- login ----------------------------- */

  const NICK_POOL = ['SnakeKing', 'NokiaBoy', 'S60Fan', 'GprsGuru', 'MissMms', 'BluetoothBae', 'PolyBoi', 'JavaJunkie', 'WapWizard', 'EdgeEnjoyer'];
  const randomNick = () => NICK_POOL[Math.floor(Math.random() * NICK_POOL.length)] + (10 + Math.floor(Math.random() * 89));

  screens.login = {
    view() {
      return {
        html: `<div class="page">
            <div class="hdr center" style="font-size:15px;color:var(--lime)">qeep</div>
            <div class="txt center dim small">choose a nickname to sign in</div>
            <form id="loginForm" autocomplete="off">
              <div class="field"><span class="cur">_</span>
                <input id="loginName" maxlength="14" placeholder="nickname" autocomplete="off"></div>
              <div class="btnrow">
                <button class="btn primary" type="submit">Sign in ▶</button>
                <button class="btn" type="button" data-act="random">Random</button></div>
            </form>
            <div class="card tiny dim" style="margin-top:14px">
              ${S.online || 0} online · ${GAMEMETA.length} games · chat, friends, DMs, coins and badges.
            </div></div>`,
        rows: [], soft: { left: { label: 'Sign in', act: submitLogin }, right: null },
        after: () => el('loginName') && el('loginName').focus(),
      };
    },
  };

  function submitLogin() { const i = el('loginName'); doLogin((i && i.value.trim()) || randomNick()); }
  async function doLogin(nick) {
    const r = await API.post('/api/join', { nick });
    if (!r || !r.player) return;
    S.token = r.player.token; localStorage.setItem('qeep.token', S.token);
    applyState(r); sfx.ok(); connectEvents(); show('home'); refreshState();
  }
  function logout() {
    localStorage.removeItem('qeep.token');
    if (S.es) { S.es.close(); S.es = null; }
    S.token = null; S.profile = null; S.stack = []; S.match = null;
    show('login');
  }

  /* ----------------------------- home ----------------------------- */

  screens.home = {
    view() {
      const p = me();
      const items = [
        { ico: '✉', label: 'Chat rooms', meta: 'meet people', act: () => show('rooms', {}, true) },
        { ico: '▦', label: 'Games', meta: GAMEMETA.length + ' to play', act: () => show('games', {}, true) },
        { ico: '☺', label: 'Friends', badge: p.reqIn.length || 0, meta: p.friends.length + ' friends', act: () => show('friends', {}, true) },
        { ico: '✎', label: 'Messages', badge: S.unreadDm || 0, meta: 'private chat', act: () => show('messages', {}, true) },
        { ico: '☀', label: 'Daily bonus', meta: 'streak ' + (p.streak || 0), act: doDaily },
        { ico: '◆', label: 'Shop', meta: 'avatars & titles', act: () => show('shop', {}, true) },
        { ico: '★', label: 'Leaderboard', meta: 'top players', act: () => show('top', {}, true) },
        { ico: '⚑', label: 'My profile', meta: p.nick, act: () => show('profile', {}, true) },
        { ico: '?', label: 'About / controls', act: () => show('about', {}, true) },
      ];
      const extra = `<div class="card hi">
          <div style="display:flex;align-items:center;gap:9px">
            ${avatarHTML(p.avatar, true)}
            <div style="flex:1;min-width:0">
              <div class="txt" style="font-size:19px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.nick)}</div>
              <div class="tiny lime">${esc(titleName(p.title) || 'Rookie')}</div>
              ${xpBarHTML(p)}
            </div>
            <div class="center">
              <div class="txt gold" style="font-size:19px">${p.coins}</div>
              <div class="tiny dim">coins</div>
              <div class="tiny dim" style="margin-top:3px">${S.online} online</div>
            </div>
          </div>
        </div>`;
      return listView(items, { left: { label: 'Select', act: activate }, right: { label: 'Log out', act: logout } }, extra);
    },
  };

  async function doDaily() {
    const r = await API.post('/api/daily', { token: S.token });
    if (r.error) { toast(r.error); return; }
    sfx.coin();
    S.profile = r.profile;
    toast(`Daily bonus: +${r.amount} coins (streak ${r.streak})`);
    draw();
  }

  /* ----------------------------- rooms + chat ----------------------------- */

  screens.rooms = {
    view() {
      const rooms = S.rooms.length ? S.rooms : Object.keys(ROOM_FALLBACK).map((id) => ({ id, name: ROOM_FALLBACK[id] }));
      const items = rooms.map((r) => ({ ico: '#', label: r.name, meta: r.topic || '', badge: S.unread[r.id] || 0, act: () => show('chat', { room: r.id }, true) }));
      return listView(items, { left: { label: 'Open', act: activate }, right: { label: 'Back', act: back } },
        `<div class="hdr">✉ CHAT ROOMS</div><div class="card tiny dim">${S.online} online now. Try <span class="lime">/me</span>, <span class="lime">/roll</span> or <span class="lime">/help</span>.</div>`);
    },
  };

  screens.chat = {
    view(d) {
      S.chatRoom = d.room; S.unread[d.room] = 0;
      return {
        html: `<div class="chat">
            <div class="hdr" style="margin:0;padding:6px 10px 4px;border-bottom:1px solid #0d3b36"># ${esc(roomName(d.room))}</div>
            <div class="msgs" id="msgs"><div class="txt dim small">loading...</div></div>
            <form id="chatForm" class="field" style="margin:0;border-left:none;border-right:none;border-bottom:none;border-radius:0">
              <span class="cur">_</span>
              <input id="chatInput" maxlength="200" placeholder="say something... (/help)" autocomplete="off" autocapitalize="off">
              <button class="btn primary" type="submit" style="padding:1px 9px">▶</button></form></div>`,
        rows: [],
        soft: { left: { label: 'Send', act: () => sendChat() }, right: { label: 'Back', act: back } },
        after: async () => {
          const r = await API.post('/api/history', { token: S.token, room: d.room });
          S.history[d.room] = (r && r.messages) || [];
          renderMessages(d.room);
          const i = el('chatInput'); if (i) i.focus();
        },
      };
    },
  };

  function msgHTML(m) {
    const mine = m.from && S.profile && m.from === S.profile.token;
    if (m.system) return `<div class="msg sys">— ${esc(m.text)} —</div>`;
    return `<div class="msg${mine ? ' mine' : ''}">${avatarHTML(m.avatar)}
      <span class="who">${esc(m.nick)}</span>
      <span class="t">${new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><br>${esc(m.text)}</div>`;
  }
  function renderMessages(room) {
    const box = el('msgs'); if (!box) return;
    const list = S.history[room] || [];
    box.innerHTML = list.length ? list.map(msgHTML).join('') : '<div class="txt dim small">no messages yet — say hi!</div>';
    box.scrollTop = box.scrollHeight;
  }
  function appendMessage(room, m) {
    (S.history[room] = S.history[room] || []).push(m);
    if (S.screen === 'chat' && S.chatRoom === room) {
      const box = el('msgs');
      if (box) { if (box.querySelector('.dim')) box.innerHTML = ''; box.insertAdjacentHTML('beforeend', msgHTML(m)); box.scrollTop = box.scrollHeight; }
    }
  }
  async function sendChat() {
    const inp = el('chatInput'); if (!inp) return;
    const text = inp.value.trim(); if (!text) return;
    inp.value = '';
    const r = await API.post('/api/chat', { token: S.token, room: S.chatRoom, text });
    if (r.error) toast(r.error);
  }

  /* ----------------------------- direct messages ----------------------------- */

  screens.messages = {
    view() {
      const items = S.threads.map((t) => ({
        ico: t.online ? '●' : '○', label: t.nick, badge: t.unread || 0,
        meta: t.last ? (t.last.mine ? 'you: ' : '') + t.last.text.slice(0, 18) : '',
        act: () => show('dm', { token: t.token, nick: t.nick, avatar: t.avatar }, true),
      }));
      items.push({ ico: '+', label: 'New message', meta: 'pick a friend', act: () => show('friends', {}, true) });
      return listView(items, { left: { label: 'Open', act: activate }, right: { label: 'Back', act: back } },
        '<div class="hdr">✎ MESSAGES</div>');
    },
  };

  screens.dm = {
    view(d) {
      S.dmWith = d.token;
      return {
        html: `<div class="chat">
            <div class="hdr" style="margin:0;padding:6px 10px 4px;border-bottom:1px solid #0d3b36">✎ ${esc(d.nick)}</div>
            <div class="msgs" id="dmsgs"><div class="txt dim small">loading...</div></div>
            <form id="dmForm" class="field" style="margin:0;border-left:none;border-right:none;border-bottom:none;border-radius:0">
              <span class="cur">_</span>
              <input id="dmInput" maxlength="200" placeholder="message..." autocomplete="off">
              <button class="btn primary" type="submit" style="padding:1px 9px">▶</button></form></div>`,
        rows: [],
        soft: { left: { label: 'Send', act: () => sendDM() }, right: { label: 'Back', act: back } },
        after: async () => {
          const r = await API.post('/api/dm/history', { token: S.token, with: d.token });
          renderDMs(r && r.messages);
          const i = el('dmInput'); if (i) i.focus();
          refreshState();
        },
      };
    },
  };

  function renderDMs(list) {
    const box = el('dmsgs'); if (!box) return;
    box.innerHTML = (list && list.length) ? list.map((m) => {
      const mine = m.from === S.token;
      return `<div class="msg${mine ? ' mine' : ''}">${avatarHTML(mine ? (S.profile || {}).avatar : (S.data.avatar || 1))}
        <span class="who">${esc(mine ? 'you' : (S.data.nick || 'them'))}</span>
        <span class="t">${new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><br>${esc(m.text)}</div>`;
    }).join('') : '<div class="txt dim small">no messages yet</div>';
    box.scrollTop = box.scrollHeight;
  }
  async function sendDM() {
    const inp = el('dmInput'); if (!inp) return;
    const text = inp.value.trim(); if (!text) return;
    inp.value = '';
    const r = await API.post('/api/dm', { token: S.token, to: S.dmWith, text });
    if (r.error) toast(r.error);
    else {
      const box = el('dmsgs');
      if (box) { if (box.querySelector('.dim')) box.innerHTML = ''; box.insertAdjacentHTML('beforeend', `<div class="msg mine">${avatarHTML((S.profile||{}).avatar)}<span class="who">you</span> <span class="t">now</span><br>${esc(text)}</div>`); box.scrollTop = box.scrollHeight; }
    }
  }

  /* ----------------------------- friends ----------------------------- */

  screens.friends = {
    view() {
      const p = me();
      const items = [];
      if (p.reqIn && p.reqIn.length) {
        items.push({ ico: '!', label: 'Requests (' + p.reqIn.length + ')', meta: 'tap to review', act: () => show('friendAdd', {}, true) });
      }
      items.push({ ico: '+', label: 'Add a friend', meta: 'search by nickname', act: () => show('friendAdd', {}, true) });
      for (const f of (p.friends || [])) {
        items.push({ ico: f.online ? '●' : '○', label: f.nick, meta: 'lvl ' + f.level + (f.online ? ' · online' : ''), act: () => show('friend', { token: f.token, nick: f.nick, avatar: f.avatar, level: f.level, online: f.online }, true) });
      }
      const extra = `<div class="hdr">☺ FRIENDS</div>${items.length > 2 ? '' : '<div class="card tiny dim">No friends yet. Tap <b>Add a friend</b> and search a nickname, or meet people in <b>Chat</b>.</div>'}`;
      return listView(items, { left: { label: 'Open', act: activate }, right: { label: 'Back', act: back } }, extra);
    },
  };

  screens.friendAdd = {
    view() {
      const p = me();
      const reqs = p.reqIn || [];
      const html = `<div class="page">
          <div class="hdr">+ ADD FRIEND</div>
          <form id="findForm" autocomplete="off">
            <div class="field"><span class="cur">_</span><input id="findName" maxlength="14" placeholder="their nickname" autocomplete="off"></div>
            <div class="btnrow"><button class="btn primary" type="submit">Search ▶</button></div>
          </form>
          <div id="findResult"></div>
          ${reqs.length ? `<div class="hdr" style="margin-top:12px">REQUESTS (${reqs.length})</div>
          <div class="list">${reqs.map((r) => `<div class="row">
            <span class="ico">!</span>${avatarHTML(r.avatar)}<span class="grow">${esc(r.nick)}</span>
            <span class="meta lime" data-act="accept" data-token="${r.token}">accept</span></div>`).join('')}</div>` : ''}
        </div>`;
      return { html, rows: [], soft: { left: null, right: { label: 'Back', act: back } }, after: () => el('findName') && el('findName').focus() };
    },
  };

  screens.friend = {
    view(d) {
      const html = `<div class="page">
          <div class="card hi center" style="padding:12px">
            ${avatarHTML(d.avatar, true)}
            <div class="txt" style="font-size:20px;margin-top:5px">${esc(d.nick)}</div>
            <div class="tiny dim">level ${d.level} · ${d.online ? '<span class="lime">online</span>' : 'offline'}</div>
          </div>
          <div class="list">
            <div class="row" data-act="dm"><span class="ico">✎</span><span class="grow">Send message</span><span class="meta">›</span></div>
            <div class="row" data-act="gift"><span class="ico gold">◆</span><span class="grow">Gift coins</span><span class="meta">›</span></div>
            <div class="row" data-act="unfriend"><span class="ico red">✕</span><span class="grow">Remove friend</span><span class="meta">›</span></div>
          </div>
          <div class="card tiny dim">Tip: you can gift coins from your balance. Generosity is noticed.</div>
        </div>`;
      return { html, rows: [], soft: { right: { label: 'Back', act: back } } };
    },
  };

  /* ----------------------------- games ----------------------------- */

  screens.games = {
    view() {
      const items = GAMEMETA.map((g) => ({ ico: g.icon, label: g.name, meta: g.blurb, act: () => queueGame(g.id) }));
      return listView(items, { left: { label: 'Play', act: activate }, right: { label: 'Back', act: back } },
        `<div class="hdr">▦ GAME LOBBY</div><div class="card tiny dim">Turn-based multiplayer. A bot joins if nobody is around. Win = <span class="gold">+30 coins</span> + XP.</div>`);
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
          <div class="hdr center">${esc(gameMeta(d.game).name)}</div>
          <div class="spinner" id="spin">◐</div>
          <div class="txt center dim" style="margin-top:12px">searching for an opponent<span class="dots"></span></div>
          <div class="txt center tiny dim" style="margin-top:14px">a bot joins if it stays quiet</div></div>`;
      return {
        html, rows: [], soft: { left: null, right: { label: 'Cancel', act: cancelQueue } },
        after: () => { const f = ['◐', '◓', '◑', '◒']; let k = 0; every(() => { const s = el('spin'); if (s) s.textContent = f[(k++) % f.length]; }, 130); },
      };
    },
  };

  /* ---------- game board rendering ---------- */

  const RPS_ICON = { rock: '✊', paper: '✋', scissors: '✌' };

  function canAct(m, mi) {
    if (m.status !== 'playing') return false;
    if (m.game === 'rps') return m.board.picks[mi] == null;
    return m.turn === mi && !m.seats[m.turn].bot;
  }

  function statusText(m, mi) {
    if (m.status === 'finished') {
      const myMark = m.seats[mi] ? m.seats[mi].mark : null;
      if (m.winner === null) return '<span class="gold">Draw!</span>';
      return m.winner === myMark ? '<span class="lime">You win! +30 coins</span>' : '<span class="red">You lost. Rematch?</span>';
    }
    if (m.game === 'rps') return m.board.picks[mi] == null ? '<span class="lime">Make your pick</span>' : '<span class="dim">Waiting for opponent<span class="dots"></span></span>';
    if (m.turn === mi) return '<span class="lime">Your turn</span>';
    const cur = m.seats[m.turn];
    return `<span class="dim">Waiting for ${esc(cur.nick)}${cur.bot ? ' (bot)' : ''}<span class="dots"></span></span>`;
  }

  function boardHTML(m, mi) {
    if (m.game === 'tictactoe') {
      return `<div class="ttt">${m.board.map((v, i) => `<div class="cell ${v || ''}${m.line && m.line.includes(i) ? ' win' : ''}${v ? ' taken' : ''}" data-move="${i}">${v || ''}</div>`).join('')}</div>`;
    }
    if (m.game === 'connect4') {
      const win = new Set((m.line || []).map(([r, c]) => r + ',' + c));
      return `<div class="c4">${m.board.map((col, c) => {
        const slots = [];
        for (let r = 5; r >= 0; r--) { const v = col[r] || ''; slots.push(`<div class="slot ${v}${win.has(r + ',' + c) ? ' win' : ''} ${v ? '' : 'empty-hint'}"></div>`); }
        return `<div class="col" data-move="${c}">${slots.join('')}</div>`;
      }).join('')}</div>`;
    }
    if (m.game === 'reversi') {
      const counts = m.extra && m.extra.count;
      return `<div class="reversi">${m.board.map((v, i) => `<div class="sq" data-move="${i}"><div class="disc ${v || ''}"></div></div>`).join('')}</div>
        <div class="txt center small">${counts ? `black ${counts.B} · white ${counts.W}` : 'flip your opponent\'s discs'}</div>`;
    }
    if (m.game === 'nim') {
      return `<div class="nim">${m.board.piles.map((n, p) => `<div class="pile">${Array.from({ length: n }, (_, k) => `<span class="stone" data-move='{"p":${p},"take":${n - k}}'></span>`).join('') || '<span class="tiny dim">empty</span>'}</div>`).join('')}</div>
        <div class="txt center tiny dim">tap a stone to take it and everything to its right</div>`;
    }
    if (m.game === 'rps') {
      const picks = m.board.picks, rev = m.board.reveal;
      const other = 1 - mi;
      const othersPicked = picks[other] != null;
      return `<div class="rps">
        <div class="score big">${m.board.score[mi]} <span class="dim">-</span> ${m.board.score[other]}</div>
        <div class="tiny dim center">round ${m.board.round} · first to 2</div>
        <div class="choices">${['rock', 'paper', 'scissors'].map((c) => `<button class="btn rpsbtn${picks[mi] === c ? ' primary' : ''}" data-move="${c}" ${canAct(m, mi) ? '' : 'disabled'}>${RPS_ICON[c]}</button>`).join('')}</div>
        <div class="center tiny">${picks[mi] ? 'you picked ' + RPS_ICON[picks[mi]] : 'pick one'} · ${othersPicked ? 'opponent is ready' : 'waiting...'}</div>
        ${rev ? `<div class="card center">${RPS_ICON[rev.picks[0]]} vs ${RPS_ICON[rev.picks[1]]} — ${rev.winner === -1 ? 'draw' : (rev.winner === mi ? '<span class="lime">you won the round</span>' : '<span class="red">you lost the round</span>')}</div>` : ''}
      </div>`;
    }
    if (m.game === 'quiz') {
      const b = m.board;
      if (!b.question) return '<div class="txt center dim">quiz over</div>';
      return `<div class="quiz">
        <div class="score">you ${b.scores[mi]} <span class="dim">-</span> ${b.scores[1 - mi]} them</div>
        <div class="tiny dim center">question ${Math.min(b.qi + 1, b.total)} of ${b.total}</div>
        <div class="q">${esc(b.question.q)}</div>
        <div class="opts">${b.question.o.map((o, i) => `<button class="btn opt" data-move="${i}" ${canAct(m, mi) ? '' : 'disabled'}>${esc(o)}</button>`).join('')}</div>
        ${b.lastResult ? `<div class="card tiny ${b.lastResult.correct ? 'lime' : 'red'}">${esc(b.lastResult.nick)} answered "${esc(b.lastResult.picked)}" — ${b.lastResult.correct ? 'correct!' : 'wrong, it was "' + esc(b.lastResult.answer) + '"'}</div>` : ''}
      </div>`;
    }
    return '';
  }

  screens.game = {
    view() {
      const m = S.match;
      if (!m) return { html: '<div class="page txt">no active game</div>', rows: [], soft: { right: { label: 'Back', act: back } } };
      const mi = meIndex(m);
      const pcard = (seat) => {
        const isTurn = m.status === 'playing' && m.seats[m.turn] === seat && m.game !== 'rps';
        const isMe = mi >= 0 && m.seats[mi] === seat;
        return `<div class="pcard${isTurn ? ' turn' : ''}">${avatarHTML(seat.avatar)}
          <span class="nm">${esc(seat.nick)}${isMe ? ' <span class="dim tiny">(you)</span>' : ''}${seat.bot ? ' <span class="dim tiny">bot</span>' : ''}</span></div>`;
      };
      const html = `<div class="page">
          <div class="hdr">▦ ${esc(gameMeta(m.game).name)}</div>
          <div class="players">${pcard(m.seats[0])}${pcard(m.seats[1])}</div>
          <div class="txt center small" style="margin:5px 0 8px">${statusText(m, mi)}</div>
          <div class="board">${boardHTML(m, mi)}</div>
          ${m.extra && m.extra.passed && m.status === 'playing' ? `<div class="card tiny dim">${esc(m.extra.passed)} had no legal move — turn passed.</div>` : ''}
        </div>`;
      const left = m.status === 'finished'
        ? { label: 'Rematch', act: () => { S.match = null; queueGame(m.game); } }
        : { label: 'Resign', act: resign };
      return { html, rows: [], soft: { left, right: { label: 'Leave', act: leaveGame } } };
    },
  };

  async function sendMove(raw) {
    const m = S.match; if (!m || m.status !== 'playing') return;
    const mi = meIndex(m);
    if (!canAct(m, mi)) { toast('Not your move'); return; }
    const move = typeof raw === 'string' && raw.startsWith('{') ? JSON.parse(raw) : (raw !== '' && !isNaN(Number(raw)) ? Number(raw) : raw);
    sfx.move();
    const r = await API.post('/api/move', { token: S.token, matchId: m.id, move });
    if (r && r.error) { toast(r.error); return; }
    if (r && r.match) { S.match = r.match; draw(); }
  }
  async function resign() { if (!S.match) return; await API.post('/api/resign', { token: S.token, matchId: S.match.id }); back(); }
  function leaveGame() { S.match = null; back(); }

  /* ----------------------------- profile ----------------------------- */

  screens.profile = {
    view() {
      const p = me();
      const badges = (p.badges || []).map((id) => { const b = badgeInfo(id); return `<span class="badge-chip" title="${esc(b.desc)}">${b.icon} ${esc(b.name)}</span>`; }).join('') || '<span class="tiny dim">no badges yet — win a game!</span>';
      const gstat = (id) => { const g = (p.games || {})[id] || { w: 0, l: 0, d: 0 }; return `${g.w}/${g.l}/${g.d}`; };
      return {
        html: `<div class="page">
            <div class="card hi center" style="padding:12px">
              ${avatarHTML(p.avatar, true)}
              <div class="txt" style="font-size:21px;margin-top:5px">${esc(p.nick)}</div>
              <div class="tiny lime">${esc(titleName(p.title) || 'Rookie')}</div>
              <div class="tiny dim">${esc(p.bio || 'no bio yet')}</div>
              <div style="margin-top:8px">${xpBarHTML(p)}</div>
            </div>
            <div class="list">
              <div class="row"><span class="ico gold">◆</span><span class="grow">Coins</span><span class="meta gold">${p.coins}</span></div>
              <div class="row"><span class="ico lime">▲</span><span class="grow">Wins / Losses / Draws</span><span class="meta">${p.wins}/${p.losses}/${p.draws}</span></div>
              <div class="row"><span class="ico">▦</span><span class="grow">Games played</span><span class="meta">${(p.stats || {}).played || 0}</span></div>
              <div class="row"><span class="ico">✉</span><span class="grow">Messages sent</span><span class="meta">${(p.stats || {}).chat || 0}</span></div>
            </div>
            <div class="hdr" style="margin-top:10px">PER-GAME (W/L/D)</div>
            <div class="list">${GAMEMETA.map((g) => `<div class="row"><span class="ico">${g.icon}</span><span class="grow">${g.name}</span><span class="meta">${gstat(g.id)}</span></div>`).join('')}</div>
            <div class="hdr" style="margin-top:10px">BADGES (${(p.badges || []).length}/${CONTENT.badges.length})</div>
            <div class="chips">${badges}</div>
            <div class="btnrow">
              <button class="btn primary" data-act="edit">Edit profile</button>
              <button class="btn" data-act="badges">All badges</button>
              <button class="btn" data-act="shop">Shop</button>
            </div>
          </div>`,
        rows: [], soft: { right: { label: 'Back', act: back } },
      };
    },
  };

  screens.editProfile = {
    view() {
      const p = me();
      const owned = p.owned || [];
      const cur = S.edit.avatar || p.avatar;
      const avGrid = CONTENT.avatars.map((a) => {
        const o = owned.includes('av' + a.id);
        return `<button class="avpick${cur === a.id ? ' on' : ''}${o ? '' : ' locked'}" data-act="pickav" data-av="${a.id}" ${o ? '' : 'disabled'} style="background:${o ? a.c : '#12241f'}">${o ? a.ch : '🔒'}</button>`;
      }).join('');
      const titles = CONTENT.titles.filter((t) => t.cost === 0 || owned.includes('title_' + t.id));
      const curT = S.edit.title || p.title;
      return {
        html: `<div class="page">
            <div class="hdr">⚑ EDIT PROFILE</div>
            <form id="profileForm" autocomplete="off">
              <div class="tiny dim">nickname</div>
              <div class="field"><input id="pNick" maxlength="14" value="${esc(p.nick)}" autocomplete="off"></div>
              <div class="tiny dim">bio (max 80)</div>
              <div class="field"><input id="pBio" maxlength="80" value="${esc(p.bio || '')}" placeholder="say something about you"></div>
            </form>
            <div class="hdr" style="margin-top:6px">AVATAR</div>
            <div class="avgrid">${avGrid}</div>
            <div class="hdr" style="margin-top:6px">TITLE</div>
            <div class="chips">${titles.map((t) => `<button class="badge-chip${curT === t.id ? ' on' : ''}" data-act="picktitle" data-title="${t.id}">${esc(t.name)}</button>`).join('')}</div>
            <div class="btnrow"><button class="btn primary" data-act="saveprofile">Save</button></div>
            <div class="card tiny dim">Locked avatars and titles can be bought in the <b>Shop</b>.</div>
          </div>`,
        rows: [], soft: { left: { label: 'Save', act: saveProfile }, right: { label: 'Back', act: back } },
      };
    },
  };

  async function saveProfile() {
    const nick = el('pNick') ? el('pNick').value.trim() : '';
    const bio = el('pBio') ? el('pBio').value : '';
    const patch = { bio };
    if (nick) patch.nick = nick;
    if (S.edit.avatar) patch.avatar = S.edit.avatar;
    if (S.edit.title) patch.title = S.edit.title;
    const r = await API.post('/api/profile', { token: S.token, patch });
    if (r.error) { toast(r.error); return; }
    S.profile = r.profile; S.edit = {}; sfx.ok(); toast('Profile saved'); back();
  }

  /* ----------------------------- shop ----------------------------- */

  screens.shop = {
    view() {
      const p = me();
      const items = CONTENT.shop.map((it) => {
        const owned = (p.owned || []).includes(it.id);
        return {
          ico: it.icon, label: it.name,
          meta: owned ? 'owned' : (it.cost + ' ◆'),
          act: () => buyOrEquip(it, owned),
        };
      });
      return listView(items, { left: { label: 'Buy / Equip', act: activate }, right: { label: 'Back', act: back } },
        `<div class="hdr">◆ SHOP</div><div class="card tiny dim">You have <span class="gold">${p.coins} ◆</span>. Earn more by winning games, the daily bonus and gifts.</div>`);
    },
  };

  async function buyOrEquip(it, owned) {
    if (owned) {
      const patch = it.type === 'avatar' ? { avatar: Number(it.id.slice(2)) } : { title: it.titleId };
      const r = await API.post('/api/profile', { token: S.token, patch });
      if (r.error) { toast(r.error); return; }
      S.profile = r.profile; sfx.ok(); toast('Equipped ' + it.name); draw(); return;
    }
    const r = await API.post('/api/shop/buy', { token: S.token, item: it.id });
    if (r.error) { toast(r.error); return; }
    S.profile = r.profile; sfx.coin(); toast('Bought ' + it.name); draw();
  }

  /* ----------------------------- leaderboard ----------------------------- */

  screens.top = {
    view() {
      const board = (S.data && S.data.board) || 'wins';
      const tabs = [['wins', 'Wins'], ['coins', 'Coins'], ['level', 'Level']];
      const html = `<div class="page">
          <div class="hdr">★ LEADERBOARD</div>
          <div class="tabs">${tabs.map(([id, l]) => `<button class="tab${board === id ? ' on' : ''}" data-act="board" data-board="${id}">${l}</button>`).join('')}</div>
          <div class="list" id="topList"><div class="row"><span class="meta">loading...</span></div></div>
          <div class="card tiny dim" id="topMeta"></div></div>`;
      return { html, rows: [], soft: { right: { label: 'Back', act: back } }, after: () => loadTop(board) };
    },
  };
  async function loadTop(board) {
    const r = await API.get('/api/leaderboard?board=' + board);
    const box = el('topList'); if (!box) return;
    const metric = board === 'coins' ? (p) => `<span class="meta gold">${p.coins}◆</span>` : board === 'level' ? (p) => `<span class="meta lime">lvl ${p.level}</span>` : (p) => `<span class="meta gold">${p.wins}W</span>`;
    box.innerHTML = (r.top && r.top.length)
      ? r.top.map((p, i) => `<div class="row"><span class="ico">${i + 1}</span>${avatarHTML(p.avatar)}<span class="grow">${esc(p.nick)}${p.online ? ' <span class="tiny lime">●</span>' : ''}</span>${metric(p)}</div>`).join('')
      : '<div class="row"><span class="meta">no players yet</span></div>';
    const meta = el('topMeta'); if (meta) meta.innerHTML = `${r.online || 0} online now`;
  }

  /* ----------------------------- badges ----------------------------- */

  screens.badges = {
    view() {
      const have = new Set(me().badges || []);
      const items = CONTENT.badges.map((b) => ({ ico: have.has(b.id) ? b.icon : '🔒', label: b.name, meta: b.desc + ' · +' + b.coins + '◆', act: () => toast(have.has(b.id) ? b.name + ': ' + b.desc : 'Locked — ' + b.desc) }));
      return listView(items, { left: { label: 'Info', act: activate }, right: { label: 'Back', act: back } }, '<div class="hdr">⚑ BADGES</div>');
    },
  };

  /* ----------------------------- about ----------------------------- */

  screens.about = {
    view() {
      return {
        html: `<div class="page">
            <div class="hdr">? ABOUT</div>
            <div class="txt small">A loving revival of <span class="lime">qeep</span>, the mobile social network that ran on Java (J2ME) phones.</div>
            <div class="card small dim">
              <b class="lime">Controls</b><br>
              • Arrow keys navigate · Enter/OK selects · Esc back<br>
              • Type on the keypad or keyboard to chat<br>
              • Click the qeep logo to toggle sound
            </div>
            <div class="card small dim">
              <b class="lime">Chat commands</b><br>
              <span class="lime">/me</span> action · <span class="lime">/roll</span> dice · <span class="lime">/help</span>
            </div>
            <div class="card tiny dim" id="aboutStats">loading stats...</div>
          </div>`,
        rows: [], soft: { right: { label: 'Back', act: back } }, after: loadAbout,
      };
    },
  };
  async function loadAbout() {
    const s = await API.get('/api/stats');
    const box = el('aboutStats');
    if (box) box.innerHTML = `${s.players || 0} players created · ${s.online || 0} online · ${s.games || 6} games · storage: <span class="lime">${s.store || 'memory'}</span>`;
  }

  /* ----------------------------- navigation ----------------------------- */

  function show(name, data = {}, push = false) {
    if (push) S.stack.push({ screen: S.screen, data: S.data });
    S.screen = name; S.data = data || {}; S.sel = 0;
    draw();
  }
  function back() {
    sfx.back();
    if (S.stack.length) { const prev = S.stack.pop(); S.screen = prev.screen; S.data = prev.data; S.sel = 0; draw(); }
    else if (S.profile && S.screen !== 'home') show('home');
  }
  function activate() { const fn = S.rows[S.sel]; if (typeof fn === 'function') { sfx.ok(); fn(); } }
  function moveSel(d) {
    if (!S.rows.length) return;
    const n = Math.min(S.rows.length - 1, Math.max(0, S.sel + d));
    if (n === S.sel) return;
    S.sel = n; sfx.nav(); updateSelection();
  }
  function updateSelection() {
    document.querySelectorAll('#app .row[data-idx]').forEach((r) => {
      const i = Number(r.dataset.idx);
      const on = i === S.sel;
      r.classList.toggle('sel', on);
      if (on) r.scrollIntoView({ block: 'nearest' });
    });
  }
  function updateSoft() {
    const L = S.soft.left, R = S.soft.right, l = el('softLeft'), r = el('softRight');
    l.textContent = L ? L.label : ''; l.disabled = !L;
    r.textContent = R ? R.label : ''; r.disabled = !R;
  }
  function draw() {
    clearTimers();
    const def = screens[S.screen] || screens.home;
    const v = def.view(S.data) || {};
    el('app').innerHTML = v.html || '';
    S.rows = v.rows || []; S.soft = v.soft || {};
    if (S.sel >= S.rows.length) S.sel = Math.max(0, S.rows.length - 1);
    updateSelection(); updateSoft();
    if (typeof v.after === 'function') v.after();
    el('app').scrollTop = 0;
  }

  /* ----------------------------- notifications ----------------------------- */

  function toast(text, kind) {
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = text;
    el('screen').appendChild(t);
    setTimeout(() => t.remove(), 1700);
  }
  function notify(text) { toast(text, 'notif'); }

  /* ----------------------------- events ----------------------------- */

  function connectEvents() {
    if (S.es) S.es.close();
    const es = new EventSource('/events?token=' + encodeURIComponent(S.token));
    S.es = es;
    es.onmessage = (e) => { try { handleEvent(JSON.parse(e.data)); } catch (_) {} };
    es.onerror = () => {};
  }

  function handleEvent(ev) {
    switch (ev.type) {
      case 'hello': S.online = ev.online; if (S.screen === 'home') draw(); break;
      case 'chat':
        appendMessage(ev.room, ev.msg);
        if (S.screen === 'chat' && S.chatRoom === ev.room) { if (!ev.msg.system) sfx.msg(); }
        else if (!ev.msg.system) { S.unread[ev.room] = (S.unread[ev.room] || 0) + 1; if (isLiveScreen()) draw(); }
        break;
      case 'dm':
        if (S.screen === 'dm' && S.dmWith === ev.msg.from) { refreshDM(); sfx.msg(); }
        else { S.unreadDm++; notify('✎ ' + ev.msg.fromNick + ': ' + ev.msg.text.slice(0, 24)); refreshState(); }
        break;
      case 'matchUpdate': onMatchUpdate(ev); break;
      case 'profile': S.profile = ev.profile; if (isLiveScreen()) draw(); break;
      case 'badge': { const b = ev.badge; sfx.badge(); notify('⚑ Badge: ' + b.name + ' (+' + b.coins + '◆)'); refreshState(); break; }
      case 'levelUp': sfx.coin(); notify('▲ Level ' + ev.level + '! (+' + ev.coins + '◆)'); refreshState(); break;
      case 'gift': sfx.coin(); notify('◆ ' + ev.amount + ' coins from ' + ev.from.nick); refreshState(); break;
      case 'friendRequest': notify('☺ ' + ev.from.nick + ' wants to be friends'); refreshState(); break;
      case 'friendAccepted': notify('☺ You and ' + ev.who.nick + ' are friends now'); refreshState(); break;
      case 'presence': updatePresence(ev); break;
      case 'info':
        toast((ev.title || '') + ': ' + (ev.lines || []).join(' · '));
        break;
      default: break;
    }
  }

  function updatePresence(ev) {
    const p = S.profile; if (!p || !p.friends) return;
    const f = p.friends.find((x) => x.token === ev.token);
    if (f) { f.online = ev.online; if (S.screen === 'friends' || S.screen === 'messages') draw(); }
  }

  async function refreshDM() {
    const r = await API.post('/api/dm/history', { token: S.token, with: S.dmWith });
    renderDMs(r && r.messages);
  }

  function onMatchUpdate(ev) {
    const m = ev.match; if (!m) return;
    if (!m.seats.some((s) => !s.bot && s.token === S.token)) return;
    S.match = m;
    if (ev.matched) { sfx.ok(); show('game'); return; }
    if (S.screen === 'game') {
      draw();
      if (m.status === 'finished') {
        const mi = meIndex(m);
        if (m.winner && m.seats[mi] && m.winner === m.seats[mi].mark) sfx.win(); else if (m.winner) sfx.lose();
      }
    }
  }

  /* ----------------------------- input ----------------------------- */

  function isTyping() { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); }
  function submitTyping() {
    const a = document.activeElement;
    if (!a) return;
    if (a.id === 'loginName') submitLogin();
    else if (a.id === 'chatInput') sendChat();
    else if (a.id === 'dmInput') sendDM();
    else if (a.id === 'findName') doFind();
    else if (a.id === 'pNick' || a.id === 'pBio') saveProfile();
  }
  async function doFind() {
    const i = el('findName'); const nick = i ? i.value.trim() : '';
    const box = el('findResult'); if (!nick || !box) return;
    box.innerHTML = '<div class="card tiny dim">searching...</div>';
    const r = await API.post('/api/players/find', { token: S.token, nick });
    if (r.error) { box.innerHTML = `<div class="card tiny red">${esc(r.error)}</div>`; return; }
    const p = r.player;
    box.innerHTML = `<div class="card hi">
        <div style="display:flex;align-items:center;gap:8px">${avatarHTML(p.avatar)}<div style="flex:1"><div>${esc(p.nick)}</div><div class="tiny dim">lvl ${p.level} ${p.online ? '· online' : ''}</div></div></div>
        <div class="btnrow"><button class="btn primary" data-act="sendreq" data-token="${p.token}">Add friend</button>
        <button class="btn" data-act="quickdm" data-token="${p.token}" data-nick="${esc(p.nick)}" data-avatar="${p.avatar}">Message</button></div></div>`;
  }

  async function pressKey(key) {
    const typing = isTyping();
    if (key === 'up') { if (!typing) moveSel(-1); return; }
    if (key === 'down') { if (!typing) moveSel(1); return; }
    if (key === 'ok') { if (typing) submitTyping(); else activate(); return; }
    if (key === 'left') { if (!typing && S.soft.left) { sfx.ok(); S.soft.left.act(); } return; }
    if (key === 'right') { if (!typing) back(); return; }
  }

  function keypadChar(k) {
    const a = document.activeElement;
    const inp = (a && a.tagName === 'INPUT') ? a : document.querySelector('#app input');
    if (!inp || k === '#') return;
    inp.focus(); inp.value += k; sfx.nav();
  }

  document.addEventListener('keydown', (e) => {
    const id = e.target && e.target.id;
    if (isTyping()) {
      if (e.key === 'Enter') { e.preventDefault(); submitTyping(); }
      else if (e.key === 'Escape') { e.preventDefault(); back(); }
      return;
    }
    void id;
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ok', ' ': 'ok', Escape: 'right', Backspace: 'right' };
    const k = map[e.key];
    if (k) { e.preventDefault(); pressKey(k); }
  });

  document.addEventListener('click', (e) => {
    const keyBtn = e.target.closest('[data-key]');
    if (keyBtn) {
      const kk = keyBtn.dataset.key;
      if (/^[0-9*#]$/.test(kk)) return keypadChar(kk);
      return pressKey(kk);
    }
    const avatarBtn = e.target.closest('[data-act="pickav"]');
    if (avatarBtn) { S.edit.avatar = Number(avatarBtn.dataset.av); draw(); return; }
    const titleBtn = e.target.closest('[data-act="picktitle"]');
    if (titleBtn) { S.edit.title = titleBtn.dataset.title; draw(); return; }
    const act = e.target.closest('[data-act]');
    if (act) { handleAction(act); return; }
    const row = e.target.closest('#app .row[data-idx]');
    if (row) { S.sel = Number(row.dataset.idx); updateSelection(); activate(); return; }
    const mv = e.target.closest('[data-move]');
    if (mv) { sendMove(mv.dataset.move); return; }
  });

  function handleAction(node) {
    const a = node.dataset.act;
    const p = me();
    switch (a) {
      case 'random': { const i = el('loginName'); if (i) i.value = randomNick(); return; }
      case 'saveprofile': return saveProfile();
      case 'edit': S.edit = {}; return show('editProfile', {}, true);
      case 'badges': return show('badges', {}, true);
      case 'shop': return show('shop', {}, true);
      case 'board': S.data = { board: node.dataset.board }; return draw();
      case 'dm': return show('dm', { token: S.data.token, nick: S.data.nick, avatar: S.data.avatar }, true);
      case 'gift': {
        const amount = Number(prompt('How many coins to gift? (you have ' + p.coins + ')') || 0);
        if (!amount) return;
        API.post('/api/gift', { token: S.token, to: S.data.token, amount }).then((r) => {
          if (r.error) toast(r.error); else { S.profile = r.profile; sfx.coin(); toast('Gifted ' + amount + ' coins'); }
        });
        return;
      }
      case 'unfriend':
        API.post('/api/friend/remove', { token: S.token, target: S.data.token }).then((r) => { if (r.profile) { S.profile = r.profile; } toast('Friend removed'); back(); });
        return;
      case 'sendreq':
        API.post('/api/friend/request', { token: S.token, target: node.dataset.token }).then((r) => {
          if (r.error) toast(r.error); else { S.profile = r.profile; sfx.ok(); toast('Friend request sent'); }
        });
        return;
      case 'quickdm':
        return show('dm', { token: node.dataset.token, nick: node.dataset.nick, avatar: Number(node.dataset.avatar) }, true);
      case 'accept':
        API.post('/api/friend/accept', { token: S.token, target: node.dataset.token }).then((r) => {
          if (r.error) toast(r.error); else { S.profile = r.profile; sfx.ok(); toast('Friend added'); draw(); }
        });
        return;
      default: return;
    }
  }

  document.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.id === 'loginForm') submitLogin();
    else if (e.target.id === 'chatForm') sendChat();
    else if (e.target.id === 'dmForm') sendDM();
    else if (e.target.id === 'findForm') doFind();
  });

  el('softLeft').addEventListener('click', () => { if (S.soft.left) { sfx.ok(); S.soft.left.act(); } });
  el('softRight').addEventListener('click', () => back());
  const brand = document.querySelector('.statusbar .sbrand');
  brand.addEventListener('click', () => {
    S.sound = !S.sound;
    localStorage.setItem('qeep.sound', S.sound ? 'on' : 'off');
    brand.style.opacity = S.sound ? '1' : '.35';
    if (S.sound) sfx.ok();
  });

  /* ----------------------------- go ----------------------------- */

  (async () => {
    brand.style.opacity = S.sound ? '1' : '.35';
    const [c, g] = await Promise.all([API.get('/api/content'), API.get('/api/games')]);
    if (c && c.avatars && c.avatars.length) CONTENT = c;
    if (g && g.games && g.games.length) GAMEMETA = g.games;
    draw();
  })();
})();
