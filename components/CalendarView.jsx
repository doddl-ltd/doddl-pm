// Content calendar (boards Calendar / CalendarPhone): everything scheduled or waiting, across channels.
// GET /api/calendar?from&to (UK days). Week grid channel × day, month grid, channel and market filters.
import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { C, Note, Pill, Pills, StateLine } from './approvals/renderers/reviewKit'

const STATE = {
  live: { label: 'Live', desk: { background: C.indigo, color: '#fff' }, phone: { borderLeft: `6px solid ${C.indigo}` } },
  scheduled: { label: 'Scheduled', desk: { background: C.indigo, color: '#fff' }, phone: { borderLeft: `6px solid ${C.indigo}` } },
  waiting: { label: 'Waiting for approval', desk: { background: '#FFF6EA', color: '#6B3A00', border: '1.5px solid #E2A75A' }, phone: { borderLeft: '6px solid #E2A75A' } },
  planned: { label: 'Planned', desk: { background: '#fff', color: C.body, border: '1.5px dashed #B3ABC8' }, phone: { borderLeft: '6px dashed #B3ABC8' } },
}

function ukToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
}
function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function mondayOf(iso) {
  const d = new Date(`${iso}T12:00:00Z`)
  return addDays(iso, -((d.getUTCDay() + 6) % 7))
}
function monthRange(iso) {
  const first = `${iso.slice(0, 7)}-01`
  const d = new Date(`${first}T12:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + 1)
  d.setUTCDate(0)
  return [first, d.toISOString().slice(0, 10)]
}
const dayLabel = (iso, opts) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts })
const shortDay = (iso) => dayLabel(iso, { weekday: 'short', day: 'numeric' })
const SOCIAL = /instagram|facebook|tiktok|reels|stories|pinterest|youtube|social/i

export default function CalendarView({ user, isMobile, onOpenApproval }) {
  const [mode, setMode] = useState('week')
  const [anchor, setAnchor] = useState(() => mondayOf(ukToday()))
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [off, setOff] = useState({})
  const [market, setMarket] = useState('all')
  const [phoneFilter, setPhoneFilter] = useState('All')

  const view = isMobile ? 'week' : mode
  const [from, to] = view === 'week' ? [anchor, addDays(anchor, 6)] : monthRange(anchor)

  useEffect(() => {
    let live = true
    setLoading(true); setError('')
    ;(async () => {
      try {
        const r = await apiFetch(`/api/calendar?from=${from}&to=${to}`)
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || `Could not load the calendar (${r.status})`)
        if (live) setData(j)
      } catch (e) { if (live) { setError(e.message); setData(null) } }
      if (live) setLoading(false)
    })()
    return () => { live = false }
  }, [from, to])

  const items = (data && data.items) || []
  const channels = useMemo(() => {
    const list = [...new Set(items.map(i => i.channel || 'Other'))]
    return list
  }, [items])
  const markets = useMemo(() => [...new Set(items.flatMap(i => i.markets || []))].sort(), [items])
  const shown = items.filter(i => !off[i.channel || 'Other'] && (market === 'all' || (i.markets || []).includes(market)))
  const days = Array.from({ length: view === 'week' ? 7 : 0 }, (_, i) => addDays(from, i))

  const step = (dir) => {
    if (view === 'week') setAnchor(addDays(anchor, dir * 7))
    else { const d = new Date(`${anchor.slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + dir); setAnchor(d.toISOString().slice(0, 10)) }
  }
  const rangeLabel = view === 'week'
    ? `${dayLabel(from, { day: 'numeric', month: from.slice(5, 7) === to.slice(5, 7) ? undefined : 'short' })} – ${dayLabel(to, { day: 'numeric', month: 'long' })}`
    : dayLabel(from, { month: 'long', year: 'numeric' })

  const open = (i) => { if (i.approval_task_id && onOpenApproval) onOpenApproval(i.approval_task_id) }
  const Ev = ({ i }) => {
    const s = STATE[i.state] || STATE.planned
    const can = !!(i.approval_task_id && onOpenApproval)
    const style = { display: 'block', width: '100%', textAlign: 'left', borderRadius: 8, padding: '6px 8px', fontSize: 12, lineHeight: 1.35, marginBottom: 6, font: "600 12px 'Nunito', sans-serif", border: 0, cursor: can ? 'pointer' : 'default', ...s.desk }
    const body = <><b style={{ display: 'block', fontSize: 11, letterSpacing: '.03em' }}>{i.time}{i.state === 'live' ? ' · live' : ''}</b>{i.title}</>
    return can ? <button type="button" onClick={() => open(i)} title={s.label} style={style}>{body}</button> : <div title={s.label} style={style}>{body}</div>
  }

  const nav = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: isMobile ? 'space-between' : 'flex-start', flexWrap: 'wrap' }}>
      <Pill onClick={() => step(-1)} aria-label={`Previous ${view}`} style={{ minHeight: 40 }}>‹</Pill>
      <span style={{ fontWeight: 800, fontSize: 16, padding: '0 6px' }}>{rangeLabel}</span>
      <Pill onClick={() => step(1)} aria-label={`Next ${view}`} style={{ minHeight: 40 }}>›</Pill>
      {!isMobile ? (<>
        <Pill on={mode === 'week'} onClick={() => { setMode('week'); setAnchor(mondayOf(anchor)) }} style={{ minHeight: 40 }}>Week</Pill>
        <Pill on={mode === 'month'} onClick={() => setMode('month')} style={{ minHeight: 40 }}>Month</Pill>
      </>) : null}
    </div>
  )

  // Gaps: per channel, the days in the week with nothing on them.
  const gaps = view === 'week' ? channels.filter(ch => !off[ch]).map(ch => {
    const empty = days.filter(d => !shown.some(i => (i.channel || 'Other') === ch && i.day === d))
    if (!empty.length) return null
    const last = days.filter(d => !empty.includes(d)).pop()
    if (last && empty.every(d => d > last)) return `${ch}: nothing after ${dayLabel(last, { weekday: 'short' })}`
    return empty.length <= 3 ? `${ch}: nothing on ${empty.map(d => dayLabel(d, { weekday: 'short' })).join(', ')}` : null
  }).filter(Boolean).slice(0, 4) : []
  const waiting = shown.filter(i => i.state === 'waiting')

  const legend = (
    <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
      {[['scheduled', 'Approved and scheduled'], ['waiting', 'Waiting for approval'], ['planned', 'In the approved plan, not made yet']].map(([k, label]) => (
        <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700 }}>
          <span style={{ width: 14, height: 14, borderRadius: 4, display: 'inline-block', boxSizing: 'border-box', ...STATE[k].desk }} />{label}
        </span>
      ))}
    </div>
  )

  if (isMobile) {
    const filters = ['All', ...(channels.some(c => SOCIAL.test(c)) ? ['Social'] : []), ...channels.filter(c => !SOCIAL.test(c))]
    const keep = (i) => phoneFilter === 'All' || (phoneFilter === 'Social' ? SOCIAL.test(i.channel || '') : (i.channel || 'Other') === phoneFilter)
    const list = shown.filter(keep)
    const byDay = days.map(d => ({ d, items: list.filter(i => i.day === d) })).filter(x => x.items.length)
    return (
      <div style={{ padding: '4px 4px 16px', display: 'flex', flexDirection: 'column', gap: 12, color: C.ink, fontFamily: "'Nunito', sans-serif" }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Content calendar</h1>
        {nav}
        <Pills label="Channel">{filters.map(f => <Pill key={f} on={phoneFilter === f} onClick={() => setPhoneFilter(f)} style={{ minHeight: 40, fontSize: 13 }}>{f}</Pill>)}</Pills>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, fontWeight: 700 }}>
          <span style={{ fontSize: 11, fontWeight: 800, borderRadius: 999, padding: '2px 8px', background: C.indigo, color: '#fff' }}>Scheduled</span>
          <span style={{ fontSize: 11, fontWeight: 800, borderRadius: 999, padding: '2px 8px', background: '#FFF6EA', color: '#6B3A00' }}>Waiting for approval</span>
          <span style={{ fontSize: 11, fontWeight: 800, borderRadius: 999, padding: '2px 8px', background: C.grey, color: C.body }}>Planned</span>
        </div>
        <StateLine loading={loading} error={error} empty={!loading && !error && !byDay.length}>Nothing scheduled this week.</StateLine>
        {!loading ? byDay.map(({ d, items: its }) => (
          <section key={d} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 style={{ margin: '6px 0 0', fontSize: 14, fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: '.06em' }}>{dayLabel(d, { weekday: 'long', day: 'numeric' })}</h2>
            {its.map(i => {
              const s = STATE[i.state] || STATE.planned
              const can = !!(i.approval_task_id && onOpenApproval)
              const style = { display: 'grid', gridTemplateColumns: '56px minmax(0,1fr)', gap: 10, alignItems: 'center', background: '#fff', borderRadius: 12, padding: '10px 12px', border: `1px solid ${C.line}`, textAlign: 'left', width: '100%', font: 'inherit', color: C.ink, minHeight: 56, cursor: can ? 'pointer' : 'default', ...s.phone }
              const body = <><span style={{ fontSize: 13, fontWeight: 800 }}>{i.time}</span><span style={{ minWidth: 0 }}><span style={{ display: 'block', fontSize: 14, fontWeight: 800 }}>{i.title}</span><span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>{i.channel || 'Other'} · {s.label}</span></span></>
              return can ? <button key={i.id} type="button" onClick={() => open(i)} style={style}>{body}</button> : <div key={i.id} style={style}>{body}</div>
            })}
          </section>
        )) : null}
      </div>
    )
  }

  const pillSm = { minHeight: 40, fontSize: 13 }
  let grid = null
  if (view === 'week') {
    const cols = '130px repeat(7, minmax(0, 1fr))'
    const cell = { borderTop: `1px solid ${C.line2}`, borderLeft: `1px solid ${C.line2}`, padding: 8, minHeight: 84, boxSizing: 'border-box' }
    const rows = channels.filter(ch => !off[ch])
    grid = (
      <div className="scroll-x" style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, marginTop: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: cols, minWidth: 1040 }}>
          <div style={{ ...cell, minHeight: 0, borderLeft: 0, borderTop: 0, background: C.bg }} />
          {days.map(d => <div key={d} style={{ ...cell, minHeight: 0, borderTop: 0, background: C.bg, fontSize: 13, fontWeight: 800, color: C.body }}>{shortDay(d)}</div>)}
          {rows.map(ch => [
            <div key={`${ch}-h`} style={{ ...cell, borderLeft: 0, fontWeight: 800, fontSize: 14 }}>{ch}</div>,
            ...days.map(d => <div key={`${ch}-${d}`} style={cell}>{shown.filter(i => (i.channel || 'Other') === ch && i.day === d).map(i => <Ev key={i.id} i={i} />)}</div>),
          ])}
        </div>
        {!rows.length && !loading ? <Note style={{ padding: 16 }}>Nothing scheduled this week.</Note> : null}
      </div>
    )
  } else {
    const start = mondayOf(from)
    const weeks = []
    for (let w = start; w <= to; w = addDays(w, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(w, i)))
    const cell = { borderTop: `1px solid ${C.line2}`, borderLeft: `1px solid ${C.line2}`, padding: 6, minHeight: 110, boxSizing: 'border-box' }
    grid = (
      <div className="scroll-x" style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, marginTop: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', minWidth: 900 }}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => <div key={d} style={{ ...cell, minHeight: 0, borderTop: 0, borderLeft: i ? cell.borderLeft : 0, background: C.bg, fontSize: 13, fontWeight: 800, color: C.body }}>{d}</div>)}
          {weeks.flat().map((d, i) => {
            const inMonth = d >= from && d <= to
            const its = inMonth ? shown.filter(x => x.day === d) : []
            return (
              <div key={d} style={{ ...cell, borderLeft: i % 7 ? cell.borderLeft : 0, background: inMonth ? '#fff' : '#FBFAFD' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: inMonth ? C.ink : C.faint, marginBottom: 4 }}>{Number(d.slice(8))}</div>
                {its.slice(0, 3).map(x => <Ev key={x.id} i={{ ...x, title: `${x.channel ? `${x.channel}: ` : ''}${x.title}` }} />)}
                {its.length > 3 ? <span style={{ fontSize: 12, fontWeight: 800, color: C.muted }}>+{its.length - 3} more</span> : null}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '4px 16px 40px', color: C.ink, fontFamily: "'Nunito', sans-serif" }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 16, alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800 }}>Content calendar</h1>
          <p style={{ margin: '6px 0 0', color: C.muted, fontSize: 15 }}>Everything approved and scheduled, and what is waiting for a yes, across channels.</p>
        </div>
        {nav}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18, alignItems: 'center' }}>
        {channels.length ? <span style={{ fontSize: 13, fontWeight: 800, color: C.muted, marginRight: 4 }}>Channels</span> : null}
        {channels.map(ch => <Pill key={ch} on={!off[ch]} onClick={() => setOff({ ...off, [ch]: !off[ch] })} style={pillSm}>{ch}</Pill>)}
        {markets.length ? (<>
          <span style={{ fontSize: 13, fontWeight: 800, color: C.muted, margin: '0 4px 0 12px' }}>Market</span>
          <Pill on={market === 'all'} onClick={() => setMarket('all')} style={pillSm}>All</Pill>
          {markets.map(m => <Pill key={m} on={market === m} onClick={() => setMarket(m)} style={pillSm}>{m}</Pill>)}
        </>) : null}
      </div>
      <div style={{ marginTop: 14 }}>{legend}</div>
      <StateLine loading={loading && !data} error={error} />
      {grid}
      {view === 'week' && !error && !loading ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
          <p style={{ margin: 0, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: '12px 14px', fontSize: 14, flex: '1 1 320px' }}>
            <b>Gaps this week:</b> {gaps.length ? gaps.join('; ') : 'none.'}
          </p>
          <p style={{ margin: 0, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: '12px 14px', fontSize: 14, flex: '1 1 320px' }}>
            <b>Waiting for a yes:</b> {waiting.length ? `${waiting.length} item${waiting.length === 1 ? '' : 's'} this week.` : 'nothing this week.'}{' '}
            {waiting[0] && waiting[0].approval_task_id && onOpenApproval ? <button type="button" onClick={() => open(waiting[0])} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 800, color: C.indigo, cursor: 'pointer', textDecoration: 'underline' }}>Open the first ›</button> : null}
          </p>
        </div>
      ) : null}
    </div>
  )
}
