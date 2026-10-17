/* ============================================================
   qeep revival - persistence layer
   File-backed by default; Postgres automatically if DATABASE_URL
   is set (uses the optional `pg` package, loaded lazily).
   ============================================================ */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'qeep-db.json');
const DATABASE_URL = process.env.DATABASE_URL || '';

let pool = null;
let mode = 'memory';
let saveTimer = null;
let dirty = false;

async function init() {
  if (DATABASE_URL) {
    try {
      const { Pool } = require('pg');
      pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
        max: 4,
      });
      await pool.query('CREATE TABLE IF NOT EXISTS qeep_state (id int PRIMARY KEY, data jsonb NOT NULL, updated timestamptz DEFAULT now())');
      mode = 'postgres';
      return;
    } catch (err) {
      console.warn('[store] postgres unavailable, using file storage:', err.message);
      pool = null;
    }
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    mode = 'file';
  } catch (_) { mode = 'memory'; }
}

async function load() {
  try {
    if (mode === 'postgres') {
      const r = await pool.query('SELECT data FROM qeep_state WHERE id = 1');
      return r.rows[0] ? r.rows[0].data : null;
    }
    if (mode === 'file' && fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (err) {
    console.warn('[store] load failed, starting fresh:', err.message);
  }
  return null;
}

function scheduleSave(snapshotFn) {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; save(snapshotFn).catch(() => {}); }, 1500);
}

async function save(snapshotFn) {
  if (!dirty) return;
  const data = snapshotFn();
  dirty = false;
  try {
    if (mode === 'postgres') {
      await pool.query(
        'INSERT INTO qeep_state (id, data, updated) VALUES (1, $1, now()) ON CONFLICT (id) DO UPDATE SET data = $1, updated = now()',
        [data]
      );
    } else if (mode === 'file') {
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, DATA_FILE);
    }
  } catch (err) {
    console.warn('[store] save failed:', err.message);
    dirty = true;
  }
}

async function flushNow(snapshotFn) {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  return save(snapshotFn);
}

function info() {
  return { mode, file: mode === 'file' ? DATA_FILE : null };
}

module.exports = { init, load, scheduleSave, flushNow, info };
