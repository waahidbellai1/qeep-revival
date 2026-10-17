# qeep revival

A loving, browser-based revival of **qeep** — the mobile social network that ran on
Java (J2ME) phones (Nokia and friends) back in the day. A retro phone you actually
tap: chat rooms, friends, private messages, six turn-based multiplayer games, coins,
XP, levels, badges and a shop.

**Live demo:** deploy your own with one click ↓

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/waahidbellai1/qeep-revival)

---

## Quick start

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/waahidbellai1/qeep-revival.git
cd qeep-revival
node server.js
```

Then open <http://localhost:8080>.

On Windows you can also just double-click **`START.bat`**.

There is **nothing to install** to run it — the server uses only Node's built-in
modules. (`pg` is optional; see *Persistence* below.)

## What's inside

### Retro phone UI
A J2ME-style handset you interact with: a tiny scrolling screen, status bar, soft
keys, D-pad, and a working keypad. Pixel fonts, scanlines and beeps included.
Click the **qeep** logo in the status bar to toggle sound.

### Chat
Five public rooms (*The Lobby*, *Say Hi*, *Game Central*, *Retro Corner*, *Help Desk*)
with live messages, unread badges and commands:
`/me <action>` · `/roll` · `/help`

### Six games, all turn-based multiplayer
| Game | How to win |
| --- | --- |
| Tic-Tac-Toe | three in a row |
| Connect Four | four in a line |
| Reversi | flip the most discs |
| Nim | take the last object |
| Rock Paper Scissors | best of three |
| Retro Quiz | most questions right |

Matchmaking pairs you with another player; if nobody is around, a **bot** joins
after ~9 seconds. Win = **+30 coins** and XP.

### Social
- **Friends** — search by nickname, send/accept requests, see who's online
- **Private messages** — DM anyone, with unread counts
- **Gifts** — send coins to friends
- **Profiles** — avatars, titles, bios
- **Leaderboards** — by wins, coins or level

### Progression
- **XP + levels** with an XP bar
- **12 badges** awarded automatically
- **Daily bonus** with a streak that grows the reward
- **Shop** — buy avatars and titles, then equip them

## Controls

| Input | Action |
| --- | --- |
| Arrow keys | navigate |
| Enter / OK | select |
| Esc | back |
| Keypad or keyboard | type (T9 vibes — keys add characters) |
| Click | everything is clickable too |

## Deploy

### Render (free, no card)
Click the **Deploy to Render** button above, or:
**New +** → **Blueprint** → pick the repo → **Apply**. `render.yaml` does the rest.

> Free Render instances sleep after ~15 minutes idle and have an ephemeral disk,
> so the in-memory/file world resets on restart. Add a Postgres database and set
> `DATABASE_URL` to keep profiles, coins and friends permanently (see below).

### Docker
```bash
docker build -t qeep .
docker run -p 8080:8080 qeep
```

### Any Node host
`npm install && npm start`. The server reads `PORT` and binds `0.0.0.0`.

## Persistence

By default the world is saved to `data/qeep-db.json` (debounced, plus on shutdown).

Set **`DATABASE_URL`** to any Postgres connection string and the server switches to
Postgres automatically — no code changes. That's the option you want for a real
deployment, since most free hosts have ephemeral disks. Free Postgres tiers from
Neon, Supabase or Render all work:

```bash
DATABASE_URL=postgresql://user:pass@host:5432/dbname node server.js
```

The server creates its own table on first boot. `pg` is listed as a dependency so
hosts that run `npm install` get it; if you never set `DATABASE_URL`, you don't
need it.

## Testing

```bash
npm test        # boots the server on a test port and checks the API
```

The repo also ships a real-browser test (`scripts/` style) used during development
that drives Chrome over the DevTools Protocol: it logs in, walks every screen,
plays all six games against a bot, and fails on any uncaught JavaScript exception.

## Architecture

```
qeep/
├─ server.js            HTTP + SSE server, routes, matchmaking, bot scheduling
├─ lib/
│  ├─ content.js        avatars, titles, badges, shop, chat rooms, quiz bank
│  ├─ store.js          persistence: JSON file, or Postgres via DATABASE_URL
│  ├─ world.js          players, social graph, chat, DMs, economy, badges
│  └─ games.js          the game engine — one module per game
├─ public/
│  ├─ index.html        the phone shell
│  ├─ style.css         retro J2ME styling
│  └─ app.js            all client logic and game renderers
├─ scripts/smoke.js     boot + API smoke test
├─ START.bat            double-click launcher (Windows)
├─ Dockerfile           container build
└─ render.yaml          Render blueprint
```

**Realtime** is Server-Sent Events (`/events`) for pushes, with plain JSON `POST`
for actions — which is why it works behind free hosts without WebSockets.

**Adding a game** means writing one module in `lib/games.js` (`create`, `move`, `bot`,
optionally `view`/`botSeats`) and one renderer branch in `public/app.js`. The
framework handles matchmaking, turns, bot timing, rewards and persistence.

## Notes

- This is a **fan tribute**. It shares no code or assets with the original qeep
  and is not affiliated with or endorsed by it.
- State is per-instance and in memory; a single instance is assumed (no shared
  session store). Perfect for a community server.

## License

MIT — see [LICENSE](LICENSE).
