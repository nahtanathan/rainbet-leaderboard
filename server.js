import express from 'express'
import fs from 'fs'
import path, { resolve } from 'path'
import cors from 'cors'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import puppeteer from 'puppeteer'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: resolve(__dirname, '.env') })

const app = express()
const PORT = 3001

app.use(cors())
app.use(express.json())

const dataDir = path.join(__dirname, 'data')
const settingsPath = path.join(dataDir, 'settings.json')
const snapshotsDir = path.join(dataDir, 'snapshots')
fs.mkdirSync(snapshotsDir, { recursive: true })
app.use('/snapshots', express.static(snapshotsDir))

const DEFAULT_SETTINGS = {
  period: 'weekly',
  countdown: { value: 7, unit: 'days' },
  pageSize: 15,
  bannerTitle: '$500 Monthly Leaderboard',
  socials: [{ name: 'Twitter', url: 'https://twitter.com/' }, { name: 'Discord', url: 'https://discord.gg/' }],
  customRange: { enabled: false, start: '', end: '' } // YYYY-MM-DD
}

function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath, 'utf8')) }
  catch { return { ...DEFAULT_SETTINGS } }
}
function writeSettings(s) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2), 'utf8')
}

const VALID_UNITS = ['minutes','hours','days','weeks']

function ymd(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
function windowFor(period, customRange){
  if (customRange?.enabled && customRange?.start && customRange?.end) {
    return { start: customRange.start, end: customRange.end, source: 'custom' }
  }
  const now = new Date()
  const days = period === 'biweekly' ? 14 : period === 'monthly' ? 30 : 7
  const end = ymd(now)
  const startDate = new Date(now.getTime() - (days - 1) * 24 * 3600 * 1000)
  const start = ymd(startDate)
  return { start, end, source: 'computed' }
}

function checkBasicAuth(req){
  const hdr = String(req.headers['authorization']||'')
  if (!hdr.startsWith('Basic ')) return false
  const decoded = Buffer.from(hdr.slice(6), 'base64').toString('utf8')
  const [user, pass] = decoded.split(':')
  const U = (process.env.ADMIN_USER||'').trim()
  const P = (process.env.ADMIN_PASS||'').trim()
  return (user||'').trim() === U && (pass||'').trim() === P
}

// --- debug (no secrets) ---
app.get('/api/debug', (_req, res) => {
  res.json({
    hasEnv: {
      RAINBET_API_URL: !!process.env.RAINBET_API_URL,
      RAINBET_API_KEY: !!process.env.RAINBET_API_KEY,
      ADMIN_USER: !!process.env.ADMIN_USER,
      ADMIN_PASS: !!process.env.ADMIN_PASS,
      RANGE_URL: !!process.env.RAINBET_RANGE_URL
    }
  })
})

// --- auth probe ---
app.get('/api/auth', (req, res) => {
  if (!checkBasicAuth(req)) return res.status(401).json({ ok: false })
  res.json({ ok: true })
})

// --- settings ---
app.get('/api/settings', (req, res) => {
  const s = readSettings()
  let out = { ...DEFAULT_SETTINGS, ...s }
  if (typeof s?.countdown === 'number') {
    const value = Math.max(1, Math.round(s.countdown / 86400)) || 7
    out = { ...DEFAULT_SETTINGS, ...s, countdown: { value, unit: 'days' } }
  }
  if (!out.bannerTitle) out.bannerTitle = DEFAULT_SETTINGS.bannerTitle
  if (!Array.isArray(out.socials)) out.socials = DEFAULT_SETTINGS.socials
  if (!out.customRange) out.customRange = DEFAULT_SETTINGS.customRange
  out.pageSize = Math.min(100, Math.max(1, Number(out.pageSize || 15)))
  res.json(out)
})

app.post('/api/settings', (req, res) => {
  if (!checkBasicAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  const { period, countdown, pageSize, bannerTitle, socials, customRange } = req.body || {}
  if (!['weekly','biweekly','monthly'].includes(period)) return res.status(400).json({ error: 'Invalid period' })
  const value = Number(countdown?.value), unit = countdown?.unit
  if (!Number.isFinite(value) || value < 0 || !VALID_UNITS.includes(unit)) return res.status(400).json({ error: 'Invalid countdown { value, unit }' })
  const size = Math.min(100, Math.max(1, Number(pageSize || 15)))
  const title = String(bannerTitle || '').slice(0, 80) || DEFAULT_SETTINGS.bannerTitle
  const soc = Array.isArray(socials) ? socials.slice(0,5).map(it => ({
    name: String(it?.name||'').slice(0,20) || 'Link',
    url: String(it?.url||'').slice(0,200)
  })) : DEFAULT_SETTINGS.socials

  let cr = DEFAULT_SETTINGS.customRange
  if (customRange && typeof customRange === 'object') {
    const en = !!customRange.enabled
    const s = String(customRange.start || '').trim()
    const e = String(customRange.end || '').trim()
    const isDate = (x)=>/^\d{4}-\d{2}-\d{2}$/.test(x)
    cr = { enabled: en && isDate(s) && isDate(e), start: isDate(s) ? s : '', end: isDate(e) ? e : '' }
  }

  const out = {
    period,
    countdown: { value: Math.floor(value), unit },
    pageSize: size,
    bannerTitle: title,
    socials: soc,
    customRange: cr
  }
  writeSettings(out)
  res.json({ ok: true, settings: out })
})

// --- range (custom > api > computed) ---
app.get('/api/range', async (req, res) => {
  try {
    const s = readSettings()
    const period = req.query.period || s.period || 'weekly'
    const { start, end, source } = windowFor(period, s.customRange)
    const KEY = process.env.RAINBET_API_KEY
    const API_RANGE = process.env.RAINBET_RANGE_URL || process.env.RAINBET_API_URL

    if (source === 'custom') return res.json({ period, startISO: `${start}T00:00:00Z`, endISO: `${end}T23:59:59Z`, source })

    if (!API_RANGE || !KEY) return res.json({ period, startISO: `${start}T00:00:00Z`, endISO: `${end}T23:59:59Z`, source })

    const url = new URL(API_RANGE)
    url.searchParams.set('start_at', start)
    url.searchParams.set('end_at', end)
    url.searchParams.set('key', KEY)

    const r = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
    if (!r.ok) throw new Error(`Upstream ${r.status}`)
    const json = await r.json()

    const startGuess = json?.range?.start || json?.meta?.start_at || json?.start_at || null
    const endGuess   = json?.range?.end   || json?.meta?.end_at   || json?.end_at   || null

    if (startGuess && endGuess) {
      return res.json({ period, startISO: new Date(startGuess).toISOString(), endISO: new Date(endGuess).toISOString(), source: 'api' })
    }
    res.json({ period, startISO: `${start}T00:00:00Z`, endISO: `${end}T23:59:59Z`, source })
  } catch (e) {
    console.error('range error', e); res.status(500).json({ error: 'range failed' })
  }
})

// --- leaderboard ---
app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 100)
    const s = readSettings()
    const rangeKey = req.query.range || s.period || 'weekly'
    const { start, end } = windowFor(rangeKey, s.customRange)
    const API = process.env.RAINBET_API_URL
    const KEY = process.env.RAINBET_API_KEY

    if (!API || !KEY) {
      const names = ['AceHigh','LuckyLuna','SpinWizard','CryptoShark','RainRunner','NeonNate','VaultVixen','BettyBytes','DiceDuke','JackpotJay']
      const data = Array.from({ length: limit }).map((_, i) => ({
        rank: i + 1,
        username: `${names[i % names.length]}${i + 1}`,
        wagered: Math.floor(Math.random() * 100000),
        bets: Math.floor(Math.random() * 1500 + 100),
      }))
      return res.json({ data, meta: { start, end } })
    }

    const url = new URL(API)
    url.searchParams.set('start_at', start)
    url.searchParams.set('end_at', end)
    url.searchParams.set('key', KEY)

    const r = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
    if (!r.ok) throw new Error(`Rainbet ${r.status}`)
    const json = await r.json()

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
      }))

    res.json({ data: entries, meta: { start, end } })
  } catch (e) {
    console.error('leaderboard proxy error', e)
    res.status(500).json({ error: 'Failed to load leaderboard' })
  }
})

// --- snapshot (JSON + PNG) ---
app.post('/api/snapshot', async (req, res) => {
  try {
    const s = readSettings()
    const limit = Math.min(parseInt(req.query.limit || String(s.pageSize || 15), 10), 100)
    const rangeKey = s.period || 'weekly'
    const { start, end } = windowFor(rangeKey, s.customRange)

    // fetch fresh data from our own API to ensure consistency
    const lbRes = await fetch(`http://localhost:${PORT}/api/leaderboard?limit=${limit}&range=${encodeURIComponent(rangeKey)}`)
    const lbJson = await lbRes.json()

    const now = new Date()
    const id = now.toISOString().replace(/[:.]/g,'-')
    const snapshot = {
      id,
      takenAt: now.toISOString(),
      period: s.period,
      range: { start, end },
      bannerTitle: s.bannerTitle,
      socials: s.socials,
      pageSize: s.pageSize,
      data: lbJson.data || []
    }
    const jsonFile = path.join(snapshotsDir, `${id}.json`)
    fs.writeFileSync(jsonFile, JSON.stringify(snapshot, null, 2), 'utf8')

    // PNG with Puppeteer by opening the dedicated route
    const SITE_ORIGIN = (process.env.SITE_ORIGIN || 'http://localhost:5173').replace(/\/$/, '')
    const url = `${SITE_ORIGIN}/#/snapshot/${id}`
    const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] })
    const page = await browser.newPage()
    page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
    await page.waitForSelector('[data-snapshot-ready="1"]', { timeout: 20000 }).catch(()=>{})
    const pngPath = path.join(snapshotsDir, `${id}.png`)
    await page.screenshot({ path: pngPath, type: 'png' })
    await browser.close()

    res.json({ ok: true, id, image: `/snapshots/${id}.png` })
  } catch (e) {
    console.error('snapshot error', e)
    res.status(500).json({ error: 'Failed to create snapshot' })
  }
})

app.get('/api/past', (req, res) => {
  try {
    const files = fs.readdirSync(snapshotsDir).filter(f => f.endsWith('.json'))
    const list = files.map(f => {
      const p = path.join(snapshotsDir, f)
      const j = JSON.parse(fs.readFileSync(p, 'utf8'))
      const img = path.join(snapshotsDir, `${j.id}.png`)
      return { id: j.id, takenAt: j.takenAt, period: j.period, range: j.range, bannerTitle: j.bannerTitle, image: fs.existsSync(img) ? `/snapshots/${j.id}.png` : null }
    }).sort((a,b)=> new Date(b.takenAt) - new Date(a.takenAt))
    res.json({ data: list })
  } catch (e) {
    console.error('past error', e)
    res.status(500).json({ error: 'Failed to list snapshots' })
  }
})

app.get('/api/past/:id', (req, res) => {
  try {
    const file = path.join(snapshotsDir, `${req.params.id}.json`)
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' })
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    res.json(j)
  } catch (e) {
    console.error('past id error', e)
    res.status(500).json({ error: 'Failed to load snapshot' })
  }
})

app.listen(PORT, () => console.log(`API ready on http://localhost:${PORT}`))
