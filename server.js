// server.js (ESM) — Rainbet Leaderboard API with Supabase + snake_case mapping
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config()
const app = express()

/* ---------- Security & infra ---------- */
app.set('trust proxy', process.env.TRUST_PROXY ? process.env.TRUST_PROXY !== 'false' : true)

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

app.use(cors({
  origin(origin, cb) {
    // allow same-origin tools, curl, mobile apps, and no Origin
    if (!origin) return cb(null, true)
    if (allowedOrigins.length === 0) return cb(null, true)
    if (allowedOrigins.includes(origin)) return cb(null, true)
    return cb(new Error('Not allowed by CORS'))
  },
  credentials: true
}))

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}))
app.use(compression())
app.use(express.json({ limit: '1mb' }))

app.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
}))

/* ---------- Env ---------- */
const PORT = Number(process.env.PORT || 3001)

const ADMIN_USER = process.env.ADMIN_USER || ''
const ADMIN_PASS = process.env.ADMIN_PASS || ''

const RAINBET_API_URL = process.env.RAINBET_API_URL || 'https://services.rainbet.com/v1/external/affiliates'
const RAINBET_API_KEY = process.env.RAINBET_API_KEY || ''

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null

/* ---------- Helpers ---------- */
function basicOk(req) {
  const hdr = req.headers['authorization'] || ''
  if (!hdr.startsWith('Basic ')) return false
  try {
    const [u, p] = Buffer.from(hdr.slice(6), 'base64').toString('utf8').split(':')
    return !!u && u === ADMIN_USER && p === ADMIN_PASS
  } catch { return false }
}

function toISODate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// trailing windows unless custom range in settings
function computeRange({ period = 'weekly', customRange }) {
  if (customRange?.enabled && customRange.start && customRange.end) {
    return { startISO: customRange.start, endISO: customRange.end }
  }
  const now = new Date()
  const end = toISODate(now)
  const days = period === 'biweekly' ? 14 : period === 'monthly' ? 30 : 7
  const startDate = new Date(now.getTime() - (days - 1) * 24 * 3600 * 1000)
  const start = toISODate(startDate)
  return { startISO: start, endISO: end }
}

async function fetchRainbet(range) {
  if (!RAINBET_API_KEY) throw new Error('RAINBET_API_KEY missing')
  const url = new URL(RAINBET_API_URL)
  url.searchParams.set('start_at', range.startISO)
  url.searchParams.set('end_at', range.endISO)
  url.searchParams.set('key', RAINBET_API_KEY)

  const r = await fetch(url.toString())
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    throw new Error(`Rainbet error ${r.status}: ${t}`)
  }
  const data = await r.json().catch(() => ({}))
  const affiliates = Array.isArray(data?.affiliates) ? data.affiliates : []
  const rows = affiliates
    .filter(a => parseFloat(a.wagered_amount) > 0)
    .map(a => ({ username: a.username, wagered: Number(a.wagered_amount) || 0 }))
    .sort((a,b) => (b.wagered||0) - (a.wagered||0))
  return rows
}

/* ---------- DB mappers (snake_case <-> camelCase) ---------- */
function rowToSettingsCamel(row) {
  if (!row) return {}
  return {
    id: row.id,
    period: row.period || 'weekly',
    countdownEndISO: row.countdown_end_iso || '',
    pageSize: row.page_size || 15,
    bannerTitle: row.banner_title || '$500 Monthly Leaderboard',
    socials: row.socials || [],
    customRange: row.custom_range || null,
    prizeConfig: row.prize_config || { paidPlacements: 0, amounts: [] },
    updatedAt: row.updated_at || null,
  }
}

function camelToSettingsRow(payload) {
  return {
    id: 1,
    period: payload.period || 'weekly',
    countdown_end_iso: payload.countdownEndISO || '',
    page_size: Number(payload.pageSize || 15),
    banner_title: payload.bannerTitle || '$500 Monthly Leaderboard',
    socials: payload.socials || [],
    custom_range: payload.customRange || null,
    prize_config: payload.prizeConfig || { paidPlacements: 0, amounts: [] },
    updated_at: new Date().toISOString(),
  }
}

function rowToSnapshotCamel(row) {
  if (!row) return null
  return {
    id: row.id,
    takenAt: row.taken_at,
    period: row.period,
    bannerTitle: row.banner_title,
    range: row.range,
    data: row.data,
    prizeConfig: row.prize_config,
    image: row.image,
  }
}

function camelToSnapshotRow(obj) {
  return {
    banner_title: obj.bannerTitle,
    period: obj.period,
    range: obj.range,
    data: obj.data,
    prize_config: obj.prizeConfig,
    taken_at: obj.takenAt || new Date().toISOString(),
    image: obj.image || null,
  }
}

/* ---------- Routes ---------- */

// Health (confirm envs arrive at runtime)
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    supabase: !!supabase,
    hasUrl: !!SUPABASE_URL,
    hasKey: !!SUPABASE_SERVICE_ROLE_KEY,
    node: process.version
  })
})

// Auth
app.get('/api/auth', (req, res) => {
  if (!basicOk(req)) return res.status(401).json({ error: 'Unauthorized' })
  res.json({ ok: true })
})

// Get settings
app.get('/api/settings', async (_req, res) => {
  try {
    if (!supabase) return res.json({}) // no DB yet -> frontend will show defaults
    const { data, error } = await supabase
      .from('settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
    if (error) return res.status(500).json({ error: error.message })
    res.json(rowToSettingsCamel(data))
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// Save settings
app.post('/api/settings', async (req, res) => {
  try {
    if (!basicOk(req)) return res.status(401).json({ error: 'Unauthorized' })
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })

    const row = camelToSettingsRow(req.body || {})
    const { error } = await supabase
      .from('settings')
      .upsert(row, { onConflict: 'id' })
    if (error) return res.status(500).json({ error: error.message })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// Range (from settings or query override)
app.get('/api/range', async (req, res) => {
  try {
    const qPeriod = (req.query.period || '').toString() || null
    let settings = {}
    if (supabase) {
      const { data } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle()
      settings = rowToSettingsCamel(data)
    }
    const period = qPeriod || settings.period || 'weekly'
    const range = computeRange({ period, customRange: settings.customRange })
    res.json({ startISO: range.startISO, endISO: range.endISO })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// Leaderboard (Rainbet)
app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 15)))
    let settings = {}
    if (supabase) {
      const { data } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle()
      settings = rowToSettingsCamel(data)
    }
    const qryRange = (req.query.range || '').toString() || null
    const period = qryRange || settings.period || 'weekly'
    const range = computeRange({ period, customRange: settings.customRange })
    const data = await fetchRainbet(range)
    const top = data.slice(0, limit).map((x, i) => ({ ...x, rank: i + 1 }))
    res.json({ data: top, range, period })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// Past list
app.get('/api/past', async (_req, res) => {
  try {
    if (!supabase) return res.json({ data: [] })
    const { data, error } = await supabase
      .from('snapshots')
      .select('*')
      .order('taken_at', { ascending: false })
      .limit(100)
    if (error) return res.status(500).json({ error: error.message })
    res.json({ data: (data || []).map(rowToSnapshotCamel) })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// Past single
app.get('/api/past/:id', async (req, res) => {
  try {
    if (!supabase) return res.status(404).json({ error: 'Not configured' })
    const { data, error } = await supabase
      .from('snapshots')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle()
    if (error || !data) return res.status(404).json({ error: error?.message || 'Not found' })
    res.json(rowToSnapshotCamel(data))
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// Create snapshot (JSON only; PNG capture can be added later)
app.post('/api/snapshot', async (_req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })

    const { data: s } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle()
    const settings = rowToSettingsCamel(s) || {}
    const period = settings.period || 'weekly'
    const range = computeRange({ period, customRange: settings.customRange })
    const lb = await fetchRainbet(range)
    const prizeConfig = settings.prizeConfig || { paidPlacements: 0, amounts: [] }

    const payloadCamel = {
      bannerTitle: settings.bannerTitle || '$500 Monthly Leaderboard',
      period,
      range: { start: range.startISO, end: range.endISO },
      data: lb.map((x, i) => ({ ...x, rank: i + 1 })),
      prizeConfig,
      takenAt: new Date().toISOString(),
      image: null,
    }
    const row = camelToSnapshotRow(payloadCamel)

    const { data: ins, error } = await supabase
      .from('snapshots')
      .insert(row)
      .select('id')
      .maybeSingle()
    if (error) return res.status(500).json({ error: error.message })
    res.json({ ok: true, id: ins?.id })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

/* ---------- Serve built frontend ---------- */
app.use(express.static('dist'))
app.get('*', (_req, res) => {
  res.sendFile(process.cwd() + '/dist/index.html')
})

app.listen(PORT, () => {
  console.log('API ready on http://localhost:' + PORT)
})
