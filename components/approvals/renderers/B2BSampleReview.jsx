// b2b_sample (board B2BSample): tick the businesses we should contact; for each one you untick, pick a reason
// (line_decisions["<id>:reason"], "other" also wants "<id>:note"). "What HQ learns" previews the rule each reason
// suggests. Every row starts ticked. Contacts show ROLE and type only.
import { useEffect, useMemo, useState } from 'react'
import { C, Panel, H2, Lbl, Note, Btn, inputStyle, text } from './reviewKit'
import { SAMPLE_REASONS, REASON_LABEL, learnPreview, contactText } from '../../../lib/b2b'

const fitColour = (f) => (f == null ? C.faint : f >= 80 ? C.ok : f >= 65 ? C.warn : C.bad)

function detailLine(p) {
  const d = p.details || {}
  const bits = [p.place]
  if (d.places != null) bits.push(`${d.places} places`)
  if (d.rating) bits.push(d.rating)
  if (d.size) bits.push(d.size)
  if (d.size_signal) bits.push(d.size_signal)
  return bits.filter(Boolean).map(text).join(' · ')
}

function Reasons({ id, lines, setReason, setNote, readOnly }) {
  const cur = lines[`${id}:reason`]
  if (readOnly) return <span style={{ fontSize: 13, color: C.bad, fontWeight: 700 }}>{cur ? REASON_LABEL[cur] : 'No reason'}{lines[`${id}:note`] ? `: ${lines[`${id}:note`]}` : ''}</span>
  return (
    <div>
      <div role="radiogroup" aria-label="Why not?" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {SAMPLE_REASONS.map(r => (
          <button key={r.id} type="button" role="radio" aria-checked={cur === r.id} onClick={() => setReason(id, r.id)}
            style={{ border: `1px solid ${cur === r.id ? C.bad : C.border}`, background: cur === r.id ? C.bad : '#fff', color: cur === r.id ? '#fff' : C.ink, borderRadius: 999, font: "700 12px 'Nunito', sans-serif", padding: '4px 10px', cursor: 'pointer', minHeight: 32 }}>
            {r.label}
          </button>
        ))}
      </div>
      {cur === 'other' && (
        <input value={lines[`${id}:note`] || ''} onChange={e => setNote(id, e.target.value)} aria-label="Why, in a few words" placeholder="Why, in a few words"
          style={{ ...inputStyle, minHeight: 36, padding: '6px 10px', marginTop: 6, fontSize: 13 }} />
      )}
      {!cur && <p style={{ margin: '4px 0 0', fontSize: 12, color: C.bad, fontWeight: 700 }}>Pick a reason</p>}
    </div>
  )
}

const COLS = '44px minmax(200px, 1.4fr) minmax(180px, 1.2fr) minmax(150px, 1fr) 56px minmax(200px, 1.2fr)'

export default function B2BSampleReview({ task, artefact, isMobile, readOnly, lines: liveLines, setLines }) {
  const a = artefact || {}
  const list = useMemo(() => (a.prospects || []).filter(p => p && p.id), [a.prospects])
  const decided = task && task.decision
  const lines = decided ? (task.line_decisions || {}) : (liveLines || {})
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    if (readOnly || !setLines) return
    const missing = list.filter(p => !(p.id in (liveLines || {})))
    if (missing.length) setLines(prev => ({ ...Object.fromEntries(missing.map(p => [p.id, 'approved'])), ...prev }))
  }, [list, readOnly, liveLines]) // eslint-disable-line react-hooks/exhaustive-deps

  const isOn = (id) => lines[id] !== 'rejected'
  const toggle = (id, on) => setLines(prev => {
    const next = { ...prev, [id]: on ? 'approved' : 'rejected' }
    if (on) { delete next[`${id}:reason`]; delete next[`${id}:note`] }
    return next
  })
  const setReason = (id, r) => setLines(prev => { const n = { ...prev, [`${id}:reason`]: r }; if (r !== 'other') delete n[`${id}:note`]; return n })
  const setNote = (id, v) => setLines(prev => ({ ...prev, [`${id}:note`]: v }))

  const yes = list.filter(p => isOn(p.id))
  const avg = yes.length ? Math.round(yes.filter(p => p.fit != null).reduce((t, p) => t + p.fit, 0) / Math.max(1, yes.filter(p => p.fit != null).length)) : '–'
  const named = yes.filter(p => p.contact && p.contact.type === 'named').length
  const learn = learnPreview(lines)
  const missingReasons = list.filter(p => !isOn(p.id) && !lines[`${p.id}:reason`]).length
  const shown = showAll || list.length <= 10 ? list : list.slice(0, 10)
  const ro = readOnly || !!decided

  const tiles = (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
      {[['Ticked', `${yes.length} of ${list.length}`, C.ok], ['Average fit', avg, C.ink], ['Named contact found', `${named} of ${yes.length}`, C.ink], ['Left out by the rules', a.excluded_count ?? '–', C.ink, a.excluded_note]].map(([l, v, col, note]) => (
        <Panel key={l} pad="12px 16px"><Lbl>{l}</Lbl><p style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 800, color: col }}>{v}</p>{note ? <Note style={{ fontSize: 12 }}>{note}</Note> : null}</Panel>
      ))}
    </div>
  )

  const match = (p) => (p.match || []).map((m, j) => (
    <span key={j} style={{ display: 'inline-block', fontSize: 12, fontWeight: 800, borderRadius: 6, padding: '1px 6px', margin: '0 4px 4px 0', background: m.ok === false ? C.grey : C.okBg, color: m.ok === false ? C.muted : C.ok }}>{m.t}</span>
  ))
  const sources = (p) => (p.sources || []).map((s, j) => (
    <span key={j}>{j ? ', ' : ''}{s.url ? <a href={s.url} target="_blank" rel="noreferrer" style={{ color: C.indigo }}>{s.label}</a> : s.label}</span>
  ))
  const tick = (p) => (
    <input type="checkbox" checked={isOn(p.id)} disabled={ro} onChange={e => toggle(p.id, e.target.checked)} aria-label={`Use ${p.name}`} style={{ width: 22, height: 22, accentColor: C.indigo, margin: 0 }} />
  )

  const table = isMobile ? (
    <Panel pad="4px 14px">
      {shown.map((p, i) => {
        const ct = contactText(p.contact)
        return (
          <div key={p.id} style={{ padding: '12px 0', borderTop: i ? `1px solid ${C.line2}` : 0, background: isOn(p.id) ? 'transparent' : '#FDF6F6' }}>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: ro ? 'default' : 'pointer' }}>
              {tick(p)}
              <span style={{ minWidth: 0, flex: 1, fontSize: 14, lineHeight: 1.4 }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b style={{ overflowWrap: 'anywhere' }}>{p.name}</b><b style={{ color: fitColour(p.fit) }}>{p.fit ?? ''}</b></span>
                <span style={{ display: 'block', color: C.muted, fontSize: 13 }}>{detailLine(p)}</span>
                <span style={{ display: 'block', fontSize: 13, color: C.body }}>{ct.role} · {ct.type}</span>
              </span>
            </label>
            <div style={{ marginTop: 6, paddingLeft: 32 }}>{match(p)}</div>
            {!isOn(p.id) && <div style={{ marginTop: 6, paddingLeft: 32 }}><Reasons id={p.id} lines={lines} setReason={setReason} setNote={setNote} readOnly={ro} /></div>}
          </div>
        )
      })}
    </Panel>
  ) : (
    <Panel pad="0">
      <div className="scroll-x">
        <div role="table" aria-label="Sample" style={{ minWidth: 980 }}>
          <div role="row" style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '10px 16px', background: C.bg, fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted, borderRadius: '14px 14px 0 0' }}>
            <span role="columnheader">Use</span><span role="columnheader">Business</span><span role="columnheader">Why it matches</span><span role="columnheader">Contact</span><span role="columnheader">Fit</span><span role="columnheader">If unticked, why?</span>
          </div>
          {shown.map(p => {
            const ct = contactText(p.contact)
            return (
              <div role="row" key={p.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, alignItems: 'start', padding: '12px 16px', borderTop: `1px solid ${C.line2}`, fontSize: 14, lineHeight: 1.4, background: isOn(p.id) ? '#fff' : '#FDF6F6' }}>
                <span role="cell">{tick(p)}</span>
                <span role="cell" style={{ minWidth: 0 }}><b>{p.name}</b><br /><span style={{ color: C.muted }}>{detailLine(p)}</span>{(p.sources || []).length ? <><br /><span style={{ fontSize: 12, color: C.muted }}>Found in: {sources(p)}</span></> : null}</span>
                <span role="cell" style={{ minWidth: 0 }}>{match(p)}</span>
                <span role="cell" style={{ minWidth: 0 }}>{ct.role}<br /><span style={{ fontSize: 12, color: C.muted }}>{ct.type}</span></span>
                <span role="cell" style={{ fontSize: 18, fontWeight: 800, color: fitColour(p.fit) }}>{p.fit ?? '–'}</span>
                <span role="cell" style={{ minWidth: 0 }}>{isOn(p.id) ? <span style={{ color: C.faint, fontSize: 13 }}>Ticked</span> : <Reasons id={p.id} lines={lines} setReason={setReason} setNote={setNote} readOnly={ro} />}</span>
              </div>
            )
          })}
        </div>
      </div>
      {list.length > 10 && (
        <p style={{ margin: 0, padding: '12px 16px', fontSize: 13, color: C.muted, borderTop: `1px solid ${C.line2}` }}>
          Showing {shown.length} of {list.length}. <button type="button" onClick={() => setShowAll(s => !s)} style={{ background: 'none', border: 0, padding: 0, color: C.indigo, font: "800 13px 'Nunito', sans-serif", cursor: 'pointer', minHeight: 32 }}>{showAll ? 'Show 10' : `Show all ${list.length}`}</button>
        </p>
      )}
    </Panel>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 18 }}>
      <p style={{ margin: 0, color: C.muted, fontSize: 14, maxWidth: 900, lineHeight: 1.5 }}>
        Tick the ones you would want us to contact. For any you untick, say why: HQ turns your reasons into rules before it searches for the rest. Nobody on this list has been contacted.
      </p>
      {tiles}
      {table}
      {isMobile && list.length > 10 && <Btn onClick={() => setShowAll(s => !s)}>{showAll ? 'Show 10' : `Show all ${list.length}`}</Btn>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 12 : 20, alignItems: 'stretch' }}>
        <Panel style={{ flex: '1 1 420px' }}>
          <H2>What HQ learns from your answers</H2>
          {learn.length ? learn.map((l, i) => (
            <p key={l.reason} style={{ margin: 0, padding: '8px 0', borderTop: i ? '1px solid #F1EEF6' : 0, fontSize: 14, lineHeight: 1.45 }}><b>{l.rule}</b><br /><span style={{ color: C.muted }}>{l.from}</span></p>
          )) : <Note style={{ fontSize: 14 }}>Untick a business and pick a reason; the rule it suggests shows here. HQ saves the rules with the business type.</Note>}
        </Panel>
        <Panel style={{ flex: '1 1 340px' }}>
          <H2>When you approve</H2>
          <p style={{ margin: 0, fontSize: 14, color: C.body, lineHeight: 1.5 }}>
            Approving adds your ticked businesses to the list, saves the new rules and lets HQ find the rest. You see the full list before anyone is emailed, at the go-live step.
          </p>
          {!ro && missingReasons > 0 && <p role="status" style={{ margin: '10px 0 0', fontSize: 13, fontWeight: 800, color: C.bad }}>{missingReasons} unticked without a reason yet.</p>}
        </Panel>
      </div>
    </div>
  )
}

B2BSampleReview.approveLabel = (tally) => (tally.yes + tally.no ? `Approve ${tally.yes}, find the rest` : 'Approve and find the rest')
