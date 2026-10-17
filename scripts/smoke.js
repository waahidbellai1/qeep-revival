/* Boots the server on a test port and checks the API surface.
   Used by `npm test` and CI. No dependencies. */
const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.SMOKE_PORT || 8123;
const BASE = 'http://localhost:' + PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const getJSON = async (p) => (await fetch(BASE + p)).json();
const post = async (p, b) => (await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) })).json();

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: 'ignore',
  });

  try {
    let up = false;
    for (let i = 0; i < 80 && !up; i++) {
      try { up = (await fetch(BASE + '/health')).ok; } catch (_) {}
      if (!up) await sleep(200);
    }
    ok(up, 'server boots and /health responds');
    if (!up) return;

    ok((await getJSON('/health')).ok === true, 'health payload is ok');

    const content = await getJSON('/api/content');
    ok(Array.isArray(content.avatars) && content.avatars.length >= 16, 'content: avatars (' + (content.avatars || []).length + ')');
    ok(Array.isArray(content.badges) && content.badges.length >= 10, 'content: badges (' + (content.badges || []).length + ')');
    ok(Array.isArray(content.shop) && content.shop.length >= 10, 'content: shop (' + (content.shop || []).length + ')');

    const games = await getJSON('/api/games');
    ok(Array.isArray(games.games) && games.games.length === 6, 'content: 6 games');

    const html = await (await fetch(BASE + '/')).text();
    ok(html.includes('qeep'), 'serves the phone UI');
    const js = await (await fetch(BASE + '/app.js')).text();
    ok(js.includes('qeep revival'), 'serves the client bundle');

    const join = await post('/api/join', { nick: 'SmokeTest' });
    ok(join.player && join.player.coins === 100, 'can create a player with 100 coins');

    const dup = await post('/api/join', { nick: 'SmokeTest' });
    ok(dup.player && dup.player.nick !== 'SmokeTest', 'duplicate nicknames are renamed');

    const lb = await getJSON('/api/leaderboard?board=level');
    ok(Array.isArray(lb.top), 'leaderboard responds');

    const stats = await getJSON('/api/stats');
    ok(typeof stats.players === 'number', 'stats respond');
  } catch (err) {
    console.error('  ERROR ' + err.message);
    fail++;
  } finally {
    await new Promise((resolve) => {
      if (srv.exitCode !== null || srv.signalCode) return resolve();
      srv.once('exit', () => resolve());
      try { srv.kill(); } catch (_) {}
      setTimeout(resolve, 2000);
    });
  }

  console.log('\n==== smoke: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exitCode = fail ? 1 : 0;
})();
