// server.js (ESM) — Express API for Rainbet Leaderboard with Supabase settings + snapshots
// Drop-in replacement. Requires Node 18+ (native fetch), Render-friendly.

import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config()

const app = express()

// ----- Security & infra -----
app.set('trust proxy', process.env.TRUST_PROXY ? process.env.TRUST_PROXY !== 'false' : true)

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
const corsOpts = {
  origin: function (origin, cb) {
    // allow same-origin, mobile apps, curl, and no Origin
    if (!origin) return cb(null, true)
    if (allowedOrigins.length === 0) return cb(null, true)
    if (allowedOrigins.includes(origin)) return cb(null, true)
    return cb(new Error('Not allowed by CORS'))
  },
  credentials: true,
}
app.use(cors(corsOpts))
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}))
app.use(compression())
app.use(express.json({ limit: '1mb' }))

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
})
app.use(limiter)

// ----- Env -----
const PORT = Number(process.env.PORT || 3001)

const ADMIN_USER = process.env.ADMIN_USER || ''
const ADMIN_PASS = process.env.ADMIN_PASS || ''

const RAINBET_API_URL = process.env.RAINBET_API_URL || 'https://services.rainbet.com/v1/external/affiliates'
const RAINBET_API_KEY = process.env.RAINBET_API_KEY || ''

// Supabase: use SERVICE ROLE key server-side so RLS won't block settings writes
const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null

// ----- Helpers -----
function basicOk(req) {
  const hdr = req.headers['authorization'] || ''
  if (!hdr.startsWith('Basic ')) return false
  try {
    const b64 = hdr.slice(6)
    const raw = Buffer.from(b64, 'base64').toString('utf8')
    const [u, p] = raw.split(':')
    return u === ADMIN_USER && p === ADMIN_PASS && !!u
  } catch {
    return false
  }
}

function toISODate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// period: weekly / biweekly / monthly (trailing windows), or custom range
function computeRange({ period = 'weekly', customRange }) {
  if (customRange?.enabled && customRange.start && customRange.end) {
    return { startISO: customRange.start, endISO: customRange.end }
  }
  const now = new Date()
  const end = toISODate(now) // inclusive end (today)
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

  const r = await fetch(url.toString(), { method: 'GET' })
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    throw new Error(`Rainbet error ${r.status}: ${t}`)
  }
  const data = await r.json().catch(() => ({}))
  const affiliates = Array.isArray(data?.affiliates) ? data.affiliates : []
  const rows = affiliates
    .filter(a => parseFloat(a.wagered_amount) > 0)
    .map(a => ({
      username: a.username,
      wagered: Number(a.wagered_amount) || 0,
    }))
    .sort((a,b) => (b.wagered||0) - (a.wagered||0))
  return rows
}

// ----- Routes -----

// Health
app.get('/api/health', (_req, res) => res.json({ ok: true }))

// Auth check
app.get('/api/auth', (req, res) => {
  if (!basicOk(req)) return res.status(401).json({ error: 'Unauthorized' })
  res.json({ ok: true })
})

// Settings: stored in Supabase table "settings" with primary key id='singleton'
app.get('/api/settings', async (_req, res) => {
  try {
    if (!supabase) return res.json({}) // fall back
    const { data, error } = await supabase.from('settings').select('*').eq('id', 'singleton').single()
    if (error && error.code !== 'PGRST116') { // not found
      return res.status(500).json({ error: error.message })
    }
    res.json(data || {})
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

app.post('/api/settings', async (req, res) => {
  try {
    if (!basicOk(req)) return res.status(401).json({ error: 'Unauthorized' })
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })

    const payload = req.body || {}
    const upsert = { id: 'singleton', ...payload, updated_at: new Date().toISOString() }

    const { error } = await supabase.from('settings').upsert(upsert, { onConflict: 'id' })
    if (error) return res.status(500).json({ error: error.message })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// Range endpoint (computed from settings.period or query param)
app.get('/api/range', async (req, res) => {
  try {
    const qPeriod = (req.query.period || '').toString() || null
    let settings = {}
    if (supabase) {
      const { data } = await supabase.from('settings').select('*').eq('id','singleton').single()
      settings = data || {}
    }
    const period = qPeriod || settings.period || 'weekly'
    const range = computeRange({ period, customRange: settings.customRange })
    res.json(range)
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// Leaderboard: fetch from Rainbet within range and limit
app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 15)))
    let settings = {}
    if (supabase) {
      const { data } = await supabase.from('settings').select('*').eq('id','singleton').single()
      settings = data || {}
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

// Past snapshots list / single — stored in table "snapshots" (JSONB)
app.get('/api/past', async (_req, res) => {
  try {
    if (!supabase) return res.json({ data: [] })
    const { data, error } = await supabase.from('snapshots').select('*').order('takenAt', { ascending: false }).limit(100)
    if (error) return res.status(500).json({ error: error.message })
    res.json({ data })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

app.get('/api/past/:id', async (req, res) => {
  try {
    if (!supabase) return res.status(404).json({ error: 'Not configured' })
    const { data, error } = await supabase.from('snapshots').select('*').eq('id', req.params.id).single()
    if (error) return res.status(404).json({ error: error.message })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// Create snapshot (stores JSON only — PNG capture can be added later with puppeteer)
app.post('/api/snapshot', async (_req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })
    // read current settings & range & leaderboard
    const { data: s } = await supabase.from('settings').select('*').eq('id','singleton').single()
    const settings = s || {}
    const period = settings.period || 'weekly'
    const range = computeRange({ period, customRange: settings.customRange })
    const data = await fetchRainbet(range)
    const prizeConfig = settings.prizeConfig || { paidPlacements: 0, amounts: [] }
    const payload = {
      bannerTitle: settings.bannerTitle || '$500 Monthly Leaderboard',
      period,
      range: { start: range.startISO, end: range.endISO },
      data: data.map((x, i) => ({ ...x, rank: i + 1 })),
      prizeConfig,
      takenAt: new Date().toISOString(),
      image: null, // future PNG URL
    }
    const { data: ins, error } = await supabase.from('snapshots').insert(payload).select('id').single()
    if (error) return res.status(500).json({ error: error.message })
    res.json({ ok: true, id: ins.id })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// Serve built frontend (Vite build) if present
app.use(express.static('dist'))
app.get('*', (_req, res) => {
  res.sendFile(process.cwd() + '/dist/index.html')
})

app.listen(PORT, () => {
  console.log('API ready on http://localhost:' + PORT)
})
