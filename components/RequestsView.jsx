// The requests hub (migration 35): one front door for every ask, one-off or ongoing.
// Tabs: New request · All requests · Standing work · Waiting on me; one request opens with its stage track, plan or
// finished work to decide on, the question thread, details, who approves and history.
// Mockup Jon signed off 2026-11-13: https://claude.ai/artifact/TiwHcEZ7MxAtdwvxV1apJy
import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { C, Panel, H2, Note, Chip, Btn, fmtWhen } from './approvals/renderers/reviewKit'
import { TYPES, ICONS, LABELS, TRACK, stepsFor, missingIn, waitingOn } from '../lib/pm/requestTypes'

const TONE = { warn: [C.warnBg, C.warn], ok: [C.okBg, C.ok], info: [C.soft, C.indigo], grey: [C.grey, C.muted], on: [C.blueBg, C.blue] }
const tone = (t) => TONE[t] || TONE.grey
const modeChip = (m) => (m === 'on' ? <Chip bg={C.blueBg} fg={C.blue}>Ongoing</Chip> : <Chip bg={C.grey} fg={C.muted}>One-off</Chip>)
const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d` }
const field = { width: '100%', boxSizing: 'border-box', border: `1px solid ${C.border}`, borderRadius: 10, padding: '11px 13px', font: "600 14px 'Nunito', sans-serif", color: C.ink, background: '#fff' }
const isWaiting = (r) => r.stage === 'plan_approval' || r.stage === 'output_approval'

function Icon({ kind, size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[kind]} /></svg>
}
const IcoBox = ({ kind }) => <span style={{ width: 38, height: 38, borderRadius: 10, background: C.soft, color: C.indigo, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon kind={kind} /></span>
function Pill({ on, onClick, children }) {
  return <button type="button" aria-pressed={on} onClick={onClick} style={{ minHeight: 38, padding: '0 15px', borderRadius: 999, border: `1px solid ${on ? C.indigo : C.border}`, background: on ? C.indigo : '#fff', font: "700 13.5px 'Nunito', sans-serif", color: on ? '#fff' : C.ink, cursor: 'pointer', margin: '0 6px 8px 0' }}>{children}</button>
}
function Rows({ rows }) {
  return rows.map(([k, v], i) => (
    <div key={k + i} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '9px 0', borderTop: i ? `1px solid ${C.line2}` : 0, fontSize: 13.5 }}>
      <span style={{ color: C.muted, fontWeight: 700, flex: 'none' }}>{k}</span><span style={{ textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{v}</span>
    </div>
  ))
}
const Box = ({ children, style }) => <div style={{ background: C.bg, borderRadius: 12, padding: '12px 16px', ...style }}>{children}</div>
const Err = ({ children }) => (children ? <p role="alert" style={{ fontSize: 13, fontWeight: 700, color: C.bad, margin: '8px 0 0' }}>{children}</p> : null)

export default function RequestsView({ user, isMobile }) {
  const [tab, setTab] = useState('new')
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  const [sel, setSel] = useState(null)
  const load = async () => {
    const r = await apiFetch('/api/requests')
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `Could not load requests (${r.status})`)
    setList(j.requests || [])
  }
  useEffect(() => { load().catch(e => setError(e.message)) }, [])
  const call = async (body) => {
    const r = await apiFetch('/api/requests', { method: 'POST', body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `Could not do that (${r.status})`)
    await load()
    return j
  }
  const open = (id) => { setSel(id); setTab('detail') }
  const reqs = list || []
  const waiting = reqs.filter(isWaiting)
  const tabs = [['new', 'New request'], ['board', 'All requests'], ['standing', 'Standing work'], ['inbox', `Waiting on me (${waiting.length})`]]
  const on = (k) => tab === k || (k === 'new' && tab === 'form') || (k === 'board' && tab === 'detail')

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', fontFamily: "'Nunito', sans-serif", color: C.ink }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px' }}>
          <p style={{ margin: 0, fontSize: 11.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted }}>Requests</p>
          <h1 style={{ margin: '4px 0 0', fontSize: isMobile ? 22 : 28, fontWeight: 800 }}>One front door for every ask</h1>
          <Note style={{ marginTop: 6, fontSize: 14 }}>One-off jobs and ongoing work alike: reports and dashboard tiles, campaigns, pages, products, IP, decks and changes to PM itself.</Note>
        </div>
        {waiting.length ? <Chip bg={C.warnBg} fg={C.warn} style={{ fontSize: 13, padding: '6px 12px' }}>{waiting.length} waiting on you</Chip> : null}
      </div>
      <div role="tablist" style={{ display: 'flex', gap: isMobile ? 14 : 24, flexWrap: 'wrap', borderBottom: `1px solid ${C.line}`, margin: '20px 0 22px' }}>
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={on(k)} onClick={() => setTab(k)} style={{ background: 'none', border: 0, borderBottom: `3px solid ${on(k) ? C.indigo : 'transparent'}`, font: "800 14px 'Nunito', sans-serif", color: on(k) ? C.indigo : C.muted, padding: '0 2px', minHeight: 44, cursor: 'pointer' }}>{label}</button>
        ))}
      </div>
      {error ? <Err>{error}</Err> : null}
      {list === null && !error ? <Note>Loading requests…</Note> : null}
      {list !== null && (tab === 'new' || tab === 'form') ? <NewRequest reqs={reqs} isMobile={isMobile} call={call} open={open} tab={tab} setTab={setTab} /> : null}
      {list !== null && tab === 'board' ? <Board reqs={reqs} user={user} open={open} isMobile={isMobile} /> : null}
      {list !== null && tab === 'standing' ? <Standing reqs={reqs} call={call} open={open} /> : null}
      {list !== null && tab === 'inbox' ? <Inbox reqs={waiting} open={open} /> : null}
      {list !== null && tab === 'detail' ? <Detail r={reqs.find(x => x.id === sel)} reqs={reqs} call={call} open={open} back={() => setTab('board')} isMobile={isMobile} /> : null}
    </div>
  )
}

// ─── New request ──────────────────────────────────────────────────────────────
function NewRequest({ reqs, isMobile, call, open, tab, setTab }) {
  const [mode, setMode] = useState('one')
  const [kind, setKind] = useState(null)
  const [step, setStep] = useState(0)
  const [v, setV] = useState({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const suggestions = reqs.filter(r => r.stage === 'suggested')
  const pick = (k) => { const m = TYPES[k].oneOnly ? 'one' : mode; setKind(k); setMode(m); setStep(0); setV({}); setErr(''); setTab('form') }

  if (tab === 'form' && kind) {
    const t = TYPES[kind]
    const steps = stepsFor(kind, mode)
    const cur = steps[step]
    const last = step === steps.length - 1
    const set = (k, val) => { setV(prev => ({ ...prev, [k]: val })); setErr('') }
    const toggle = (f, o) => { setV(prev => { const now = (prev[f.k] || '').split(', ').filter(Boolean); return { ...prev, [f.k]: f.multi ? (now.includes(o) ? now.filter(x => x !== o) : [...now, o]).join(', ') : o } }); setErr('') }
    const next = async () => {
      const miss = missingIn(cur, v)
      if (miss.length) { setErr(`Fill in ${miss.map(f => f.l.toLowerCase().replace(/\?$/, '')).join(' and ')} first`); return }
      if (!last) { setStep(step + 1); return }
      setBusy(true)
      try { const r = await call({ kind, mode, fields: v }); setKind(null); open(r.id) } catch (e) { setErr(e.message) } finally { setBusy(false) }
    }
    const flow = TRACK[mode].map(([, n], i) => [`${i + 1}. ${n}`, ['You', 'You', 'The agent', 'You', mode === 'on' ? 'Standing work' : 'Live', mode === 'on' ? `${v.owner || 'The owner'}, every ${(v.review || 'quarter').toLowerCase()}` : 'HQ, after 14 days'][i]])
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <Panel style={{ flex: '999 1 560px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><IcoBox kind={kind} /><div><p style={{ margin: 0, fontSize: 11.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted }}>{mode === 'on' ? 'Ongoing request' : 'One-off request'}</p><p style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 800 }}>{t.name}</p></div></div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '16px 0 6px' }}>
            {steps.map(([label], i) => { const [bg, fg] = i === step ? [C.indigo, '#fff'] : i < step ? tone('ok') : [C.grey, C.faint]; return <Chip key={label} bg={bg} fg={fg}>{i + 1} {label}</Chip> })}
          </div>
          {cur[1].map(f => (
            <div key={f.k} style={{ marginTop: 16 }}>
              <label htmlFor={`rq-${f.k}`} style={{ display: 'block', fontSize: 14, fontWeight: 800, marginBottom: 8 }}>{f.l} {f.multi ? <span style={{ fontWeight: 600, color: C.faint, fontSize: 12.5 }}>(pick any)</span> : null}</label>
              {f.ch
                ? <div id={`rq-${f.k}`} role="group">{f.ch.map(o => <Pill key={o} on={(v[f.k] || '').split(', ').includes(o)} onClick={() => toggle(f, o)}>{o}</Pill>)}</div>
                : <input id={`rq-${f.k}`} style={field} placeholder={f.ph} value={v[f.k] || ''} onChange={e => set(f.k, e.target.value)} />}
            </div>
          ))}
          {last ? (
            <>
              <Box style={{ marginTop: 14 }}><Rows rows={[...Object.entries(v).filter(([, x]) => x).map(([k, x]) => [LABELS[k] || k, x]), ['Kind', mode === 'on' ? 'Ongoing' : 'One-off'], ['Goes to', t.agent]]} /></Box>
              <Note style={{ marginTop: 10 }}>The plan is drafted from your answers as soon as you send it. Nothing starts until you approve the plan.</Note>
            </>
          ) : null}
          <Err>{err}</Err>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18, gap: 10 }}>
            <Btn onClick={() => (step ? setStep(step - 1) : setTab('new'))}>{step ? 'Back' : 'Cancel'}</Btn>
            <Btn primary disabled={busy} onClick={next}>{last ? (busy ? 'Sending…' : 'Send') : 'Next'}</Btn>
          </div>
        </Panel>
        <Panel style={{ flex: '1 1 300px' }}>
          <H2>What happens next</H2>
          <Note style={{ marginBottom: 8 }}>Goes to: {t.agent}</Note>
          <Rows rows={flow} />
        </Panel>
      </div>
    )
  }

  const card = (k, name, sub, eg) => (
    <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)} style={{ display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left', borderRadius: 14, padding: 16, cursor: 'pointer', background: mode === k ? '#F4F0FC' : '#fff', border: mode === k ? `2px solid ${C.indigo}` : `1px solid ${C.line}`, font: "inherit", color: C.ink }}>
      <span style={{ fontSize: 16, fontWeight: 800 }}>{name}</span>
      <span style={{ fontSize: 13, color: C.muted, fontWeight: 600, lineHeight: 1.45 }}>{sub}</span>
      <span style={{ fontSize: 12, color: C.faint, fontWeight: 700 }}>For example: {eg}</span>
    </button>
  )
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
      <div style={{ flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Panel>
          <H2>1. Is this a one-off, or ongoing?</H2>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            {card('one', 'One-off', 'Done once, then closed with its results.', 'a report, a deck, a burst campaign, a new page')}
            {card('on', 'Ongoing', 'Runs or stays live until it is retired, with an owner and a review date.', 'a dashboard tile, a scheduled report, always-on ads, a watch')}
          </div>
        </Panel>
        <Panel>
          <H2>2. What is it?</H2>
          <Note style={{ marginBottom: 12 }}>{mode === 'on' ? 'Ongoing work keeps running and shows in Standing work once approved.' : 'One-off jobs each close with their results.'}</Note>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {Object.entries(TYPES).map(([k, t]) => {
              const only = mode === 'on' && t.oneOnly
              return (
                <button key={k} type="button" onClick={() => pick(k)} style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left', background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, cursor: 'pointer', minHeight: 132, opacity: only ? 0.7 : 1, font: 'inherit', color: C.ink }}>
                  <IcoBox kind={k} />
                  <span style={{ fontSize: 15, fontWeight: 800 }}>{t.name}</span>
                  <span style={{ fontSize: 12.5, color: C.muted, fontWeight: 600, lineHeight: 1.4 }}>{mode === 'on' && !t.oneOnly ? t.on : t.one}</span>
                  {only ? <Chip bg={C.grey} fg={C.muted} style={{ alignSelf: 'flex-start' }}>One-off only</Chip> : null}
                </button>
              )
            })}
          </div>
        </Panel>
      </div>
      <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Panel>
          <H2>Suggested by HQ</H2>
          <Note style={{ marginBottom: 6 }}>Agents spot these in their reviews. Accept one and it becomes a request with a plan to approve.</Note>
          {suggestions.length ? suggestions.map(s => (
            <div key={s.id} style={{ borderTop: `1px solid ${C.line2}`, padding: '12px 0' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>{modeChip(s.mode)}<span style={{ fontSize: 12, color: C.faint, fontWeight: 700 }}>{s.suggested_from}</span></div>
              <p style={{ margin: '6px 0 4px', fontWeight: 800, fontSize: 14 }}>{s.title}</p>
              {(s.thread || [])[0] ? <Note>{s.thread[0].text}</Note> : null}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><Btn primary style={{ minHeight: 34, fontSize: 13 }} onClick={() => call({ id: s.id, op: 'accept' }).then(() => open(s.id))}>Accept</Btn><Btn style={{ minHeight: 34, fontSize: 13 }} onClick={() => call({ id: s.id, op: 'decline' })}>Dismiss</Btn></div>
            </div>
          )) : <Note>Nothing suggested right now. Agents add suggestions here once they are switched on.</Note>}
        </Panel>
        <Panel>
          <H2>How every request moves</H2>
          {[['1', 'Asked: a short form for each type.', 'info'], ['2', 'A plan, drafted from your answers: who does it, what you get, how success is measured.', 'info'], ['3', 'You approve the plan, change it or park it.', 'warn'], ['4', 'The agent makes or builds it.', 'info'], ['5', 'You approve the finished work.', 'warn'], ['6', 'One-off: live, then results and closed. Ongoing: joins Standing work, runs on its schedule, reviewed on a date, changed or retired from there.', 'ok']].map(([n, t, k]) => (
            <div key={n} style={{ display: 'flex', gap: 10, fontSize: 13.5, lineHeight: 1.45, padding: '5px 0' }}><Chip bg={tone(k)[0]} fg={tone(k)[1]}>{n}</Chip><span>{t}</span></div>
          ))}
        </Panel>
      </div>
    </div>
  )
}

// ─── All requests ─────────────────────────────────────────────────────────────
function Card({ r, open }) {
  const [w, t] = waitingOn(r)
  const [bg, fg] = tone(t)
  return (
    <button type="button" onClick={() => open(r.id)} style={{ display: 'block', width: '100%', textAlign: 'left', background: '#fff', border: `1px solid ${t === 'warn' ? '#E9C79A' : C.line}`, borderRadius: 12, padding: '11px 12px', marginTop: 8, cursor: 'pointer', font: 'inherit', color: C.ink }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 11.5, fontWeight: 800, color: C.faint }}><span>{TYPES[r.kind].name}</span><span>{ago(r.updated_at)}</span></span>
      <span style={{ display: 'block', fontWeight: 800, fontSize: 14, margin: '4px 0 8px', lineHeight: 1.3 }}>{r.title}</span>
      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{modeChip(r.mode)}<Chip bg={bg} fg={fg}>{w}</Chip></span>
    </button>
  )
}
function Board({ reqs, user, open, isMobile }) {
  const [filter, setFilter] = useState('all')
  const me = (user && user.name) || ''
  const shown = reqs.filter(r => r.stage !== 'suggested' && r.stage !== 'declined' && (filter === 'all' || (filter === 'mine' ? r.asked_by === me : r.mode === filter)))
  const cols = [['New', ['asked', 'parked']], ['Plan to approve', ['plan_approval']], ['Being made or built', ['in_progress']], ['Review, live, done', ['output_approval', 'live', 'running', 'closed']]]
  return (
    <>
      <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap', marginBottom: 6 }}>
        {[['all', 'All'], ['one', 'One-off'], ['on', 'Ongoing'], ['mine', 'Asked by me']].map(([k, l]) => <Pill key={k} on={filter === k} onClick={() => setFilter(k)}>{l}</Pill>)}
      </div>
      {!shown.length ? <Panel><Note>No requests yet. Start one from New request.</Note></Panel> : (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(4, minmax(${isMobile ? 240 : 220}px, 1fr))`, gap: 12 }}>
            {cols.map(([label, stages]) => {
              const items = shown.filter(r => stages.includes(r.stage))
              return (
                <div key={label} style={{ background: '#EFECF5', borderRadius: 14, padding: 12, minWidth: 0 }}>
                  <p style={{ margin: '2px 4px 0', fontSize: 11.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: C.muted }}>{label} · {items.length}</p>
                  {items.map(r => <Card key={r.id} r={r} open={open} />)}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

// ─── Standing work ────────────────────────────────────────────────────────────
function Standing({ reqs, call, open }) {
  const [ask, setAsk] = useState(null) // { id, op }
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const rows = reqs.filter(r => r.stage === 'running')
  const th = { fontSize: 11.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: C.muted, textAlign: 'left', padding: '10px 12px', borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap' }
  const td = { fontSize: 13.5, padding: 12, borderBottom: `1px solid ${C.line2}`, verticalAlign: 'top' }
  const go = async () => { try { if (!note.trim()) { setErr('Add a note first'); return } const r = await call({ id: ask.id, op: ask.op, note }); setAsk(null); setNote(''); if (ask.op === 'change_request') open(r.id) } catch (e) { setErr(e.message) } }
  return (
    <Panel pad="0" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '18px 20px 6px', display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px' }}><H2 style={{ margin: 0 }}>Standing work</H2><Note>Everything that runs or stays live: dashboard tiles, scheduled reports, always-on campaigns, watches. A change is a change request with its own approvals; nothing is edited in place.</Note></div>
        <Chip>{rows.filter(r => !r.paused).length} running</Chip>
      </div>
      {ask ? (
        <div style={{ margin: '8px 20px', padding: 12, background: C.bg, borderRadius: 12 }}>
          <label htmlFor="st-note" style={{ display: 'block', fontSize: 13, fontWeight: 800, marginBottom: 6 }}>{ask.op === 'retire' ? 'Why retire it?' : 'What should change?'}</label>
          <input id="st-note" style={field} value={note} onChange={e => { setNote(e.target.value); setErr('') }} />
          <Err>{err}</Err>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}><Btn primary style={{ minHeight: 36 }} onClick={go}>{ask.op === 'retire' ? 'Retire it' : 'Raise the change'}</Btn><Btn style={{ minHeight: 36 }} onClick={() => setAsk(null)}>Cancel</Btn></div>
        </div>
      ) : null}
      {!rows.length ? <div style={{ padding: '6px 20px 20px' }}><Note>Nothing running yet. Ongoing requests join this list once their finished work is approved.</Note></div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
            <thead><tr><th style={th}>Item</th><th style={th}>Lives in</th><th style={th}>Runs</th><th style={th}>Owner</th><th style={th}>Health</th><th style={th}>Next review</th><th style={th}>Cost a month</th><th style={th}><span style={{ position: 'absolute', left: -9999 }}>Actions</span></th></tr></thead>
            <tbody>
              {rows.map(r => {
                const [bg, fg] = r.paused ? tone('grey') : /off|fail|bad/i.test(r.health || '') ? tone('warn') : tone('ok')
                return (
                  <tr key={r.id}>
                    <td style={td}><button type="button" onClick={() => open(r.id)} style={{ background: 'none', border: 0, padding: 0, font: "800 13.5px 'Nunito', sans-serif", color: C.ink, cursor: 'pointer', textAlign: 'left' }}>{r.title}</button><span style={{ display: 'block', fontSize: 12, color: C.faint, fontWeight: 700 }}>{TYPES[r.kind].name}</span></td>
                    <td style={td}>{r.lives_in || '–'}</td><td style={td}>{r.cadence || '–'}</td><td style={td}>{r.owner || '–'}</td>
                    <td style={td}><Chip bg={bg} fg={fg}>{r.paused ? 'Paused' : r.health || 'Healthy'}</Chip>{r.health_note ? <span style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 4 }}>{r.health_note}</span> : null}</td>
                    <td style={td}>{r.next_review || '–'}</td><td style={td}>{r.cost_month || '–'}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <Btn style={{ minHeight: 34, fontSize: 13, padding: '0 12px' }} onClick={() => { setAsk({ id: r.id, op: 'change_request' }); setNote('') }}>Change</Btn>{' '}
                      <Btn style={{ minHeight: 34, fontSize: 13, padding: '0 12px' }} onClick={() => call({ id: r.id, op: 'pause' })}>{r.paused ? 'Resume' : 'Pause'}</Btn>{' '}
                      <Btn danger style={{ minHeight: 34, fontSize: 13, padding: '0 12px' }} onClick={() => { setAsk({ id: r.id, op: 'retire' }); setNote('') }}>Retire</Btn>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function Inbox({ reqs, open }) {
  return (
    <Panel>
      <H2>Waiting on you</H2>
      <Note style={{ marginBottom: 6 }}>Plans and finished work to approve.</Note>
      {reqs.length ? reqs.map((r, i) => (
        <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: i ? `1px solid ${C.line2}` : 0, flexWrap: 'wrap' }}>
          <span><span style={{ fontWeight: 800 }}>{r.title}</span><span style={{ display: 'block', fontSize: 12, color: C.faint, fontWeight: 700 }}>{TYPES[r.kind].name} · {r.mode === 'on' ? 'Ongoing' : 'One-off'}</span></span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Chip bg={C.warnBg} fg={C.warn}>{r.stage === 'plan_approval' ? 'Plan to approve' : 'Output to approve'}</Chip><Btn style={{ minHeight: 34, fontSize: 13 }} onClick={() => open(r.id)}>Open</Btn></span>
        </div>
      )) : <Note>Nothing waiting on you.</Note>}
    </Panel>
  )
}

// ─── One request ──────────────────────────────────────────────────────────────
function Detail({ r, reqs, call, open, back, isMobile }) {
  const [note, setNote] = useState('')
  const [reply, setReply] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setNote(''); setReply(''); setErr('') }, [r && r.id])
  if (!r) return <Panel><Note>That request is not in the list. <button type="button" onClick={back} style={{ background: 'none', border: 0, color: C.indigo, fontWeight: 800, cursor: 'pointer' }}>Back to all requests</button></Note></Panel>
  const [w, t] = waitingOn(r)
  const [bg, fg] = tone(t)
  const track = TRACK[r.mode]
  const order = track.map(([k]) => k)
  const pos = r.stage === 'running' ? order.indexOf('running') : order.indexOf(r.stage)
  const deciding = isWaiting(r)
  const out = r.stage === 'output_approval'
  const run = async (body, after) => { setBusy(true); setErr(''); try { await call(body); after && after() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  const parent = r.parent_id ? reqs.find(x => x.id === r.parent_id) : null
  const status = {
    suggested: 'Suggested by HQ. Accept it to get a plan to approve, or dismiss it.',
    asked: 'With HQ for scoping. Its questions and the plan will appear here.',
    in_progress: `${r.agent || 'The agent'} is working on it. You will be asked to approve the finished work here.`,
    live: 'Live. The results against the plan\'s success measure are posted here, then it closes.',
    running: `Running${r.paused ? ' (paused)' : ''}. It is in Standing work with its owner and review date; change, pause or retire it there.`,
    closed: r.results ? `Closed. Results: ${r.results}` : 'Closed.',
    parked: `Parked: ${r.parked_note || ''}`,
    declined: 'Declined.',
  }[r.stage]
  const f = r.fields || {}
  return (
    <>
      <button type="button" onClick={back} style={{ background: 'none', border: 0, font: "800 14px 'Nunito', sans-serif", color: C.indigo, cursor: 'pointer', minHeight: 34, marginBottom: 10, padding: 0 }}>‹ All requests</button>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Panel>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}><p style={{ margin: 0, fontSize: 11.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted }}>{TYPES[r.kind].name} · asked by {r.asked_by}</p><p style={{ margin: '4px 0 0', fontSize: isMobile ? 20 : 24, fontWeight: 800, lineHeight: 1.25 }}>{r.title}</p></div>
              <span style={{ display: 'flex', gap: 6 }}>{modeChip(r.mode)}<Chip bg={bg} fg={fg}>{w}</Chip></span>
            </div>
            {parent ? <Note style={{ marginTop: 6 }}>A change to <button type="button" onClick={() => open(parent.id)} style={{ background: 'none', border: 0, padding: 0, color: C.indigo, fontWeight: 800, cursor: 'pointer' }}>{parent.title}</button></Note> : null}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 16 }}>
              {track.map(([k, label], i) => { const [b, c] = ['parked', 'declined', 'suggested'].includes(r.stage) ? [C.grey, C.faint] : i < pos ? tone('ok') : i === pos ? [C.indigo, '#fff'] : [C.grey, C.faint]; return <Chip key={k} bg={b} fg={c}>{label}</Chip> })}
            </div>
            {deciding ? (
              <>
                <Box style={{ marginTop: 16 }}>
                  <p style={{ margin: '0 0 4px', fontWeight: 800, fontSize: 14 }}>{out ? 'The finished work' : 'The plan'}</p>
                  <Rows rows={out ? [['Made', (r.output && r.output.summary) || '–'], ...(r.output && r.output.link ? [['Preview', <a key="l" href={r.output.link} target="_blank" rel="noreferrer">Open it</a>]] : []), ['Checks', (r.output && r.output.checks) || 'Brand and claims checks run before it reaches you'], ['Goes live', r.mode === 'on' ? `When you approve; then it runs ${(r.cadence || 'on its schedule').toLowerCase()}` : 'When you approve']] : (r.plan || []).map(p => [p.k, p.v])} />
                </Box>
                <label htmlFor="rq-note" style={{ display: 'block', fontSize: 13, fontWeight: 800, margin: '14px 0 6px' }}>Note for HQ (needed to change it or park it)</label>
                <textarea id="rq-note" rows={2} style={{ ...field, resize: 'vertical' }} value={note} onChange={e => { setNote(e.target.value); setErr('') }} />
                <Err>{err}</Err>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  <Btn primary disabled={busy} onClick={() => run({ id: r.id, op: 'approve' }, () => setNote(''))}>{out ? (r.mode === 'on' ? 'Approve and start running' : 'Approve and go live') : 'Approve plan'}</Btn>
                  <Btn disabled={busy} onClick={() => (note.trim() ? run({ id: r.id, op: 'change', note }, () => setNote('')) : setErr('Add a note for HQ first'))}>{out ? 'Send back' : 'Change it'}</Btn>
                  <Btn disabled={busy} onClick={() => (note.trim() ? run({ id: r.id, op: 'park', note }, () => setNote('')) : setErr('Add a note for HQ first'))}>Not now</Btn>
                </div>
              </>
            ) : (
              <>
                <p style={{ margin: '16px 0 0', fontSize: 14, lineHeight: 1.5 }}>{status}</p>
                <Err>{err}</Err>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  {r.stage === 'suggested' ? <><Btn primary disabled={busy} onClick={() => run({ id: r.id, op: 'accept' })}>Accept</Btn><Btn disabled={busy} onClick={() => run({ id: r.id, op: 'decline' })}>Dismiss</Btn></> : null}
                  {r.stage === 'parked' ? <Btn disabled={busy} onClick={() => run({ id: r.id, op: 'reopen' })}>Reopen</Btn> : null}
                  {r.stage === 'live' ? <Btn disabled={busy} onClick={() => run({ id: r.id, op: 'close' })}>Close it</Btn> : null}
                </div>
              </>
            )}
          </Panel>
          <Panel>
            <H2>Questions and notes</H2>
            {(r.thread || []).map((m, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 0', borderTop: i ? `1px solid ${C.line2}` : 0 }}>
                <span style={{ flex: 'none', width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, background: m.who === 'HQ' ? C.indigo : C.soft, color: m.who === 'HQ' ? '#fff' : C.indigo }}>{m.who === 'HQ' ? 'HQ' : String(m.who || '?').slice(0, 1)}</span>
                <div style={{ minWidth: 0 }}><p style={{ margin: 0, fontSize: 12.5, fontWeight: 800 }}>{m.who} <span style={{ color: C.faint, fontWeight: 700 }}>{m.at ? fmtWhen(m.at) : ''}</span></p><p style={{ margin: '3px 0 0', fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{m.text}</p></div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <label htmlFor="rq-reply" style={{ position: 'absolute', left: -9999 }}>Reply to HQ</label>
              <input id="rq-reply" style={field} placeholder="Reply to HQ or add a note" value={reply} onChange={e => setReply(e.target.value)} />
              <Btn disabled={busy || !reply.trim()} onClick={() => run({ id: r.id, op: 'reply', text: reply }, () => setReply(''))}>Send</Btn>
            </div>
          </Panel>
        </div>
        <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Panel>
            <H2>Details</H2>
            <Rows rows={[['Kind', r.mode === 'on' ? 'Ongoing' : 'One-off'], ['Asked by', r.asked_by], ['Asked', fmtWhen(r.created_at)], ['Agent', r.agent || TYPES[r.kind].agent], ...(r.mode === 'on' ? [['Owner', r.owner || 'Not set'], ['Runs', r.cadence || 'Not set'], ['Review every', r.review_every || 'Not set']] : []), ...Object.entries(f).filter(([k, x]) => x && !['q', 'owner', 'cad', 'review'].includes(k)).map(([k, x]) => [LABELS[k] || k, x])]} />
          </Panel>
          <Panel>
            <H2>Who approves</H2>
            <Rows rows={[['Plan', 'Jon'], ['Finished work', 'Jon'], ...(r.mode === 'on' ? [['Changes', 'The owner, then Jon']] : [])]} />
            <Note style={{ marginTop: 8 }}>DEFAULT until per-type approvers are set in Who approves what.</Note>
          </Panel>
          <Panel>
            <H2>History</H2>
            {(r.log || []).slice().reverse().map((l, i) => (
              <div key={i} style={{ padding: '8px 0', borderTop: i ? `1px solid ${C.line2}` : 0, fontSize: 13 }}><span style={{ color: C.faint, fontWeight: 700, marginRight: 8 }}>{fmtWhen(l.at)}</span>{l.text}</div>
            ))}
          </Panel>
        </div>
      </div>
    </>
  )
}
