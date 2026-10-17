# qeep revival

A loving, browser-based revival of **qeep** — the Java (J2ME) mobile social network
that ran on Nokia and friends back in the day. Retro phone UI, real chat,
turn-based multiplayer games, and coins.

## Run it

You need [Node.js](https://nodejs.org) installed (any recent version).

**Easiest:** double-click **`START.bat`**. It starts the server and opens your browser.

**Or from a terminal:**

```
cd qeep
node server.js
```

Then open <http://localhost:8080>.

There are **no dependencies** to install — the server uses only Node's built-in modules.

## How to play

- Pick a nickname to sign in (or hit **Random**).
- **Chat** — join a public room and talk. Messages appear live for everyone.
- **Games** — pick *Tic-Tac-Toe* or *Connect Four*. You're matched with another
  player; if nobody is around, a bot jumps in after ~9 seconds.
- **Coins** — win a game for **+25**, draw/play for a little. Watch your rank on
  the **Leaderboard**.
- Open the site in **two browser tabs/windows** (or on two devices on your network)
  to play against yourself as a test.

### Controls

- Arrow keys = navigate, **Enter / OK** = select, **Esc** = back
- Or just click the phone: the D-pad, soft keys and keypad all work
- Type on the on-screen keypad or your keyboard to chat
- Click the **qeep** logo in the status bar to toggle sound

## Notes

- State lives in memory, so everything resets when the server restarts.
- To let friends on your network play, they can visit `http://YOUR-IP:8080`
  (find your IP with `ipconfig`). Windows may ask to allow Node through the firewall.

## Files

```
qeep/
├─ START.bat          double-click launcher (Windows)
├─ server.js          tiny zero-dependency multiplayer server
└─ public/
   ├─ index.html      the phone shell
   ├─ style.css       retro J2ME styling
   └─ app.js          all the app logic
```
