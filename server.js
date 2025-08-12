// server.js — Render-ready + Security-hardened (v7.5 compatible)
import express from 'express';
import fs from 'fs';
import path, { resolve } from 'path';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import puppeteer from 'puppeteer';

// ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env
dotenv.config({ path: resolve(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

// ---------- Security: CORS + Helmet + rate limits ----------
const ALLOWED_ORIGINS = [
  process.env.SITE_ORIGIN,            // e.g. https://yourdomain.com
  process.env.RENDER_EXTERNAL_URL     // Render sets this automatically
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin requests (no Origin header) and allowed list
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  }
}));

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false,       // Turn on later once you whitelist exact sources
  crossOriginEmbedderPolicy: false
}));

// Global parsers
app.use(express.json());

// Rate limits
const apiLimiter   = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }); // all /api/*
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50 });  // write/priv routes
app.use('/api/', apiLimiter);

// ---------- Data locations ----------
const dataDir = path.join(__dirname, 'data');
const settingsPath = path.join(dataDir, 'settings.json');
const snapshotsDir = path.join(dataDir, 'snapshots');
fs.mkdirSync(snapshotsDir, { recursive: true });

// Archive visibility (default: protected)
const SNAPSHOTS_PUBLIC = String(process.env.SNAPSHOTS_PUBLIC || '').toLowerCase() === 'true';

// ---------- Defaults & helpers ----------
const DEFAULT_SETTINGS = {
  period: 'weekly',                                    // 'weekly' | 'biweekly' | 'monthly'
  countdown: { value: 7, unit: 'days' },              // weeks/days/hours/minutes
  pageSize: 15,
  bannerTitle: '$500 Monthly Leaderboard',
  socials: [
    { name: 'Twitter', url: 'https://twitter.com/' },
    { name: 'Discord', url: 'https://discord.gg/' }
  ],
  customRange: { enabled: false, start: '', end: '' }  // YYYY-MM-DD
};
const VALID_UNITS = ['minutes','hours','days','weeks'];

function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }
  catch { return { ...DEFAULT_SETTINGS }; }
}
function writeSettings(s) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2), 'utf8');
}
function ymd(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function windowFor(period, customRange) {
  if (customRange?.enabled && customRange?.start && customRange?.end) {
    return { start: customRange.start, end: customRange.end, source: 'custom' };
  }
  const now = new Date();
  const days = period === 'biweekly' ? 14 : period === 'monthly' ? 30 : 7;
  const end = ymd(now);
  const startDate = new Date(now.getTime() - (days - 1) * 24 * 3600 * 1000);
  const start = ymd(startDate);
  return { start, end, source: 'computed' };
}
function checkBasicAuth(req){
  const hdr = String(req.headers['authorization']||'');
  if (!hdr.startsWith('Basic ')) return false;
  const decoded = Buffer.from(hdr.slice(6), 'base64').toString('utf8');
  const [user, pass] = decoded.split(':');
  const U = (process.env.ADMIN_USER||'').trim();
  const P = (process.env.ADMIN_PASS||'').trim();
  return (user||'').trim() === U && (pass||'').trim() === P;
}
function requireAdmin(req, res, next) {
  if (!checkBasicAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ---------- Debug (admin-only) ----------
app.get('/api/debug', requireAdmin, (_req, res) => {
  res.json({
    hasEnv: {
      RAINBET_API_URL: !!process.env.RAINBET_API_URL,
      RAINBET_API_KEY: !!process.env.RAINBET_API_KEY,
      ADMIN_USER: !!process.env.ADMIN_USER,
      ADMIN_PASS: !!process.env.ADMIN_PASS,
      SITE_ORIGIN: !!process.env.SITE_ORIGIN
    }
  });
});

// ---------- Auth probe (Basic) ----------
app.get('/api/auth', (req, res) => {
  if (!checkBasicAuth(req)) return res.status(401).json({ ok: false });
  res.json({ ok: true });
});

// ---------- Settings ----------
app.get('/api/settings', (_req, res) => {
  const s = readSettings();
  let out = { ...DEFAULT_SETTINGS, ...s };
  // Back-compat: if countdown was seconds
  if (typeof s?.countdown === 'number') {
    const value = Math.max(1, Math.round(s.countdown / 86400)) || 7;
    out = { ...DEFAULT_SETTINGS, ...s, countdown: { value, unit: 'days' } };
  }
  if (!out.bannerTitle) out.bannerTitle = DEFAULT_SETTINGS.bannerTitle;
  if (!Array.isArray(out.socials)) out.socials = DEFAULT_SETTINGS.socials;
  if (!out.customRange) out.customRange = DEFAULT_SETTINGS.customRange;
  out.pageSize = Math.min(100, Math.max(1, Number(out.pageSize || 15)));
  res.json(out);
});

app.post('/api/settings', requireAdmin, adminLimiter, (req, res) => {
  const { period, countdown, pageSize, bannerTitle, socials, customRange } = req.body || {};
  if (!['weekly','biweekly','monthly'].includes(period)) return res.status(400).json({ error: 'Invalid period' });
  const value = Number(countdown?.value), unit = countdown?.unit;
  if (!Number.isFinite(value) || value < 0 || !VALID_UNITS.includes(unit)) return res.status(400).json({ error: 'Invalid countdown { value, unit }' });
  const size = Math.min(100, Math.max(1, Number(pageSize || 15)));
  const title = String(bannerTitle || '').slice(0, 80) || DEFAULT_SETTINGS.bannerTitle;
  const soc = Array.isArray(socials)
    ? socials.slice(0,5).map(it => ({
        name: String(it?.name||'').slice(0,20) || 'Link',
        url: String(it?.url||'').slice(0,200)
      }))
    : DEFAULT_SETTINGS.socials;

  let cr = DEFAULT_SETTINGS.customRange;
  if (customRange && typeof customRange === 'object') {
    const en = !!customRange.enabled;
    const s = String(customRange.start || '').trim();
    const e = String(customRange.end || '').trim();
    const isDate = (x)=>/^\d{4}-\d{2}-\d{2}$/.test(x);
    cr = { enabled: en && isDate(s) && isDate(e), start: isDate(s) ? s : '', end: isDate(e) ? e : '' };
  }

  const out = {
    period,
    countdown: { value: Math.floor(value), unit },
    pageSize: size,
    bannerTitle: title,
    socials: soc,
    customRange: cr
  };
  writeSettings(out);
  res.json({ ok: true, settings: out });
});

// ---------- Range ----------
app.get('/api/range', (req, res) => {
  try {
    const s = readSettings();
    const period = req.query.period || s.period || 'weekly';
    const { start, end, source } = windowFor(period, s.customRange);
    res.json({ period, startISO: `${start}T00:00:00Z`, endISO: `${end}T23:59:59Z`, source });
  } catch (e) {
    console.error('range error', e);
    res.status(500).json({ error: 'range failed' });
  }
});

// ---------- Leaderboard (Rainbet proxy) ----------
app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 100);
    const s = readSettings();
    const rangeKey = req.query.range || s.period || 'weekly';
    const { start, end } = windowFor(rangeKey, s.customRange);
    const API = process.env.RAINBET_API_URL;
    const KEY = process.env.RAINBET_API_KEY;

    if (!API || !KEY) {
      // Fallback mock so UI isn’t blank
      const names = ['AceHigh','LuckyLuna','SpinWizard','CryptoShark','RainRunner','NeonNate','VaultVixen','BettyBytes','DiceDuke','JackpotJay'];
      const data = Array.from({ length: limit }).map((_, i) => ({
        rank: i + 1,
        username: `${names[i % names.length]}${i + 1}`,
        wagered: Math.floor(Math.random() * 100000),
        bets: Math.floor(Math.random() * 1500 + 100),
      }));
      return res.json({ data, meta: { start, end, mock: true } });
    }

    const url = new URL(API);
    url.searchParams.set('start_at', start);
    url.searchParams.set('end_at', end);
    url.searchParams.set('key', KEY);

    const r = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`Rainbet ${r.status}`);
    const json = await r.json();

    const entries = (json?.affiliates ?? [])
      .filter(a => Number(a?.wagered_amount) > 0)
      .sort((a,b) => Number(b?.wagered_amount || 0) - Number(a?.wagered_amount || 0))
      .slice(0, limit)
      .map((a, i) => ({
        rank: i + 1,
        username: a?.username ?? `User${i+1}`,
        wagered: Number(a?.wagered_amount || 0),
        bets: Number(a?.bets || 0),
        user_id: a?.user_id ?? a?.id ?? (1000 + i),
      }));

    res.json({ data: entries, meta: { start, end } });
  } catch (e) {
    console.error('leaderboard proxy error', e);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

// ---------- Snapshot (JSON + PNG)
// Prevent concurrent Puppeteer runs (simple mutex)
let snapshotRunning = false;
app.post('/api/snapshot', requireAdmin, adminLimiter, async (_req, res) => {
  if (snapshotRunning) return res.status(429).json({ error: 'Snapshot already in progress' });
  snapshotRunning = true;
  try {
    const s = readSettings();
    const limit = Math.min(parseInt(String(s.pageSize || 15), 10), 100);
    const rangeKey = s.period || 'weekly';
    const { start, end } = windowFor(rangeKey, s.customRange);

    // Fetch current data via our own API (consistent with UI)
    const lbRes = await fetch(`http://localhost:${PORT}/api/leaderboard?limit=${limit}&range=${encodeURIComponent(rangeKey)}`);
    const lbJson = await lbRes.json();

    const now = new Date();
    const id = now.toISOString().replace(/[:.]/g,'-');
    const snapshot = {
      id,
      takenAt: now.toISOString(),
      period: s.period,
      range: { start, end },
      bannerTitle: s.bannerTitle,
      socials: s.socials,
      pageSize: s.pageSize,
      data: Array.isArray(lbJson.data) ? lbJson.data : []
    };
    const jsonFile = path.join(snapshotsDir, `${id}.json`);
    fs.writeFileSync(jsonFile, JSON.stringify(snapshot, null, 2), 'utf8');

    // PNG via Puppeteer hitting the dedicated client route
    const SITE_ORIGIN = (process.env.SITE_ORIGIN || `http://localhost:${PORT}`).replace(/\/$/, '');
    const url = `${SITE_ORIGIN}/#/snapshot/${id}`;
    const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('[data-snapshot-ready="1"]', { timeout: 20000 }).catch(()=>{});
    const pngPath = path.join(snapshotsDir, `${id}.png`);
    await page.screenshot({ path: pngPath, type: 'png' });
    await browser.close();

    res.json({ ok: true, id, image: `/snapshots/${id}.png` });
  } catch (e) {
    console.error('snapshot error', e);
    res.status(500).json({ error: 'Failed to create snapshot' });
  } finally {
    snapshotRunning = false;
  }
});

// ---------- Past listings (protected by default)
const pastHandlers = {
  list: (_req, res) => {
    try {
      const files = fs.readdirSync(snapshotsDir).filter(f => f.endsWith('.json'));
      const list = files.map(f => {
        const p = path.join(snapshotsDir, f);
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        const img = path.join(snapshotsDir, `${j.id}.png`);
        return { id: j.id, takenAt: j.takenAt, period: j.period, range: j.range, bannerTitle: j.bannerTitle, image: fs.existsSync(img) ? `/snapshots/${j.id}.png` : null };
      }).sort((a,b)=> new Date(b.takenAt) - new Date(a.takenAt));
      res.json({ data: list });
    } catch (e) {
      console.error('past error', e);
      res.status(500).json({ error: 'Failed to list snapshots' });
    }
  },
  get: (req, res) => {
    try {
      const file = path.join(snapshotsDir, `${req.params.id}.json`);
      if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      res.json(j);
    } catch (e) {
      console.error('past id error', e);
      res.status(500).json({ error: 'Failed to load snapshot' });
    }
  }
};

// Protect /api/past unless SNAPSHOTS_PUBLIC=true
if (SNAPSHOTS_PUBLIC) {
  app.get('/api/past', pastHandlers.list);
  app.get('/api/past/:id', pastHandlers.get);
  app.use('/snapshots', express.static(snapshotsDir));
} else {
  app.get('/api/past', requireAdmin, adminLimiter, pastHandlers.list);
  app.get('/api/past/:id', requireAdmin, adminLimiter, pastHandlers.get);
  app.use('/snapshots', requireAdmin, express.static(snapshotsDir));
}

// ---------- Serve the built frontend (fixes “Cannot GET /” on Render) ----------
app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback (don’t swallow API/snapshots)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/snapshots')) return next();
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ---------- Centralized error handler ----------
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

// ---------- Start ----------
app.listen(PORT, () => console.log(`API ready on http://localhost:${PORT}`));
