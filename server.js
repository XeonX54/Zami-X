/**
 * ZAMI-MD · Pair Code Backend  (v3 — "Couldn't link device" FIXED)
 * ----------------------------------------------------------------
 * Fix kya kiya:
 *  1. Socket ab code dene ke baad ZINDA rehta hai (pehle mar jaata tha)
 *  2. 515 / restartRequired par AUTO-RECONNECT (yahi asli wajah thi)
 *  3. Pairing code connection.update ke baad maanga jata hai
 *  4. Session 3 min tak zinda, phir auto cleanup
 *
 *  npm install && npm start
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

let B;
try { B = require('baileys'); }
catch { B = require('@whiskeysockets/baileys'); }

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  delay,
  Browsers
} = B;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const SESS = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESS)) fs.mkdirSync(SESS, { recursive: true });

// short session tokens yahan store hote hain
const STORE = path.join(__dirname, 'store');
if (!fs.existsSync(STORE)) fs.mkdirSync(STORE, { recursive: true });
const rm = d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} };

const logger = pino({ level: 'silent' });



/* "Bad MAC" / "Failed to decrypt" = purane messages ka noise. Harmless.
   Filter SABSE UPAR hona chahiye warna kaam nahi karta. */
const _log = console.log.bind(console);
const _err = console.error.bind(console);
const noise = t => /Bad MAC|Failed to decrypt|Session error|libsignal|No session|Closing (open|stale)/i.test(String(t ?? ''));
console.log   = (...a) => { if (!noise(a[0])) _log(...a); };
console.error = (...a) => { if (!noise(a[0])) _err(...a); };

const log = (...a) => _log(new Date().toLocaleTimeString(), ...a);

/* ════════════════════════════════════════════════════════
   GET /api/pair?number=923XXXXXXXXX
   ════════════════════════════════════════════════════════ */
app.get('/api/pair', async (req, res) => {
  const number = String(req.query.number || '').replace(/\D/g, '');

  if (number.length < 10 || number.length > 15)
    return res.status(400).json({ error: 'Galat number. Format: 923001234567' });

  const dir = path.join(SESS, 'z' + Date.now() + Math.floor(Math.random() * 999));
  fs.mkdirSync(dir, { recursive: true });

  let replied = false;
  let cleanExit = false;          // success ke baad reconnect na ho
  const reply = (obj, st = 200) => {
    if (!replied && !res.headersSent) { replied = true; res.status(st).json(obj); }
  };

  // 3 minute ka safety timeout
  const killTimer = setTimeout(() => { log('⏱️  timeout, cleanup'); rm(dir); }, 180000);

  /* ───── recursive start (reconnect ke liye) ───── */
  async function start(isRetry = false) {
    const { state, saveCreds } = await useMultiFileAuthState(dir);

    // WA version — ek baar fetch, phir cache (har baar 20-30 sec bachte hain) ⚡
    if (!global.__waVer) {
      try {
        const p = fetchLatestBaileysVersion();
        const t = new Promise(r => setTimeout(() => r({ version: [2, 3000, 1023223821] }), 4000));
        global.__waVer = (await Promise.race([p, t])).version;
      } catch { global.__waVer = [2, 3000, 1023223821]; }
      log('📦 WA version', global.__waVer.join('.'));
    }
    const version = global.__waVer;

    const sock = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      // ⭐⭐ SABSE ZAROORI FIX ⭐⭐
      // Pairing code sirf Safari/macOS fingerprint ke saath reliable hai.
      // ubuntu/Chrome par WhatsApp "Couldn't link device" deta hai.
      browser: Browsers.macOS('Safari'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: undefined,  // ⭐ undefined = no timeout
      keepAliveIntervalMs: 10000,        // ⭐ socket zinda rakho
      retryRequestDelayMs: 250,
      emitOwnEvents: true,
      fireInitQueries: true,
      generateHighQualityLinkPreview: false,
      getMessage: async () => ({ conversation: 'ZAMI-MD' })
    });

    sock.ev.on('creds.update', saveCreds);

    /* ─── PAIRING CODE (sirf pehli baar) ─── */
    if (!isRetry && !sock.authState.creds.registered) {
      await delay(2000);                                  // ⚡ fast (2 sec kaafi hai)
      try {
        // ⭐ CUSTOM CODE: pehle 4 letters "ZAMI", baaki 4 random
        const CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ123456789';
        let rnd = '';
        for (let i = 0; i < 4; i++) rnd += CH[Math.floor(Math.random() * CH.length)];
        const custom = 'ZAMI' + rnd;

        let code;
        try {
          code = await sock.requestPairingCode(number, custom);  // custom supported
        } catch {
          code = await sock.requestPairingCode(number);          // fallback
        }
        const pretty = code?.match(/.{1,4}/g)?.join('-') || code;
        log(`📲 PAIR  ${number}  →  ${pretty}`);
        reply({ code: pretty });
      } catch (e) {
        log('❌ code fail:', e?.message);
        reply({ error: 'Code generate nahi hua. Thodi der baad try karo.' }, 500);
        rm(dir); clearTimeout(killTimer);
        return;
      }
    }

    /* ─── CONNECTION EVENTS ─── */
    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect } = u;

      if (connection === 'connecting') log('🔄 connecting...');

      /* ✅ CONNECTED */
      if (connection === 'open') {
        clearTimeout(killTimer);
        log(`✅ OPEN  ${number}`);
        await delay(4000);                 // ⚡ creds save (4 sec kaafi)

        try {
          const creds = fs.readFileSync(path.join(dir, 'creds.json'), 'utf8');

          /* ⚡⚡ SUPER SHORT SESSION ID (~17 chars)
             Poora data server pe store hota hai, user ko sirf token milta hai.
             ZAMI~a7k2m9x4p1  ← bas itna! */
          const token = Array.from({ length: 12 }, () =>
            'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 32)]).join('');

          fs.writeFileSync(path.join(STORE, token + '.json'), creds);

          const sessionId = 'ZAMI~' + token;
          log(`📏 session: ${creds.length} chars → ${sessionId.length} chars ⚡`);

          const me = sock.user.id.split(':')[0] + '@s.whatsapp.net';

          // 1) plain session id (backup, taake manual copy ho sake)
          await sock.sendMessage(me, { text: sessionId });
          await delay(2500);
          log('✓ session id message bheja, ab card...');

          // 2) interactive card + "Copy Session ID" button
          const body =
`╭──〔 *SESSION ID CONNECTED* 〕──╮

│ ✅ *YOUR SESSION ID IS READY!*
│ ⚠️ *KEEP IT PRIVATE AND SECURE*
│ 🔐 *DONT SHARE IT WITH ANYONE*
│ ✨ *EXPLORE THE COOL FEATURES*
│ 🤖 *ENJOY SEAMLES AUTOMATION*

╰────────────────────────╯

_CHOOSE AN OPTION BELOW_ </ 🐞`;

          const btn = {
            name: 'cta_copy',
            buttonParamsJson: JSON.stringify({
              display_text: '📋 Copy Session ID',
              id: 'copy_session',
              copy_code: sessionId
            })
          };

          /* ══ SIRF EK CARD — plain text (100% dikhta hai) ══
             Interactive/button wala WhatsApp self-chat me render nahi karta,
             isliye seedha plain card bhejte hain. */
          try {
            await sock.sendMessage(me, { text: body });
            log('🟢 CARD SENT ✅');
          } catch (e) { log('❌ card fail:', e?.message); }

          log(`📨 SENT session id → ${number}`);
        } catch (e) {
          log('⚠️ send fail:', e?.message);
        }

        /* ⚠️ IMPORTANT: logout() MAT karo!
           logout = device unlink ho jata hai (401 logged out)
           Sirf socket band karo — session zinda rehti hai ✅ */
        await delay(9000);                // ⭐ sab messages deliver hone do
        cleanExit = true;
        clearTimeout(killTimer);          // ⭐ timer leak fix
        try { sock.ev.removeAllListeners(); } catch {}
        try { sock.ws.close(); } catch {}
        try { sock.end(undefined); } catch {}
        rm(dir);
        log('🎉 DONE — device linked rahega ✅');
      }

      /* ❌ CLOSED */
      if (connection === 'close') {
        if (cleanExit) return;      // kaam ho chuka, ignore

        const code = lastDisconnect?.error?.output?.statusCode
                  || lastDisconnect?.error?.output?.payload?.statusCode;

        log('🔌 CLOSE code =', code);

        /* ⭐⭐ YAHI ASLI FIX ⭐⭐
           515 / restartRequired ke baad DOBARA connect karna zaroori hai.
           Warna WhatsApp "Couldn't link device" dikhata hai. */
        if (code === 515 || code === DisconnectReason.restartRequired) {
          log('♻️  restart required → reconnecting');
          await delay(2000);
          return start(true);
        }

        // connection lost / timeout → retry
        if (code === DisconnectReason.connectionLost ||
            code === DisconnectReason.connectionClosed ||
            code === DisconnectReason.timedOut) {
          log('♻️  reconnecting...');
          await delay(3000);
          return start(true);
        }

        // logged out / bad session
        if (code === DisconnectReason.loggedOut || code === 401) {
          log('🚫 logged out');
          rm(dir); clearTimeout(killTimer);
          return;
        }

        rm(dir); clearTimeout(killTimer);
      }
    });
  }

  try {
    await start(false);
  } catch (e) {
    log('💥 ERR:', e?.message || e);
    rm(dir); clearTimeout(killTimer);
    reply({ error: e?.message || 'Service unavailable' }, 500);
  }
});

/* ══════════════════════════════════════════════════════
   🚀 DEPLOY API  (deploy.html ke liye)
   ══════════════════════════════════════════════════════ */
let D = null;
try { D = require('./deploy'); D.resumeAll(); }
catch (e) { console.log('deploy engine off:', e?.message); }

app.post('/api/deploy', async (req, res) => {
  if (!D) return res.json({ ok: false, error: 'Deploy engine unavailable', logs: [] });
  try {
    log('🚀 Deploy request:', req.body?.botName || '-');
    const out = await D.deployBot(req.body || {});
    log(out.ok ? `✅ Deployed ${out.id}` : `❌ Deploy fail: ${out.error}`);
    res.json(out);
  } catch (e) {
    res.json({ ok: false, error: e?.message || 'Deploy error', logs: [] });
  }
});

/* short token → poori creds (bot isse fetch karta hai) */
app.get('/api/session/:token', (q, r) => {
  const t = String(q.params.token).replace(/^ZAMI~/, '').replace(/[^a-z0-9]/gi, '');
  const f = path.join(STORE, t + '.json');
  if (!fs.existsSync(f)) return r.status(404).json({ error: 'Session not found' });
  r.type('json').send(fs.readFileSync(f, 'utf8'));
});

app.get('/api/bots',            (_, r) => r.json({ bots: D ? D.listBots() : [] }));
app.get('/api/bot/:id/logs',    (q, r) => r.json({ logs: D ? D.getLogs(q.params.id) : '' }));
app.post('/api/bot/:id/stop',   (q, r) => r.json({ ok: !!D && D.stopBot(q.params.id) }));
app.post('/api/bot/:id/restart',(q, r) => r.json({ ok: !!D && D.restartBot(q.params.id) }));
app.delete('/api/bot/:id',      (q, r) => r.json({ ok: !!D && D.deleteBot(q.params.id) }));

app.get('/api/health', (_, r) =>
  r.json({ ok: true, node: process.version, baileys: true, deploy: !!D,
           bots: D ? D.listBots().length : 0 }));

process.on('uncaughtException', e => { if (!noise(e?.message)) log('⚠️', e?.message); });
process.on('unhandledRejection', e => { if (!noise(e?.message)) log('⚠️', e?.message); });

// har start par purani sessions saaf (stale session = "Couldn't link device")
try { fs.rmSync(SESS, { recursive: true, force: true }); fs.mkdirSync(SESS); } catch {}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log(`🚀 ZAMI-MD → http://localhost:${PORT}`);
  log(`🧭 Browser fingerprint: macOS / Safari  ✅`);
});
