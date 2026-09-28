/**
 * ZAMI-MD · DEPLOY ENGINE
 * ───────────────────────
 * Ye asli me bot deploy karta hai:
 *   1. User ka forked GitHub repo clone karta hai
 *   2. config.env / settings file likhta hai (session + prefix + toggles)
 *   3. npm install chalata hai
 *   4. bot ko background process me start karta hai
 *   5. crash hone par auto-restart karta hai
 *
 * server.js isko require karta hai.
 */

const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');

const ROOT = path.join(__dirname, 'deployments');
const DB   = path.join(__dirname, 'bots.json');
if (!fs.existsSync(ROOT)) fs.mkdirSync(ROOT, { recursive: true });

// default repo agar user ne fork na kiya ho
const DEFAULT_REPO = process.env.BOT_REPO || 'https://github.com/ZAMI-INXIDE/ZAMI-MD';

/* ── chhoti si JSON "database" ── */
const load = () => { try { return JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { return {}; } };
const save = d  => fs.writeFileSync(DB, JSON.stringify(d, null, 2));

const procs = {};   // id → child process

/* ── SESSION DECODER ──
   1) short token (ZAMI~a7k2m9x4p1)  → store/ se padho
   2) gzip base64url                 → unzip
   3) plain base64                   → decode  */
function decodeSession(sid) {
  const zlib = require('zlib');
  const s = String(sid).replace(/^ZAMI~/, '').trim();

  // 1) short token
  if (/^[a-z0-9]{8,20}$/i.test(s)) {
    const f = path.join(__dirname, 'store', s + '.json');
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  }

  // 2 & 3) encoded formats
  const buf = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  try { return zlib.gunzipSync(buf).toString('utf8'); }
  catch { return buf.toString('utf8'); }
}

const sh = (cmd, cwd, logs, timeout = 600000) => new Promise(res => {
  exec(cmd, { cwd, timeout, maxBuffer: 1024 * 1024 * 20 }, (err, so, se) => {
    if (err) logs.push('⚠ ' + (se || err.message).split('\n')[0].slice(0, 160));
    res(!err);
  });
});

/* ═══════════════════════════════════════
   DEPLOY
   ═══════════════════════════════════════ */
async function deployBot(cfg) {
  const logs = [];
  const id = 'zami-' + Date.now().toString(36);
  const dir = path.join(ROOT, id);

  if (!cfg.session || !cfg.session.startsWith('ZAMI~'))
    return { ok: false, error: 'Invalid Session ID', logs };

  // session decode (gzip-short aur purana plain base64 dono support)
  let credsRaw = null;
  try {
    credsRaw = decodeSession(cfg.session);
    JSON.parse(credsRaw);
    logs.push('✓ Session ID verified');
  } catch {
    return { ok: false, error: 'Session ID corrupt hai — naya banao', logs };
  }

  /* 1 ── repo clone ── */
  const repo = cfg.github
    ? `https://github.com/${cfg.github}/ZAMI-MD`
    : DEFAULT_REPO;

  logs.push('▸ Cloning ' + repo);
  fs.mkdirSync(dir, { recursive: true });

  let cloned = await sh(`git clone --depth 1 ${repo} .`, dir, logs);
  if (!cloned && cfg.github) {
    logs.push('⚠ Fork nahi mila — official repo use kar rahe hain');
    cloned = await sh(`git clone --depth 1 ${DEFAULT_REPO} .`, dir, logs);
  }
  if (!cloned) {
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: false, error: 'Repo clone fail — internet ya repo URL check karo', logs };
  }
  logs.push('✓ Repo cloned');

  /* 2 ── session creds likho ── */
  const sessDir = path.join(dir, 'session');
  fs.mkdirSync(sessDir, { recursive: true });
  fs.writeFileSync(path.join(sessDir, 'creds.json'), credsRaw);
  logs.push('✓ Session installed');

  /* 3 ── config likho (env + json dono, jo bhi repo padhe) ── */
  const env = {
    SESSION_ID:    cfg.session,
    PREFIX:        cfg.prefix || '.',
    BOT_NAME:      cfg.botName || 'ZAMI-MD',
    OWNER_NAME:    'ZAMI',
    BOT_PIC:       cfg.pfp || '',
    TIME_ZONE:     cfg.tz || 'Asia/Karachi',
    PRESENCE:      cfg.presence || 'unavailable',
    AUTO_LIKE_STATUS: String(!!cfg.autoLike),
    AUTO_READ_STATUS: String(!!cfg.autoRead),
    ANTI_CALL:     String(!!cfg.antiCall),
    ANTI_LINK:     String(!!cfg.antiLink),
    ALWAYS_ONLINE: String(!!cfg.alwaysOnline),
    MODE:          'public'
  };

  fs.writeFileSync(path.join(dir, 'config.env'),
    Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n'));
  fs.writeFileSync(path.join(dir, '.env'),
    Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(env, null, 2));
  logs.push('✓ Config written');

  /* 4 ── npm install ── */
  logs.push('▸ Installing dependencies (2-5 min)...');
  await sh('npm install --omit=dev --no-audit --no-fund', dir, logs);
  logs.push('✓ Dependencies installed');

  /* 5 ── entry file dhoondo ── */
  let entry = 'index.js';
  try {
    const pk = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const st = pk.scripts?.start || '';
    const m = st.match(/([\w.\-/]+\.js)/);
    if (m) entry = m[1];
    else for (const f of ['index.js', 'main.js', 'bot.js', 'app.js'])
      if (fs.existsSync(path.join(dir, f))) { entry = f; break; }
  } catch {}
  logs.push('✓ Entry: ' + entry);

  /* 6 ── save + start ── */
  const db = load();
  db[id] = {
    id, dir, entry, repo,
    botName: env.BOT_NAME, prefix: env.PREFIX,
    createdAt: Date.now(), status: 'starting', restarts: 0
  };
  save(db);

  startProcess(id);
  logs.push('🚀 Bot process started');

  return { ok: true, id, logs };
}

/* ═══════════════════════════════════════
   PROCESS MANAGER (auto-restart)
   ═══════════════════════════════════════ */
function startProcess(id) {
  const db = load();
  const b = db[id];
  if (!b || !fs.existsSync(b.dir)) return;

  const child = spawn('node', [b.entry], {
    cwd: b.dir,
    env: { ...process.env, SESSION_ID: b.session },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  procs[id] = child;
  b.status = 'running';
  b.pid = child.pid;
  save(db);

  const logFile = path.join(b.dir, 'bot.log');
  const w = fs.createWriteStream(logFile, { flags: 'a' });
  child.stdout.pipe(w);
  child.stderr.pipe(w);

  child.on('exit', code => {
    delete procs[id];
    const d = load();
    if (!d[id]) return;
    d[id].status = 'stopped';
    d[id].restarts = (d[id].restarts || 0) + 1;
    save(d);
    console.log(`[bot ${id}] exit ${code}`);
    // auto restart (max 5 baar)
    if (d[id].restarts <= 5) setTimeout(() => startProcess(id), 8000);
  });
}

function stopBot(id) {
  const p = procs[id];
  if (p) { try { p.kill('SIGTERM'); } catch {} delete procs[id]; }
  const db = load();
  if (db[id]) { db[id].status = 'stopped'; db[id].restarts = 99; save(db); }
  return true;
}

function restartBot(id) {
  stopBot(id);
  const db = load();
  if (db[id]) { db[id].restarts = 0; save(db); }
  setTimeout(() => startProcess(id), 2000);
  return true;
}

function deleteBot(id) {
  stopBot(id);
  const db = load();
  if (db[id]) {
    try { fs.rmSync(db[id].dir, { recursive: true, force: true }); } catch {}
    delete db[id]; save(db);
  }
  return true;
}

function listBots() {
  const db = load();
  return Object.values(db).map(b => ({
    id: b.id, botName: b.botName, prefix: b.prefix,
    status: b.status, running: !!procs[b.id],
    restarts: b.restarts, createdAt: b.createdAt
  }));
}

function getLogs(id, lines = 60) {
  const db = load();
  if (!db[id]) return 'Bot not found';
  try {
    const t = fs.readFileSync(path.join(db[id].dir, 'bot.log'), 'utf8');
    return t.split('\n').slice(-lines).join('\n');
  } catch { return 'No logs yet'; }
}

/* server restart hone par sab bots wapas chalao */
function resumeAll() {
  const db = load();
  Object.keys(db).forEach(id => {
    if (db[id].status === 'running') {
      db[id].restarts = 0;
      setTimeout(() => startProcess(id), 3000);
    }
  });
  save(db);
}

module.exports = { deployBot, stopBot, restartBot, deleteBot, listBots, getLogs, resumeAll };
