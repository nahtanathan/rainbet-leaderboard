import React, { useEffect, useMemo, useRef, useState } from 'react'

/* ===== Config for floating background logo ===== */
const IMG_SRC = '/rainbet-logo.png' // put file in /public as rainbet-logo.png
const BOUNCER_COUNT = 10            // number of floating logos
const MIN_SIZE = 48                 // px
const MAX_SIZE = 120                // px
const MIN_SPEED = 30                // px/sec
const MAX_SPEED = 90                // px/sec
const GLOBAL_ALPHA = 0.08           // transparency (0..1)

/* ===== Utilities ===== */
const PERIODS = { weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly' }
const fmtNum = (n) => new Intl.NumberFormat().format(Number(n) || 0)
const fmtCurrency = (n) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
    .format(Number(n) || 0)
const fmtClock = (secs) => {
  const s = Math.max(0, Number(secs) || 0)
  const d = Math.floor(s / 86400),
    h = Math.floor((s % 86400) / 3600),
    m = Math.floor((s % 3600) / 60),
    ss = s % 60
  const hhmmss = [h, m, ss].map((x) => String(x).padStart(2, '0')).join(':')
  return d > 0 ? `${d}d ${hhmmss}` : hhmmss
}
const getJSON = async (u, o) => {
  const r = await fetch(u, o).catch(() => null)
  if (!r || !r.ok) return null
  return r.json().catch(() => null)
}
const payoutFor = (rank, pc) =>
  pc?.paidPlacements && rank <= pc.paidPlacements ? Number(pc.amounts?.[rank - 1] || 0) : 0
const cx = (...v) => v.filter(Boolean).join(' ')
const useRoute = () => {
  const [r, setR] = useState(window.location.hash || '#/')
  useEffect(() => {
    const h = () => setR(window.location.hash || '#/')
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  return r.replace(/^#/, '')
}

/* ===== Background: floating & bouncing Rainbet logos ===== */
function BackgroundBouncers() {
  const ref = useRef(null)
  const idleRef = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas.getContext('2d')
    let w = 0, h = 0, raf, last = performance.now(), dpr = 1
    const img = new Image()
    img.src = IMG_SRC

    const balls = [] // {x,y,vx,vy,size,rot,vr}
    function resetSize() {
      dpr = Math.max(1, window.devicePixelRatio || 1)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    function rand(a, b) { return a + Math.random() * (b - a) }
    function initBalls() {
      balls.length = 0
      for (let i = 0; i < BOUNCER_COUNT; i++) {
        const size = rand(MIN_SIZE, MAX_SIZE)
        const angle = rand(0, Math.PI * 2)
        const speed = rand(MIN_SPEED, MAX_SPEED)
        const vx = Math.cos(angle) * speed
        const vy = Math.sin(angle) * speed
        balls.push({
          x: rand(size, w - size),
          y: rand(size, h - size),
          vx, vy,
          size,
          rot: rand(0, Math.PI * 2),
          vr: rand(-0.3, 0.3)
        })
      }
    }

    function step(now) {
      const dt = Math.min(0.05, (now - last) / 1000) // seconds (cap)
      last = now
      ctx.clearRect(0, 0, w, h)
      ctx.globalAlpha = GLOBAL_ALPHA
      for (const b of balls) {
        b.x += b.vx * dt
        b.y += b.vy * dt
        b.rot += b.vr * dt
        if (b.x < 0) { b.x = 0; b.vx *= -1 }
        if (b.y < 0) { b.y = 0; b.vy *= -1 }
        if (b.x + b.size > w) { b.x = w - b.size; b.vx *= -1 }
        if (b.y + b.size > h) { b.y = h - b.size; b.vy *= -1 }
        ctx.save()
        ctx.translate(b.x + b.size / 2, b.y + b.size / 2)
        ctx.rotate(b.rot)
        ctx.drawImage(img, -b.size / 2, -b.size / 2, b.size, b.size)
        ctx.restore()
      }
      raf = requestAnimationFrame(step)
    }

    function start() {
      resetSize()
      initBalls()
      last = performance.now()
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(step)
    }

    const ro = new ResizeObserver(() => {
      clearTimeout(idleRef.current)
      idleRef.current = setTimeout(() => {
        resetSize()
        for (const b of balls) {
          b.x = Math.min(Math.max(0, b.x), Math.max(0, w - b.size))
          b.y = Math.min(Math.max(0, b.y), Math.max(0, h - b.size))
        }
      }, 50)
    })
    ro.observe(canvas)

    img.onload = start
    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(raf)
      else { last = performance.now(); raf = requestAnimationFrame(step) }
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      document.removeEventListener('visibilitychange', onVis)
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [])

  return <canvas ref={ref} className="rb-bg-canvas" />
}

/* ===== Router ===== */
export default function App() {
  const route = useRoute()
  if (route.startsWith('/admin')) return (<><BackgroundBouncers/><Admin/></>)
  if (route.startsWith('/past')) return (<><BackgroundBouncers/><Past/></>)
  if (route.startsWith('/snapshot/')) return (<><BackgroundBouncers/><Snapshot id={route.split('/')[2]} /></>)
  return (<><BackgroundBouncers/><Board/></>)
}

/* ================= Leaderboard (Main) ================= */
function Board() {
  const [period, setPeriod] = useState('weekly')
  const [countdownEndISO, setCountdownEndISO] = useState('')
  const [rows, setRows] = useState([])
  const [pageSize, setPageSize] = useState(15)
  const [bannerTitle, setBannerTitle] = useState('$500 Monthly Leaderboard')
  const [socials, setSocials] = useState([])
  const [rangeInfo, setRangeInfo] = useState(null)
  const [prizeConfig, setPrizeConfig] = useState({ paidPlacements: 0, amounts: [] })
  const [loading, setLoading] = useState(true)
  const tick = useRef(0)
  const [, force] = useState(0)
  const snapshotOnce = useRef(false)

  useEffect(() => {
    ;(async () => {
      const s = await getJSON('/api/settings')
      if (s) {
        setPeriod(s.period || 'weekly')
        setCountdownEndISO(s.countdownEndISO || '')
        setPageSize(Number(s.pageSize || 15))
        setBannerTitle(s.bannerTitle || '$500 Monthly Leaderboard')
        setSocials(Array.isArray(s.socials) ? s.socials : [])
        setPrizeConfig(s.prizeConfig || { paidPlacements: 0, amounts: [] })
        await refreshRange(s.period || 'weekly')
        await loadBoard(s.period || 'weekly', Number(s.pageSize || 15))
      } else {
        await refreshRange('weekly')
        await loadBoard('weekly', 15)
      }
    })()
  }, [])

  useEffect(() => {
    const t = setInterval(() => {
      tick.current++
      force((x) => x + 1)
    }, 1000)
    return () => clearInterval(t)
  }, [])

  const remaining = useMemo(() => {
    if (!countdownEndISO) return 0
    const ms = new Date(countdownEndISO).getTime() - Date.now()
    return Math.max(0, Math.floor(ms / 1000))
  }, [countdownEndISO, tick.current])

  useEffect(() => {
    if (remaining === 0 && countdownEndISO && !snapshotOnce.current) {
      snapshotOnce.current = true
      fetch('/api/snapshot', { method: 'POST' }).catch(() => {})
    }
  }, [remaining, countdownEndISO])

  async function refreshRange(p) {
    const r = await getJSON('/api/range?period=' + encodeURIComponent(p || period))
    if (r) setRangeInfo(r)
  }
  useEffect(() => {
    const t = setInterval(() => loadBoard(period, pageSize), 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [period, pageSize])

  async function loadBoard(p, n) {
    setLoading(true)
    const q = new URLSearchParams({ range: p || 'weekly', limit: String(n || 15) })
    const j = await getJSON('/api/leaderboard?' + q.toString())
    const list = Array.isArray(j?.data) ? j.data : []
    const sorted = list
      .sort((a, b) => (b.wagered || 0) - (a.wagered || 0))
      .slice(0, n || 15)
      .map((x, i) => ({ ...x, rank: i + 1 }))
    setRows(sorted)
    setLoading(false)
  }

  const first = rows[0],
    second = rows[1],
    third = rows[2],
    rest = rows.slice(3)

  return (
    <div className="rb-root">
      <Styles />

      {/* Header with centered title + timer */}
      <header className="rb-header rb-header-centered">
        <div className="rb-left-spacer" />
        <div className="rb-center">
          <h1 className="rb-title rb-title-xl">{bannerTitle}</h1>
          <div className="rb-timer-big">Ends in {fmtClock(remaining)}</div>
        </div>
        <div className="rb-header-right">
          <a className="rb-link" href="#/past">Past</a>
          <a className="rb-link" href="#/admin">Admin</a>
        </div>
      </header>

      {/* Small meta + socials */}
      <section className="rb-hero rb-hero-center">
        <div className="rb-hero-meta">
          <div className="rb-chip"><span className="rb-k">Period</span> {PERIODS[period] || 'Weekly'}</div>
          {rangeInfo && (
            <div className="rb-chip">Range {rangeInfo.startISO?.slice(0,10)} → {rangeInfo.endISO?.slice(0,10)}</div>
          )}
        </div>
        {socials?.length > 0 && (
          <div className="rb-hero-socials">
            {socials.map((s, i) => (
              <a key={i} href={s.url} target="_blank" rel="noreferrer" className="rb-social-link">
                {s.name}
              </a>
            ))}
          </div>
        )}
      </section>

      {/* Top 3 Cards */}
      <section className="rb-podium-col">
        {loading ? (
          <>
            <CardSkeleton place={1} />
            <div className="rb-podium-row-23">
              <CardSkeleton place={2} />
              <CardSkeleton place={3} />
            </div>
          </>
        ) : (
          <>
            {first && <CardPodium place={1} item={first} prize={payoutFor(1, prizeConfig)} />}
            <div className="rb-podium-row-23">
              {second && <CardPodium place={2} item={second} prize={payoutFor(2, prizeConfig)} />}
              {third && <CardPodium place={3} item={third} prize={payoutFor(3, prizeConfig)} />}
            </div>
          </>
        )}
      </section>

      {/* Rest of the table */}
      <main className="rb-main">
        <section className="rb-table-wrap">
          <table className="rb-table">
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
                ? Array.from({ length: 12 }).map((_, i) => <RowSkeleton key={i} />)
                : rest.map((r) => <Row key={r.rank} r={r} payout={payoutFor(r.rank, prizeConfig)} />)}
              {!loading && rest.length === 0 && (
                <tr className="rb-tr"><td className="rb-td" colSpan="4">No entries</td></tr>
              )}
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

/* ===== Card Podium Components ===== */
function CardPodium({ place, item, prize }) {
  const tone = place === 1 ? 'rb-card-1' : place === 2 ? 'rb-card-2' : 'rb-card-3'
  return (
    <div className={cx('rb-card-wrap', place === 1 && 'rb-card-wrap-1')}>
      <div className={cx('rb-card', tone)}>
        <div className="rb-card-content">
          <div className="rb-card-name">{item.username}</div>
          <div className="rb-card-wager">{fmtNum(item.wagered)}</div>
          {prize ? <div className="rb-card-prize">{fmtCurrency(prize)}</div> : null}
        </div>
        <div className={cx('rb-flag', `rb-flag-${place}`)}>
          <span className="rb-flag-num">#{place}</span>
        </div>
      </div>
    </div>
  )
}

const CardSkeleton = ({ place }) => {
  const tone = place === 1 ? 'rb-card-1' : place === 2 ? 'rb-card-2' : 'rb-card-3'
  return (
    <div className={cx('rb-card-wrap', place === 1 && 'rb-card-wrap-1', 'rb-skel')}>
      <div className={cx('rb-card', tone)}>
        <div className="rb-card-content">
          <div className="rb-skel-bar" style={{ width: 150, height: 16, margin: '6px auto 10px' }} />
          <div className="rb-skel-bar" style={{ width: 110, height: 14, margin: '0 auto 8px' }} />
          <div className="rb-skel-bar" style={{ width: 90, height: 14, margin: '0 auto' }} />
        </div>
        <div className={cx('rb-flag', `rb-flag-${place}`)}><span className="rb-flag-num">#{place}</span></div>
      </div>
    </div>
  )
}

/* ===== Table Components ===== */
function Th({ children, right = false, w }) {
  return (
    <th className={cx('rb-th', right && 'rb-th-right')} style={{ width: w }}>{children}</th>
  )
}
function Row({ r, payout = 0 }) {
  if (r.rank <= 3) return null
  return (
    <tr className="rb-tr">
      <td className="rb-td rb-td-rank">{r.rank}</td>
      <td className="rb-td">
        <div className="rb-player rb-player-simple">
          <div className="rb-player-name">{r.username}</div>
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
      <td className="rb-td"><div className="rb-skel-bar" style={{ width: 140 }} /></td>
      <td className="rb-td rb-td-right"><div className="rb-skel-bar" style={{ width: 90, marginLeft: 'auto' }} /></td>
      <td className="rb-td rb-td-right"><div className="rb-skel-bar" style={{ width: 60, marginLeft: 'auto' }} /></td>
    </tr>
  )
}

/* ================= Past ================= */
function Past() {
  const [items, setItems] = useState([])
  useEffect(() => {
    ;(async () => {
      const j = await getJSON('/api/past')
      setItems(Array.isArray(j?.data) ? j.data : [])
    })()
  }, [])
  return (
    <div className="rb-root">
      <Styles />
      <header className="rb-header rb-header-centered">
        <div className="rb-left-spacer" />
        <div className="rb-center">
          <h1 className="rb-title rb-title-xl">Past Leaderboards</h1>
          <p className="rb-sub" style={{ textAlign: 'center' }}>Snapshots saved (JSON + link)</p>
        </div>
        <div className="rb-header-right"><a className="rb-link" href="#/">← Back</a></div>
      </header>
      <main className="rb-main">
        <div className="rb-table-wrap" style={{ marginBottom: 16 }}>
          <table className="rb-table">
            <thead>
              <tr><Th>Snapshot</Th><Th>Range</Th><Th>Period</Th><Th>PNG</Th><Th>View</Th></tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr className="rb-tr" key={it.id}>
                  <td className="rb-td">
                    {new Date(it.takenAt).toLocaleString()}
                    <div className="rb-sub">{it.bannerTitle}</div>
                  </td>
                  <td className="rb-td">{it.range?.start} → {it.range?.end}</td>
                  <td className="rb-td">{it.period}</td>
                  <td className="rb-td">
                    {it.image ? <a className="rb-link" href={it.image} target="_blank" rel="noreferrer">Open PNG</a> : '—'}
                  </td>
                  <td className="rb-td"><a className="rb-btn" href={`#/snapshot/${it.id}`}>Open</a></td>
                </tr>
              ))}
              {items.length === 0 && <tr className="rb-tr"><td className="rb-td" colSpan="5">No snapshots yet</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}

/* ================= Snapshot ================= */
function Snapshot({ id }) {
  const [snap, setSnap] = useState(null)
  useEffect(() => { (async () => setSnap(await getJSON('/api/past/' + id)))() }, [id])
  if (!snap) return (<div className="rb-root"><Styles/><div style={{ padding:20,color:'#fff' }}>Loading…</div></div>)
  return (
    <div className="rb-root">
      <Styles />
      <header className="rb-header rb-header-centered">
        <div className="rb-left-spacer" />
        <div className="rb-center">
          <h1 className="rb-title rb-title-xl">{snap.bannerTitle}</h1>
          <p className="rb-sub" style={{ textAlign: 'center' }}>Range {snap.range?.start} → {snap.range?.end} · Period {snap.period}</p>
        </div>
        <div className="rb-header-right"><a className="rb-link" href="#/past">← Back</a></div>
      </header>
      <main className="rb-main">
        <div className="rb-table-wrap">
          <table className="rb-table">
            <thead>
              <tr><Th w="4rem">#</Th><Th>Player</Th><Th right>Wagered</Th><Th right>Payout</Th></tr>
            </thead>
            <tbody>
              {(snap.data || []).map((r, i) => (
                <tr className="rb-tr" key={i}>
                  <td className="rb-td rb-td-rank">{r.rank}</td>
                  <td className="rb-td"><div className="rb-player rb-player-simple"><div className="rb-player-name">{r.username}</div></div></td>
                  <td className="rb-td rb-td-right rb-strong">{fmtNum(r.wagered)}</td>
                  <td className="rb-td rb-td-right">
                    {payoutFor(r.rank, snap.prizeConfig || { paidPlacements: 0, amounts: [] })
                      ? <span className="rb-paychip">{fmtCurrency(payoutFor(r.rank, snap.prizeConfig))}</span>
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}

/* ================= Admin ================= */
function Admin() {
  const [period, setPeriod] = useState('weekly')
  const [countVal, setCountVal] = useState(7)
  const [countUnit, setCountUnit] = useState('days')
  const [endsAtISO, setEndsAtISO] = useState('')
  const [pageSize, setPageSize] = useState(15)
  const [bannerTitle, setBannerTitle] = useState('$500 Monthly Leaderboard')
  const [socials, setSocials] = useState([
    { name: 'Twitter', url: 'https://twitter.com/' },
    { name: 'Discord', url: 'https://discord.gg/' },
  ])
  const [useCustom, setUseCustom] = useState(false)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [paidPlacements, setPaidPlacements] = useState(3)
  const [amounts, setAmounts] = useState([300, 150, 50])
  const [range, setRange] = useState({ startISO: '', endISO: '' })
  const [msg, setMsg] = useState('')
  const [auth, setAuth] = useState(localStorage.getItem('rb_admin_token') || '')
  const [loginError, setLoginError] = useState('')

  useEffect(() => {
    ;(async () => {
      const s = await getJSON('/api/settings')
      if (!s) return
      setPeriod(s.period || 'weekly')
      setCountVal(Number(s?.countdown?.value || 7))
      setCountUnit(s?.countdown?.unit || 'days')
      setEndsAtISO(s.countdownEndISO || '')
      setPageSize(Number(s.pageSize || 15))
      setBannerTitle(s.bannerTitle || '$500 Monthly Leaderboard')
      setSocials(Array.isArray(s.socials) && s.socials.length ? s.socials : socials)
      setUseCustom(!!s?.customRange?.enabled)
      setCustomStart(s?.customRange?.start || '')
      setCustomEnd(s?.customRange?.end || '')
      setPaidPlacements(Number(s?.prizeConfig?.paidPlacements || 3))
      setAmounts(Array.isArray(s?.prizeConfig?.amounts) ? s.prizeConfig.amounts : [300, 150, 50])
      const r = await getJSON('/api/range?period=' + (s.period || 'weekly'))
      if (r) setRange(r)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save() {
    setMsg('')
    const payload = {
      period,
      countdown: { value: Math.max(0, Number(countVal) || 0), unit: countUnit },
      countdownEndISO: endsAtISO,
      pageSize: Math.max(1, Math.min(100, Number(pageSize) || 15)),
      bannerTitle,
      socials: socials.filter((s) => s.name && s.url),
      customRange: { enabled: useCustom, start: customStart, end: customEnd },
      prizeConfig: {
        paidPlacements: Math.max(0, Number(paidPlacements) || 0),
        amounts: amounts.slice(0, Math.max(0, Number(paidPlacements) || 0)).map((n) => Number(n) || 0),
      },
    }
    const r = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
      body: JSON.stringify(payload),
    }).catch(() => null)
    if (!r) return setMsg('Network error')
    const j = await r.json().catch(() => null)
    setMsg(r.ok ? 'Saved ✔' : 'Failed: ' + (j?.error || r.status))
  }

  async function refreshRange() {
    const r = await getJSON('/api/range?period=' + period)
    if (r) setRange(r)
  }

  function handlePaid(n) {
    const nn = Math.max(0, Math.min(100, Number(n) || 0))
    setPaidPlacements(nn)
    setAmounts((prev) => {
      const out = prev.slice(0, nn)
      while (out.length < nn) out.push(0)
      return out
    })
  }
  function setAmountAt(i, v) {
    setAmounts((prev) => prev.map((n, idx) => (idx === i ? Number(v) || 0 : n)))
  }

  async function doLogin(e) {
    e.preventDefault()
    setLoginError('')
    const u = e.target.user.value.trim(),
      p = e.target.pass.value.trim()
    const token = 'Basic ' + btoa(u + ':' + p)
    const ok = await fetch('/api/auth', { headers: { Authorization: token } })
      .then((r) => r.ok)
      .catch(() => false)
    if (!ok) return setLoginError('Invalid username or password')
    localStorage.setItem('rb_admin_token', token)
    setAuth(token)
  }
  function logout() {
    localStorage.removeItem('rb_admin_token')
    setAuth('')
  }

  return (
    <div className="rb-admin">
      <Styles />
      <div className="rb-admin-top">
        <h2>Admin Controls</h2>
        <a className="rb-link" href="#/">← Back</a>
      </div>
      {!auth ? (
        <form onSubmit={doLogin} className="rb-admin-grid" style={{ maxWidth: 460 }}>
          <label className="rb-label"><span>Username</span><input name="user" className="rb-input" /></label>
          <label className="rb-label"><span>Password</span><input name="pass" type="password" className="rb-input" /></label>
          <div className="rb-actions">
            <button className="rb-btn" type="submit">Login</button>
            {loginError && <span className="rb-msg" style={{ color: '#fca5a5' }}>{loginError}</span>}
          </div>
          <small className="rb-hint">Set in ENV: ADMIN_USER / ADMIN_PASS</small>
        </form>
      ) : (
        <div className="rb-admin-grid">
          <label className="rb-label"><span>Period</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value)} className="rb-input">
              <option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option>
            </select>
          </label>

          <div className="rb-label"><span>Current Range</span>
            <div className="rb-input" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ opacity: 0.85, fontSize: 14 }}>{range.startISO || '—'} → {range.endISO || '—'}</span>
              <button className="rb-btn" type="button" onClick={refreshRange}>Refresh</button>
            </div>
          </div>

          <div className="rb-label"><span>Custom Range (YYYY-MM-DD)</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
              <input className="rb-input" placeholder="Start" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
              <input className="rb-input" placeholder="End" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={useCustom} onChange={(e) => setUseCustom(e.target.checked)} />Use
              </label>
            </div>
          </div>

          <label className="rb-label"><span>Banner Title</span>
            <input className="rb-input" value={bannerTitle} onChange={(e) => setBannerTitle(e.target.value)} placeholder="$500 Monthly Leaderboard" />
          </label>

          <div className="rb-label"><span>Social Links</span>
            <div style={{ display: 'grid', gap: 8 }}>
              {socials.map((s, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 8 }}>
                  <input className="rb-input" placeholder="Name" value={s.name} onChange={(e) => setSocials((v) => v.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))} />
                  <input className="rb-input" placeholder="https://…" value={s.url} onChange={(e) => setSocials((v) => v.map((x, idx) => (idx === i ? { ...x, url: e.target.value } : x)))} />
                  <button className="rb-btn" type="button" onClick={() => setSocials((v) => v.filter((_, idx) => idx !== i))}>Remove</button>
                </div>
              ))}
              {socials.length < 5 && <button className="rb-btn" type="button" onClick={() => setSocials((v) => [...v, { name: '', url: '' }])}>+ Add Link</button>}
            </div>
          </div>

          <div className="rb-label"><span>Paid Placements</span>
            <input className="rb-input" type="number" min="0" max="100" value={paidPlacements} onChange={(e) => handlePaid(e.target.value)} />
            <small className="rb-hint">How many top spots receive payouts.</small>
          </div>

          <div className="rb-label"><span>Payout Amounts (USD)</span>
            <div style={{ display: 'grid', gap: 8 }}>
              {Array.from({ length: paidPlacements }).map((_, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 8, alignItems: 'center' }}>
                  <div className="rb-pill">#{i + 1}</div>
                  <input className="rb-input" type="number" min="0" value={amounts[i] || 0} onChange={(e) => setAmountAt(i, e.target.value)} />
                </div>
              ))}
            </div>
          </div>

          <div className="rb-label"><span>Ends at (ISO)</span>
            <input className="rb-input" placeholder="2025-08-31T23:59:59Z" value={endsAtISO} onChange={(e) => setEndsAtISO(e.target.value)} />
            <small className="rb-hint">Timer reads this and won’t reset on refresh.</small>
          </div>

          <label className="rb-label"><span>Show Top N</span>
            <input className="rb-input" type="number" min="1" max="100" value={pageSize} onChange={(e) => setPageSize(e.target.value)} />
          </label>

          <div className="rb-actions">
            <button className="rb-btn" type="button" onClick={save}>Save</button>
            <a className="rb-link" href="#/past">View Past</a>
            <button className="rb-btn" type="button" onClick={logout} style={{ background: '#e2e8f0', color: '#0b0c10' }}>Logout</button>
            <span className="rb-msg">{msg}</span>
          </div>
        </div>
      )}
    </div>
  )
}

/* ================= CSS ================= */
function Styles() {
  return (
    <style>{`
:root{--bg:#0b0c10;--panel:#10121a;--panel2:#0d1017;--ink:#e5e7eb;--line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.06)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,Segoe UI,Roboto,Arial}

/* full-screen canvas background */
.rb-bg-canvas{
  position:fixed; inset:0; width:100%; height:100%;
  z-index:0; pointer-events:none; mix-blend-mode:normal;
}

/* main content sits above */
.rb-root,.rb-admin{ position:relative; z-index:1; }

.rb-root{min-height:100vh;background:
  radial-gradient(900px 480px at 15% -10%, rgba(34,211,238,.10), transparent),
  radial-gradient(900px 520px at 90% 0%, rgba(59,130,246,.08), transparent),
  var(--bg)}

/* Header */
.rb-header{position:sticky;top:0;z-index:10;display:grid;grid-template-columns:1fr auto;align-items:center;gap:16px;padding:16px 20px;border-bottom:1px solid var(--line);backdrop-filter:saturate(1.1) blur(10px);background:rgba(6,8,12,.75)}
.rb-header-centered{grid-template-columns:1fr 1fr 1fr}
.rb-left-spacer{height:1px}
.rb-center{display:flex;flex-direction:column;align-items:center;gap:6px}
.rb-title{margin:0;font-weight:800}
.rb-title-xl{font-size:34px;text-align:center;letter-spacing:.2px}
.rb-timer-big{font-size:22px;font-weight:900;padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.04)}
.rb-header-right{display:flex;gap:12px;justify-self:end}
.rb-link{color:#9ac2ff;text-decoration:none}

/* Hero meta & socials */
.rb-hero{max-width:1100px;margin:12px auto 8px;padding:0 18px;display:grid;gap:10px}
.rb-hero-center{justify-items:center;text-align:center}
.rb-hero-meta{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.rb-chip{border:1px solid var(--line);background:rgba(255,255,255,.04);padding:6px 10px;border-radius:999px;font-size:14px}
.rb-hero-socials{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}
.rb-social-link{color:#9ac2ff;text-decoration:none}

/* ==== CARD podium (Top 3) ==== */
.rb-podium-col{max-width:1000px;margin:0 auto 18px;padding:0 18px;display:flex;flex-direction:column;align-items:center;gap:18px}
.rb-podium-row-23{display:grid;grid-template-columns:1fr;gap:18px;width:100%}
@media(min-width:860px){.rb-podium-row-23{grid-template-columns:1fr 1fr}}

.rb-card-wrap{display:flex;justify-content:center;align-items:flex-start;width:100%;position:relative}
.rb-card-wrap-1{max-width:720px;margin:0 auto}

.rb-card{
  position:relative;
  width: min(100%, 680px);
  border-radius: 18px;
  border: 1px solid var(--line);
  background: linear-gradient(180deg, var(--panel), var(--panel2));
  box-shadow: 0 12px 30px rgba(0,0,0,.30), inset 0 1px 0 rgba(255,255,255,.06);
  padding: 20px 22px 34px;
  display:flex; align-items:center; justify-content:center;
  text-align:center;
}
.rb-card-1{
  background:
    radial-gradient(500px 140px at 50% 0%, rgba(255,214,94,.14), transparent),
    linear-gradient(180deg, #1c1a14, #13120e);
  border: 1px solid rgba(245,158,11,.35);
}
.rb-card-2{
  background:
    radial-gradient(500px 140px at 50% 0%, rgba(203,213,225,.16), transparent),
    linear-gradient(180deg, #171a1f, #121419);
  border: 1px solid rgba(203,213,225,.35);
}
.rb-card-3{
  background:
    radial-gradient(500px 140px at 50% 0%, rgba(187,132,74,.18), transparent),
    linear-gradient(180deg, #1a1510, #14100c);
  border: 1px solid rgba(180,83,9,.35);
}

.rb-card-content{max-width:90%}
.rb-card-name{font-weight:900;font-size:20px;letter-spacing:.2px}
.rb-card-wager{font-weight:900;font-size:28px;margin-top:6px}
.rb-card-prize{
  display:inline-block;margin-top:10px;padding:6px 12px;border-radius:999px;
  background:rgba(255,255,255,.08);border:1px solid var(--line);font-weight:800
}

/* Centered flag under card */
.rb-flag{
  position:absolute;left:50%;transform:translateX(-50%);
  bottom:-18px;min-width:78px;height:34px;padding:0 12px;
  display:flex;align-items:center;justify-content:center;
  color:#0b0c10;font-weight:900;border-radius:8px;box-shadow:0 6px 16px rgba(0,0,0,.3)
}
.rb-flag::before{
  content:"";position:absolute;bottom:-10px;width:0;height:0;
  border-left:10px solid transparent;border-right:10px solid transparent;border-top:10px solid;left:50%;transform:translateX(-50%);opacity:.85
}
.rb-flag-1{ background: linear-gradient(180deg,#fbbf24,#f59e0b); }
.rb-flag-1::before{ border-top-color:#b97609; }
.rb-flag-2{ background: linear-gradient(180deg,#cbd5e1,#9ca3af); }
.rb-flag-2::before{ border-top-color:#7c858f; }
.rb-flag-3{ background: linear-gradient(180deg,#b45309,#92400e); color:#fff; }
.rb-flag-3::before{ border-top-color:#5e2c08; }
.rb-flag-num{ font-size:16px; letter-spacing:.5px }

/* Table */
.rb-main{max-width:1100px;margin:0 auto;padding:18px}
.rb-table-wrap{border:1px solid var(--line);border-radius:16px;overflow:hidden;background:rgba(255,255,255,.03)}
.rb-table{width:100%;border-collapse:separate;border-spacing:0}
.rb-th{font-weight:700;font-size:14px;text-align:left;color:#d4d4d8;padding:12px;background:rgba(255,255,255,.05)}
.rb-th-right{text-align:right}
.rb-tr{border-top:1px solid var(--line2)}
.rb-td{padding:12px;vertical-align:middle}
.rb-td-right{text-align:right}
.rb-td-rank{color:#a1a1aa;font-weight:900}
.rb-strong{font-weight:900}
.rb-paychip{display:inline-block;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid var(--line);font-weight:700}

/* Footer */
.rb-footer{display:flex;justify-content:space-between;align-items:center;color:#a1a1aa;font-size:12px;margin-top:16px}

/* Skeleton shimmer */
.rb-skel .rb-skel-bar{
  height:12px;border-radius:8px;
  background:linear-gradient(90deg,rgba(255,255,255,.08),rgba(255,255,255,.16),rgba(255,255,255,.08));
  background-size:200% 100%;animation:rb-shim 1.2s linear infinite
}
@keyframes rb-shim{0%{background-position:200% 0}100%{background-position:-200% 0}}

/* Admin */
.rb-admin{min-height:100vh;background:
  radial-gradient(800px 460px at 15% -10%, rgba(34,211,238,.10), transparent),
  radial-gradient(800px 500px at 85% 0%, rgba(59,130,246,.08), transparent),
  var(--bg);color:var(--ink);padding:18px}
.rb-admin-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.rb-admin-grid{display:grid;gap:12px;max-width:800px;margin:0 auto;border:1px solid var(--line);background:linear-gradient(180deg,var(--panel),var(--panel2));border-radius:16px;padding:16px}
.rb-label{display:grid;gap:6px}
.rb-input{padding:10px;border-radius:10px;border:1px solid var(--line);background:#0d1117;color:#e5e7eb}
.rb-hint{color:#9aa3ad}
.rb-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.rb-btn{padding:10px 14px;border-radius:10px;border:0;background:#fff;color:#0b0c10;font-weight:800;cursor:pointer}
.rb-msg{color:#cbd5e1}
.rb-pill{display:inline-block;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid var(--line);font-weight:800}
`}</style>
  )
}
