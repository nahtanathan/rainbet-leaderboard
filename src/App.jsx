import React, { useState, useEffect, useMemo, useRef } from 'react'

/* utils */
const PERIODS = { weekly:'Weekly', biweekly:'Biweekly', monthly:'Monthly' }
const UNIT_SECONDS = { minutes:60, hours:3600, days:86400, weeks:604800 }
const toSeconds = (v,u) => Math.max(0, Math.floor((Number(v)||0) * (UNIT_SECONDS[u] || 60)))
const fmtNum = (n) => new Intl.NumberFormat().format(Number(n) || 0)
const fmtClock = (secs) => {
  const s = Math.max(0, Number(secs) || 0)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const hhmmss = [h,m,ss].map(x=>String(x).padStart(2,'0')).join(':')
  return d>0 ? `${d}d ${hhmmss}` : hhmmss
}
const maskName = (name='') => {
  const head = String(name).slice(0,4)
  const rest = Math.max(4, Math.max(0, String(name).length - 4))
  return head + '*'.repeat(rest)
}
const cx = (...v) => v.filter(Boolean).join(' ')

/* api */
async function getJSON(url, opts) {
  const r = await fetch(url, opts).catch(()=>null)
  if (!r || !r.ok) return null
  return r.json().catch(()=>null)
}
function useRoute() {
  const [r,setR] = useState(window.location.hash || '#/')
  useEffect(()=>{ const onH=()=>setR(window.location.hash||'#/'); window.addEventListener('hashchange',onH); return ()=>window.removeEventListener('hashchange',onH)},[])
  return r.replace(/^#/, '')
}

/* app */
export default function App() {
  const route = useRoute()
  if (route.startsWith('/admin')) return <AdminControls />
  if (route.startsWith('/past')) return <PastPage />
  if (route.startsWith('/snapshot/')) {
    const id = route.split('/')[2]
    return <SnapshotView id={id} />
  }
  return <Leaderboard />
}

/* leaderboard */
function Leaderboard() {
  const [period, setPeriod] = useState('weekly')
  const [countdown, setCountdown] = useState(0)
  const [rows, setRows] = useState([])
  const [pageSize, setPageSize] = useState(15)
  const [bannerTitle, setBannerTitle] = useState('$500 Monthly Leaderboard')
  const [socials, setSocials] = useState([])
  const [rangeInfo, setRangeInfo] = useState(null)
  const [prizeConfig, setPrizeConfig] = useState({ paidPlacements: 0, amounts: [] })
  const [loading, setLoading] = useState(true)
  const snappedRef = useRef(false)

  useEffect(() => {
    (async () => {
      const s = await getJSON('/api/settings')
      if (s) {
        setPeriod(s.period || 'weekly')
        setCountdown(toSeconds(s?.countdown?.value, s?.countdown?.unit))
        setPageSize(Math.min(100, Math.max(1, Number(s?.pageSize || 15))))
        setBannerTitle(s.bannerTitle || '$500 Monthly Leaderboard')
        setSocials(Array.isArray(s.socials) ? s.socials : [])
        setPrizeConfig(s.prizeConfig || { paidPlacements: 0, amounts: [] })
        await refreshRange(s.period || 'weekly')
        await loadBoard(s.period || 'weekly', Math.min(100, Math.max(1, Number(s?.pageSize || 15))))
      } else {
        await refreshRange('weekly')
        await loadBoard('weekly', 15)
      }
    })()
  }, [])

  async function refreshRange(p) {
    const r = await getJSON('/api/range?period=' + encodeURIComponent(p || period))
    if (r) setRangeInfo(r)
  }

  useEffect(() => {
    const t = setInterval(()=>{
      setCountdown(c => {
        const next = c>0?c-1:0
        if (next===0 && !snappedRef.current) {
          snappedRef.current = true
          fetch('/api/snapshot', { method:'POST' }).catch(()=>{})
        }
        return next
      })
    }, 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const t = setInterval(async () => { await loadBoard(period, pageSize) }, 5*60*1000)
    return () => clearInterval(t)
  }, [period, pageSize])

  async function loadBoard(p, n) {
    setLoading(true)
    const params = new URLSearchParams({ range: p || 'weekly', limit: String(n || 100) })
    const data = await getJSON('/api/leaderboard?' + params.toString())
    const list = Array.isArray(data?.data) ? data.data : []
    const sorted = [...list].sort((a,b)=> (Number(b.wagered)||0) - (Number(a.wagered)||0)).slice(0, n||15)
    setRows(sorted)
    setLoading(false)
  }

  const first = rows[0]
  const second = rows[1]
  const third = rows[2]
  const rest = rows.slice(3)

  return (
    <div className="rb-root">
      <Styles />
      <header className="rb-header">
        <div className="rb-brand">
          <span className="rb-logo" aria-hidden>
            <svg viewBox="0 0 64 64" width="28" height="28">
              <defs><linearGradient id="rb-g" x1="0" x2="1"><stop offset="0%" stopColor="#22d3ee"/><stop offset="100%" stopColor="#3b82f6"/></linearGradient></defs>
              <path d="M32 6C24 18 14 28 14 40a18 18 0 1 0 36 0c0-12-10-22-18-34Z" fill="url(#rb-g)" />
            </svg>
          </span>
          <div>
            <h1 className="rb-title">Rainbet Leaderboard</h1>
            <p className="rb-sub">Auto‑refresh · every 5 minutes</p>
          </div>
        </div>
        <div className="rb-header-right">
          <span className="rb-pill"><span className="rb-k">Period:</span> {PERIODS[period] || 'Weekly'}</span>
          <span className="rb-pill"><span className="rb-k">Time remaining:</span> {fmtClock(countdown)}</span>
          <a className="rb-link" href="#/past">Past</a>
          <a className="rb-link" href="#/admin">Admin</a>
        </div>
      </header>

      {/* Banner */}
      <div className="rb-banner">
        <div className="rb-banner-inner">
          <div className="rb-banner-accent" />
          <h2 className="rb-banner-title">{bannerTitle}</h2>
          {rangeInfo && <div className="rb-sub" style={{marginTop:6}}>Range: {rangeInfo.startISO?.slice(0,10)} → {rangeInfo.endISO?.slice(0,10)} ({rangeInfo.source})</div>}
          {/* Payout summary */}
          {prizeConfig?.paidPlacements > 0 && (
            <div className="rb-payout-summary">
              {Array.from({length: prizeConfig.paidPlacements}).map((_,i)=>(
                <span key={i} className="rb-paychip">#{i+1} pays {fmtCurrency(prizeConfig.amounts?.[i] || 0)}</span>
              ))}
            </div>
          )}
          {socials?.length > 0 && (
            <div className="rb-socials">
              {socials.map((s,i)=>(<a key={i} href={s.url} target="_blank" rel="noreferrer" className="rb-social-link">{s.name}</a>))}
            </div>
          )}
        </div>
      </div>

      <main className="rb-main">
        {/* Podium: 1 on top, 2 & 3 below side-by-side */}
        <section className="rb-podium-v2">
          <div className="rb-champ-wrap">
            {loading ? <ChampSkeleton/> : <ChampCard item={first} payout={payoutFor(1, prizeConfig)} />}
          </div>
          <div className="rb-runner-wrap">
            <div className="rb-runner">
              {loading ? <RunnerSkeleton/> : <RunnerCard place={2} item={second} payout={payoutFor(2, prizeConfig)} />}
            </div>
            <div className="rb-runner">
              {loading ? <RunnerSkeleton/> : <RunnerCard place={3} item={third} payout={payoutFor(3, prizeConfig)} />}
            </div>
          </div>
        </section>

        {/* Table for the rest */}
        <section className="rb-table-wrap">
          <table className="rb-table" role="table" aria-label="Leaderboard">
            <thead>
              <tr>
                <Th w="4rem">#</Th>
                <Th>Player</Th>
                <Th right>Wagered</Th>
                <Th right>Payout</Th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({length:12}).map((_,i)=><RowSkeleton key={i}/>)
                : rest.map((r,idx)=><Row key={r.rank ?? idx} r={r} payout={payoutFor(r.rank, prizeConfig)} />)}
            </tbody>
          </table>
        </section>

        <footer className="rb-footer">
          <span>Not affiliated with Rainbet · For entertainment only</span>
          <span>© {new Date().getFullYear()} Rainbet Leaderboard</span>
        </footer>
      </main>
    </div>
  )
}

function fmtCurrency(n) {
  const val = Number(n) || 0
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}
function payoutFor(rank, pc) {
  if (!pc || !pc.paidPlacements) return 0
  if (rank <= pc.paidPlacements) return Number(pc.amounts?.[rank-1] || 0)
  return 0
}

function Th({ children, right=false, w }) {
  return <th className={cx('rb-th', right && 'rb-th-right')} style={{ width: w }}>{children}</th>
}
function Row({ r, payout=0 }) {
  return (
    <tr className="rb-tr">
      <td className="rb-td rb-td-rank">{r.rank}</td>
      <td className="rb-td">
        <div className="rb-player">
          <div className="rb-avatar" aria-hidden>{String(r.username||'U').slice(0,1).toUpperCase()}</div>
          <div className="rb-player-meta">
            <div className="rb-player-name">{maskName(r.username)}</div>
          </div>
        </div>
      </td>
      <td className="rb-td rb-td-right rb-strong">{fmtNum(r.wagered)}</td>
      <td className="rb-td rb-td-right">{payout ? <span className="rb-paychip">{fmtCurrency(payout)}</span> : '—'}</td>
    </tr>
  )
}
function RowSkeleton() {
  return (
    <tr className="rb-tr rb-skel">
      <td className="rb-td"><div className="rb-skel-bar" style={{ width: 24 }} /></td>
      <td className="rb-td">
        <div className="rb-player">
          <div className="rb-avatar rb-skel-bg" />
          <div className="rb-player-meta skel-meta">
            <div className="rb-skel-bar" style={{ width: 120 }} />
          </div>
        </div>
      </td>
      <td className="rb-td rb-td-right"><div className="rb-skel-bar" style={{ width: 90, marginLeft: 'auto' }} /></td>
      <td className="rb-td rb-td-right"><div className="rb-skel-bar" style={{ width: 60, marginLeft: 'auto' }} /></td>
    </tr>
  )
}

/* Champ + runners */
function ChampCard({ item, payout=0 }) {
  if (!item) return <ChampSkeleton />
  return (
    <div className="rb-champ">
      <div className="rb-rank-burst">1</div>
      <div className="rb-champ-head">
        <div className="rb-avatar rb-avatar-lg">{String(item.username||'U').slice(0,1).toUpperCase()}</div>
        <div className="rb-champ-meta">
          <div className="rb-champ-name">{maskName(item.username)}</div>
          <div className="rb-champ-w">{fmtNum(item.wagered)}</div>
        </div>
        {payout ? <span className="rb-paychip">{fmtCurrency(payout)}</span> : null}
      </div>
    </div>
  )
}
function RunnerCard({ place, item, payout=0 }) {
  if (!item) return <RunnerSkeleton />
  return (
    <div className="rb-runner-card">
      <div className={cx('rb-rank-circle', place===2?'rb-rank-2':'rb-rank-3')}>{place}</div>
      <div className="rb-runner-head">
        <div className="rb-avatar">{String(item.username||'U').slice(0,1).toUpperCase()}</div>
        <div className="rb-player-meta">
          <div className="rb-player-name">{maskName(item.username)}</div>
          <div className="rb-sub">{fmtNum(item.wagered)} wagered</div>
        </div>
        {payout ? <span className="rb-paychip">{fmtCurrency(payout)}</span> : null}
      </div>
    </div>
  )
}
function ChampSkeleton(){
  return <div className="rb-champ rb-skel"><div className="rb-skel-bar" style={{ height: 80 }} /></div>
}
function RunnerSkeleton(){
  return <div className="rb-runner-card rb-skel"><div className="rb-skel-bar" style={{ height: 48 }} /></div>
}

/* Past page (no bets column now) */
function PastPage() {
  const [items, setItems] = useState([])
  const [selected, setSelected] = useState(null)
  useEffect(()=>{ (async()=>{ const j = await getJSON('/api/past'); setItems(Array.isArray(j?.data) ? j.data : []) })() },[])
  async function openItem(id){
    const j = await getJSON('/api/past/' + encodeURIComponent(id))
    setSelected(j || null)
  }
  return (
    <div className="rb-root">
      <Styles />
      <header className="rb-header">
        <div className="rb-brand">
          <span className="rb-logo" aria-hidden>
            <svg viewBox="0 0 64 64" width="28" height="28">
              <defs><linearGradient id="rb-g" x1="0" x2="1"><stop offset="0%" stopColor="#22d3ee"/><stop offset="100%" stopColor="#3b82f6"/></linearGradient></defs>
              <path d="M32 6C24 18 14 28 14 40a18 18 0 1 0 36 0c0-12-10-22-18-34Z" fill="url(#rb-g)" />
            </svg>
          </span>
          <div>
            <h1 className="rb-title">Past Leaderboards</h1>
            <p className="rb-sub">Snapshots saved (JSON + PNG)</p>
          </div>
        </div>
        <div className="rb-header-right"><a className="rb-link" href="#/">← Back</a></div>
      </header>

      <main className="rb-main">
        <div className="rb-table-wrap" style={{marginBottom:16}}>
          <table className="rb-table">
            <thead><tr><Th>Snapshot</Th><Th>Range</Th><Th>Period</Th><Th>PNG</Th><Th>View</Th></tr></thead>
            <tbody>
              {items.map(it=>(
                <tr className="rb-tr" key={it.id}>
                  <td className="rb-td">{new Date(it.takenAt).toLocaleString()}<div className="rb-sub">{it.bannerTitle}</div></td>
                  <td className="rb-td">{it.range?.start} → {it.range?.end}</td>
                  <td className="rb-td">{it.period}</td>
                  <td className="rb-td">{it.image ? <a className="rb-link" href={it.image} target="_blank" rel="noreferrer">Open PNG</a> : '—'}</td>
                  <td className="rb-td"><button className="rb-btn" onClick={()=>openItem(it.id)}>Open</button></td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr className="rb-tr"><td className="rb-td" colSpan="5">No snapshots yet</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {selected && (
          <div className="rb-table-wrap">
            <div style={{padding:12}}>
              <h3 style={{margin:'6px 0 2px'}}>{selected.bannerTitle}</h3>
              <div className="rb-sub">Taken: {new Date(selected.takenAt).toLocaleString()} · Range: {selected.range?.start} → {selected.range?.end} · Period: {selected.period}</div>
            </div>
            <table className="rb-table">
              <thead><tr><Th w="4rem">#</Th><Th>Player</Th><Th right>Wagered</Th><Th right>Payout</Th></tr></thead>
              <tbody>
                {(selected.data||[]).map((r,idx)=>(
                  <tr className="rb-tr" key={idx}>
                    <td className="rb-td rb-td-rank">{r.rank}</td>
                    <td className="rb-td"><div className="rb-player"><div className="rb-avatar" aria-hidden>{String(r.username||'U').slice(0,1).toUpperCase()}</div><div className="rb-player-meta"><div className="rb-player-name">{maskName(r.username)}</div></div></div></td>
                    <td className="rb-td rb-td-right rb-strong">{fmtNum(r.wagered)}</td>
                    <td className="rb-td rb-td-right">{payoutFor(r.rank, selected.prizeConfig || {paidPlacements:0,amounts:[]}) ? <span className="rb-paychip">{fmtCurrency(payoutFor(r.rank, selected.prizeConfig))}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}

/* Snapshot view for PNG (no bets) */
function SnapshotView({ id }) {
  const [snap, setSnap] = useState(null)
  useEffect(()=>{ (async()=>{ const j = await getJSON('/api/past/'+id); setSnap(j) })() },[id])
  if (!snap) return <div className="rb-root"><Styles /><div style={{padding:20,color:'#fff'}}>Loading…</div></div>
  return (
    <div className="rb-root" data-snapshot-ready="1">
      <Styles />
      <div className="rb-banner" style={{marginTop:12}}>
        <div className="rb-banner-inner">
          <div className="rb-banner-accent" />
          <h2 className="rb-banner-title">{snap.bannerTitle}</h2>
          <div className="rb-sub" style={{marginTop:6}}>Range: {snap.range?.start} → {snap.range?.end} · Period: {snap.period}</div>
          {snap?.prizeConfig?.paidPlacements > 0 && (
            <div className="rb-payout-summary">
              {Array.from({length: snap.prizeConfig.paidPlacements}).map((_,i)=>(
                <span key={i} className="rb-paychip">#{i+1} pays {fmtCurrency(snap.prizeConfig.amounts?.[i] || 0)}</span>
              ))}
            </div>
          )}
        </div>
      </div>
      <main className="rb-main">
        <div className="rb-table-wrap">
          <table className="rb-table">
            <thead><tr><Th w="4rem">#</Th><Th>Player</Th><Th right>Wagered</Th><Th right>Payout</Th></tr></thead>
            <tbody>
              {(snap.data||[]).map((r,idx)=>(
                <tr className="rb-tr" key={idx}>
                  <td className="rb-td rb-td-rank">{r.rank}</td>
                  <td className="rb-td"><div className="rb-player"><div className="rb-avatar" aria-hidden>{String(r.username||'U').slice(0,1).toUpperCase()}</div><div className="rb-player-meta"><div className="rb-player-name">{maskName(r.username)}</div></div></div></td>
                  <td className="rb-td rb-td-right rb-strong">{fmtNum(r.wagered)}</td>
                  <td className="rb-td rb-td-right">{payoutFor(r.rank, snap.prizeConfig || {paidPlacements:0,amounts:[]}) ? <span className="rb-paychip">{fmtCurrency(payoutFor(r.rank, snap.prizeConfig))}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}

/* admin */
export function AdminControls() {
  const [period, setPeriod] = useState('weekly')
  const [countVal, setCountVal] = useState(7)
  const [countUnit, setCountUnit] = useState('days')
  const [pageSize, setPageSize] = useState(15)
  const [msg, setMsg] = useState('')
  const [range, setRange] = useState({ startISO:'', endISO:'' })
  const [auth, setAuth] = useState(localStorage.getItem('rb_admin_token') || '')
  const [loginError, setLoginError] = useState('')
  const [bannerTitle, setBannerTitle] = useState('$500 Monthly Leaderboard')
  const [socials, setSocials] = useState([{name:'Twitter', url:'https://twitter.com/'},{name:'Discord', url:'https://discord.gg/'}])
  const [useCustom, setUseCustom] = useState(false)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [paidPlacements, setPaidPlacements] = useState(3)
  const [amounts, setAmounts] = useState([300,150,50])

  useEffect(() => {
    (async () => {
      const s = await getJSON('/api/settings')
      if (s) {
        setPeriod(s.period || 'weekly')
        setCountVal(Number(s?.countdown?.value) || 7)
        setCountUnit(s?.countdown?.unit || 'days')
        setPageSize(Math.min(100, Math.max(1, Number(s?.pageSize || 15))))
        setBannerTitle(s.bannerTitle || '$500 Monthly Leaderboard')
        setSocials(Array.isArray(s.socials) && s.socials.length ? s.socials : socials)
        setUseCustom(!!s?.customRange?.enabled)
        setCustomStart(s?.customRange?.start || '')
        setCustomEnd(s?.customRange?.end || '')
        const pc = s.prizeConfig || { paidPlacements: 0, amounts: [] }
        setPaidPlacements(Number(pc.paidPlacements || 0))
        setAmounts(Array.isArray(pc.amounts) ? pc.amounts : [])
      }
      await refreshRange(s?.period || 'weekly')
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refreshRange(p) {
    const r = await getJSON('/api/range?period=' + encodeURIComponent(p || period))
    if (r) setRange({ startISO: r.startISO, endISO: r.endISO })
  }

  async function save() {
    setMsg('')
    const payload = {
      period,
      countdown: { value: Math.max(0, Number(countVal)||0), unit: countUnit },
      pageSize: Math.min(100, Math.max(1, Number(pageSize)||15)),
      bannerTitle,
      socials: socials.filter(s=>s.name && s.url),
      customRange: { enabled: useCustom, start: customStart, end: customEnd },
      prizeConfig: { paidPlacements: Math.max(0, Number(paidPlacements)||0), amounts: amounts.slice(0, Math.max(0, Number(paidPlacements)||0)).map(n=>Number(n)||0) }
    }
    const r = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth?{Authorization: auth}:{}) },
      body: JSON.stringify(payload)
    }).catch(()=>null)
    if (!r) return setMsg('Network error')
    setMsg(r.ok ? 'Saved ✔' : (r.status===401 ? 'Unauthorized' : 'Failed to save'))
  }

  async function handleLogin(e) {
    e.preventDefault()
    setLoginError('')
    const user = e.target.user.value.trim()
    const pass = e.target.pass.value.trim()
    const token = 'Basic ' + btoa(user + ':' + pass)
    const ok = await fetch('/api/auth', { headers: { Authorization: token } }).then(r=>r.ok).catch(()=>false)
    if (!ok) { setLoginError('Invalid username or password'); return }
    localStorage.setItem('rb_admin_token', token)
    setAuth(token)
  }
  function logout() { localStorage.removeItem('rb_admin_token'); setAuth('') }

  function updateSocial(i, key, val) {
    setSocials(prev => prev.map((s,idx)=> idx===i ? { ...s, [key]: val } : s))
  }
  function addSocial() { setSocials(prev => [...prev, { name:'', url:'' }].slice(0,5)) }
  function removeSocial(i) { setSocials(prev => prev.filter((_,idx)=>idx!==i)) }

  function setPaid(n) {
    const nn = Math.max(0, Math.min(100, Number(n)||0))
    setPaidPlacements(nn)
    setAmounts(prev => {
      const out = prev.slice(0, nn)
      while (out.length < nn) out.push(0)
      return out
    })
  }
  function setAmountAt(i, v) {
    setAmounts(prev => prev.map((n,idx)=> idx===i ? Number(v)||0 : n))
  }

  return (
    <div className="rb-admin">
      <Styles />
      <div className="rb-admin-top">
        <h2>Admin Controls</h2>
        <a className="rb-link" href="#/">← Back</a>
      </div>

      {!auth ? (
        <form onSubmit={handleLogin} className="rb-admin-grid" style={{maxWidth:460}}>
          <div className="rb-label"><span>Username</span><input name="user" className="rb-input" /></div>
          <div className="rb-label"><span>Password</span><input name="pass" type="password" className="rb-input" /></div>
          <div className="rb-actions">
            <button className="rb-btn" type="submit">Login</button>
            {loginError && <span className="rb-msg" style={{color:'#fca5a5'}}>{loginError}</span>}
          </div>
          <small className="rb-hint">Credentials are set in your .env as ADMIN_USER / ADMIN_PASS.</small>
        </form>
      ) : (
        <div className="rb-admin-grid">
          <label className="rb-label">
            <span>Leaderboard Period</span>
            <select value={period} onChange={(e)=>{setPeriod(e.target.value); refreshRange(e.target.value)}} className="rb-input">
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>

          <div className="rb-label">
            <span>Current Range</span>
            <div className="rb-input" style={{display:'flex',gap:8,alignItems:'center',justifyContent:'space-between'}}>
              <span style={{opacity:.85, fontSize:14, overflow:'hidden',textOverflow:'ellipsis'}}>{range.startISO || '—'} → {range.endISO || '—'}</span>
              <button onClick={()=>refreshRange()} className="rb-btn" type="button">Refresh Range</button>
            </div>
          </div>

          <div className="rb-label">
            <span>Custom Range (YYYY-MM-DD)</span>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
              <input className="rb-input" placeholder="Start" value={customStart} onChange={e=>setCustomStart(e.target.value)} />
              <input className="rb-input" placeholder="End" value={customEnd} onChange={e=>setCustomEnd(e.target.value)} />
              <label style={{display:'flex',gap:8,alignItems:'center'}}><input type="checkbox" checked={useCustom} onChange={e=>setUseCustom(e.target.checked)} />Use custom</label>
            </div>
          </div>

          <div className="rb-label">
            <span>Banner Title</span>
            <input className="rb-input" value={bannerTitle} onChange={(e)=>setBannerTitle(e.target.value)} placeholder="$500 Monthly Leaderboard" />
          </div>

          <div className="rb-label">
            <span>Social Links (max 5)</span>
            <div style={{display:'grid', gap:8}}>
              {socials.map((s,i)=>(
                <div key={i} style={{display:'grid', gridTemplateColumns:'1fr 2fr auto', gap:8}}>
                  <input className="rb-input" placeholder="Name" value={s.name} onChange={(e)=>updateSocial(i,'name',e.target.value)} />
                  <input className="rb-input" placeholder="URL (https://...)" value={s.url} onChange={(e)=>updateSocial(i,'url',e.target.value)} />
                  <button type="button" className="rb-btn" onClick={()=>removeSocial(i)}>Remove</button>
                </div>
              ))}
              {socials.length < 5 && <button type="button" className="rb-btn" onClick={addSocial}>+ Add Link</button>}
            </div>
          </div>

          {/* NEW: Prize config */}
          <div className="rb-label">
            <span>Paid Placements</span>
            <input className="rb-input" type="number" min="0" max="100" value={paidPlacements} onChange={(e)=>setPaid(e.target.value)} />
            <small className="rb-hint">How many top spots receive payouts.</small>
          </div>

          <div className="rb-label">
            <span>Payout Amounts (USD)</span>
            <div style={{display:'grid', gap:8}}>
              {Array.from({length: paidPlacements}).map((_,i)=>(
                <div key={i} style={{display:'grid', gridTemplateColumns:'auto 1fr', gap:8, alignItems:'center'}}>
                  <div className="rb-pill">#{i+1}</div>
                  <input className="rb-input" type="number" min="0" value={amounts[i] || 0} onChange={(e)=>setAmountAt(i, e.target.value)} />
                </div>
              ))}
            </div>
          </div>

          <div style={{ display:'grid', gap: 8 }}>
            <span>Countdown</span>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 8 }}>
              <input type="number" min="0" value={countVal} onChange={(e)=>setCountVal(e.target.value)} className="rb-input" placeholder="Value" />
              <select value={countUnit} onChange={(e)=>setCountUnit(e.target.value)} className="rb-input">
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
                <option value="weeks">Weeks</option>
              </select>
            </div>
          </div>

          <label className="rb-label">
            <span>Show Top N</span>
            <input type="number" min="1" max="100" value={pageSize} onChange={(e)=>setPageSize(e.target.value)} className="rb-input" />
          </label>

          <div className="rb-actions">
            <button onClick={save} className="rb-btn" type="button">Save</button>
            <button onClick={()=>fetch('/api/snapshot',{method:'POST', headers: auth?{Authorization: auth}:{}}).then(async r=>{const j=await r.json(); alert(j.ok?('PNG saved: '+j.image):'Failed')})} className="rb-btn" type="button">Save Snapshot (PNG)</button>
            <a className="rb-link" href="#/past">View Past</a>
            <button onClick={logout} className="rb-btn" type="button" style={{background:'#e2e8f0',color:'#0b0c10'}}>Logout</button>
            <span className="rb-msg">{msg}</span>
          </div>
        </div>
      )}
    </div>
  )
}

/* styles (adds podium v2 + rank badges) */
function Styles() {
  return (
    <style>{`
:root{
  --bg:#0b0c10; --panel:#10121a; --panel2:#0d1017;
  --ink:#e5e7eb; --muted:#a1a1aa;
  --line:rgba(255,255,255,.08); --line2:rgba(255,255,255,.06);
  --brand1:#22d3ee; --brand2:#3b82f6; --accent:linear-gradient(90deg,var(--brand1),var(--brand2));
}
*{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial}
.rb-root{min-height:100vh;background:radial-gradient(900px 480px at 15% -10%, rgba(34,211,238,.12), transparent),radial-gradient(900px 520px at 90% 0%, rgba(59,130,246,.10), transparent),var(--bg)}
.rb-header{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 18px;border-bottom:1px solid var(--line);backdrop-filter:saturate(1.1) blur(10px);background:rgba(6,8,12,.75)}
.rb-brand{display:flex;align-items:center;gap:12px}
.rb-logo{display:grid;place-items:center;width:36px;height:36px;border-radius:8px;background:rgba(255,255,255,.04);box-shadow:0 6px 24px rgba(0,0,0,.3)}
.rb-title{margin:0;font-size:20px;font-weight:800}
.rb-sub{margin:0;font-size:12px;color:var(--muted)}
.rb-header-right{display:flex;align-items:center;gap:8px}
.rb-pill{border:1px solid var(--line);background:rgba(255,255,255,.04);color:#d4d4d8;padding:6px 10px;border-radius:999px}
.rb-k{color:#cbd5e1}
.rb-link{color:#9ac2ff;text-decoration:none}
/* Banner */
.rb-banner{margin:18px auto 0;max-width:1100px;padding:0 18px}
.rb-banner-inner{position:relative;border:1px solid var(--line);background:linear-gradient(180deg,var(--panel),var(--panel2));border-radius:16px;overflow:hidden;padding:20px}
.rb-banner-accent{position:absolute;inset:0;opacity:.2;background:radial-gradient(600px 300px at 20% -10%, rgba(34,211,238,.25), transparent),radial-gradient(600px 320px at 80% 0%, rgba(59,130,246,.25), transparent);pointer-events:none}
.rb-banner-title{margin:0;font-size:32px;font-weight:900;letter-spacing:.2px}
.rb-payout-summary{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.rb-paychip{display:inline-block;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid var(--line);font-weight:700}
/* Main */
.rb-main{max-width:1100px;margin:0 auto;padding:18px}
/* Podium v2 */
.rb-podium-v2{display:grid;gap:12px;margin:12px 0 16px}
.rb-champ-wrap{display:grid}
.rb-champ{border:1px solid var(--line);background:linear-gradient(180deg,var(--panel),var(--panel2));border-radius:18px;padding:18px;position:relative;overflow:hidden}
.rb-rank-burst{position:absolute;top:-16px;right:-16px;width:120px;height:120px;border-radius:999px;background:var(--accent);color:#0b0c10;display:grid;place-items:center;font-size:48px;font-weight:900;box-shadow:0 10px 30px rgba(0,0,0,.35)}
.rb-avatar-lg{width:72px;height:72px;border-radius:18px;display:grid;place-items:center;color:#fff;font-weight:900;background:var(--accent);box-shadow:inset 0 0 18px rgba(255,255,255,.16)}
.rb-champ-head{display:flex;align-items:center;gap:14px}
.rb-champ-meta{display:flex;flex-direction:column}
.rb-champ-name{font-size:20px;font-weight:800}
.rb-champ-w{font-size:28px;font-weight:900;margin-top:4px}
.rb-runner-wrap{display:grid;grid-template-columns:1fr;gap:12px}
@media(min-width:760px){.rb-runner-wrap{grid-template-columns:1fr 1fr}}
.rb-runner-card{border:1px solid var(--line);background:linear-gradient(180deg,var(--panel),var(--panel2));border-radius:16px;padding:14px;position:relative;overflow:hidden}
.rb-rank-circle{position:absolute;top:8px;right:8px;width:44px;height:44px;border-radius:999px;display:grid;place-items:center;font-weight:900;font-size:20px;background:#222;color:#fff;border:1px solid var(--line)}
.rb-rank-2{background:linear-gradient(90deg,#cbd5e1,#64748b)}
.rb-rank-3{background:linear-gradient(90deg,#334155,#0b1020)}
/* Table */
.rb-table-wrap{border:1px solid var(--line);border-radius:16px;overflow:hidden;background:rgba(255,255,255,.03)}
.rb-table{width:100%;border-collapse:separate;border-spacing:0}
.rb-th{font-weight:700;font-size:14px;text-align:left;color:#d4d4d8;padding:12px;background:rgba(255,255,255,.05)}
.rb-th-right{text-align:right}
.rb-tr{border-top:1px solid var(--line2)}
.rb-td{padding:12px;vertical-align:middle}
.rb-td-right{text-align:right}
.rb-td-rank{color:#a1a1aa;font-weight:900}
.rb-strong{font-weight:900}
.rb-player{display:flex;align-items:center;gap:10px}
.rb-player-name{font-weight:800}
.rb-avatar{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;color:#fff;font-weight:900;background:var(--accent);box-shadow:inset 0 0 18px rgba(255,255,255,.16)}
/* Footer */
.rb-footer{display:flex;justify-content:space-between;align-items:center;color:#a1a1aa;font-size:12px;margin-top:16px}
/* Skeleton */
.rb-skel .rb-skel-bar{height:12px;border-radius:8px;background:linear-gradient(90deg,rgba(255,255,255,.08),rgba(255,255,255,.16),rgba(255,255,255,.08));background-size:200% 100%;animation:rb-shimmer 1.2s linear infinite}
.rb-skel-bg{background:rgba(255,255,255,.08)}
.skel-meta{display:flex;flex-direction:column;gap:6px}
@keyframes rb-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
/* Admin */
.rb-admin{min-height:100vh;background:radial-gradient(800px 460px at 15% -10%, rgba(34,211,238,.12), transparent),radial-gradient(800px 500px at 85% 0%, rgba(59,130,246,.10), transparent),var(--bg);color:var(--ink);padding:18px}
.rb-admin-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.rb-admin-grid{display:grid;gap:12px;max-width:800px;margin:0 auto;border:1px solid var(--line);background:linear-gradient(180deg,var(--panel),var(--panel2));border-radius:16px;padding:16px}
.rb-label{display:grid;gap:6px}
.rb-input{padding:10px;border-radius:10px;border:1px solid var(--line);background:#0d1117;color:#e5e7eb}
.rb-hint{color:#9aa3ad}
.rb-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.rb-btn{padding:10px 14px;border-radius:10px;border:0;background:#fff;color:#0b0c10;font-weight:800;cursor:pointer}
.rb-msg{color:#cbd5e1}
`}</style>
  )
}


/* end file */
