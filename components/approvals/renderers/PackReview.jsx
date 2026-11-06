// Pack (batch) review for artefact_type `pack` (boards Batch, BatchPhone): groups of lines, a tick per line,
// before → after with an in-place edit, limit chips, running weekly totals per currency, "Approve n" / "Tick all".
// Sets lines: { "<line_id>": "approved" | "rejected" | "edited", "<line_id>:edit": "<new after>" }.
// pack_kind "replies" uses Approve / Edit / Skip per line instead of a tick (board Batch, daily replies).
import { useEffect, useMemo, useState } from 'react'
import { C, TONES, lineTally, money, packTotals, outcomeChip } from '../../../lib/approvalsUi'
import { Chip, Panel, H2, Btn, Tick, Notice, font } from '../ui'
import { WhySection } from '../GenericBody'

const KIND_LABEL = { amazon_ads: 'Amazon ads pack', paid_media: 'Paid media pack', replies: 'Replies pack', outreach: 'Outreach pack', listings: 'Listings pack' }
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v)
const show = (v) => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const detailText = (d) => (d == null ? '' : typeof d === 'string' ? d : isObj(d) ? (d.where || d.text || d.note || Object.values(d).filter(x => typeof x === 'string').join(' · ')) : String(d))
const yes = (v) => ['approved', 'edited', 'edit', 'push'].includes(v)
const LINE_OUTCOME = { approved: 'Approved', edited: 'Approved, edited', edit: 'Approved, edited', push: 'Approved', rejected: 'Sent back', keep: 'Kept as is' }

function totalsText(t) {
  const parts = Object.entries(t).map(([cur, amt]) => `${cur === 'GBP' ? 'UK ' : cur === 'USD' ? 'US ' : ''}${money(amt, cur)}`)
  return parts.length ? `${parts.join(' · ')} a week` : null
}

function LimitChip({ line }) {
  if (line.limit == null || line.limit === '') return null
  const tone = TONES[line.limit_tone] ? line.limit_tone : 'grey'
  return <Chip tone={tone}>{show(line.limit)}</Chip>
}

export default function PackReview({ task, artefact, isMobile, readOnly, lines, setLines, onApprove, deciding }) {
  const a = isObj(artefact) ? artefact : {}
  const groups = useMemo(() => (Array.isArray(a.groups) ? a.groups.filter(g => g && Array.isArray(g.lines)) : []), [a.groups])
  const all = useMemo(() => groups.flatMap(g => g.lines.filter(l => l && l.id)), [groups])
  const replies = a.pack_kind === 'replies'
  const [editing, setEditing] = useState(null)
  const decided = task.line_decisions || {}

  // Every line starts ticked; unticked lines go back to the agent.
  useEffect(() => {
    if (readOnly || !setLines) return
    if (Object.keys(lines || {}).length) return
    setLines(Object.fromEntries(all.map(l => [l.id, 'approved'])))
  }, [readOnly, all]) // eslint-disable-line react-hooks/exhaustive-deps

  const cur = readOnly ? decided : (lines || {})
  const isOn = (id) => (readOnly ? yes(decided[id]) || decided[id] == null : yes(cur[id]))
  const setLine = (id, v) => setLines(prev => {
    const next = { ...prev, [id]: v }
    if (v !== 'edited') delete next[`${id}:edit`]
    return next
  })
  const setAll = (ids, on) => setLines(prev => {
    const next = { ...prev }
    for (const id of ids) {
      if (on) next[id] = next[`${id}:edit`] != null ? 'edited' : 'approved'
      else { next[id] = 'rejected' }
    }
    return next
  })
  const editValue = (l) => (cur[`${l.id}:edit`] != null ? cur[`${l.id}:edit`] : show(l.after))
  const setEdit = (l, v) => setLines(prev => ({ ...prev, [l.id]: v === show(l.after) ? 'approved' : 'edited', [`${l.id}:edit`]: v === show(l.after) ? undefined : v }))

  const t = readOnly ? lineTally(decided) : lineTally(cur)
  const total = all.length
  const ticked = readOnly && !task.decision ? total : t.yes
  const totals = packTotals(a, readOnly ? decided : cur)
  const showTotals = a.currency_totals || Object.keys(totals).length > 0
  const tt = totalsText(totals)
  const approveLabel = replies
    ? (ticked === total ? `Send all ${total} replies` : `Send ${ticked}, skip ${total - ticked}`)
    : (ticked === total ? `Approve all ${total}` : `Approve ${ticked}, send back ${total - ticked}`)
  let n = 0

  const summary = (
    <Panel style={{ padding: '14px 18px', display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', border: `2px solid ${C.indigo}` }}>
      <div style={{ flex: '1 1 300px' }}>
        <p style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>{readOnly && task.decision ? `${t.yes} of ${total} went ahead` : `${ticked} of ${total} ${replies ? 'to send' : 'ticked'}`}</p>
        <p style={{ margin: '2px 0 0', fontSize: 14, color: C.muted }}>
          {replies ? 'Approved replies send straight away. Skipped ones get no reply and are noted.' : 'Every line has its own reason and limit check. Ticked lines run once; unticked lines go back to the agent.'}
        </p>
      </div>
      {showTotals && tt && (
        <div>
          <Chip tone="muted" style={{ marginBottom: 4 }}>{readOnly ? 'Weekly spend change' : 'Spend if ticked lines run'}</Chip>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{tt}</p>
        </div>
      )}
      {!readOnly && (
        <>
          <Btn onClick={() => setAll(all.map(l => l.id), ticked !== total)}>{ticked === total ? (replies ? 'Skip all' : 'Untick all') : 'Tick all'}</Btn>
          {onApprove && !isMobile && <Btn kind="primary" onClick={onApprove} disabled={deciding || !ticked}>{deciding ? 'Saving…' : approveLabel}</Btn>}
        </>
      )}
    </Panel>
  )

  const statusChip = (id) => {
    const v = decided[id]
    if (!v) return null
    return <Chip tone={yes(v) ? 'ok' : 'warn'}>{LINE_OUTCOME[v] || v}</Chip>
  }

  const extras = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
      {a.expected_effect && <Panel style={{ flex: '1 1 300px', padding: '16px 18px' }}><H2 style={{ fontSize: 16, marginBottom: 6 }}>Expected effect, whole pack</H2><p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>{a.expected_effect}</p></Panel>}
      {a.undo && <Panel style={{ flex: '1 1 300px', padding: '16px 18px' }}><H2 style={{ fontSize: 16, marginBottom: 6 }}>Undo</H2><p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>{a.undo}</p></Panel>}
      {Array.isArray(a.checks) && a.checks.length > 0 && (
        <Panel style={{ flex: '1 1 300px', padding: '16px 18px' }}>
          <H2 style={{ fontSize: 16, marginBottom: 6 }}>{a.checks.every(c => c.result === 'pass') ? 'Checks passed' : 'Checks'}</H2>
          {a.checks.filter(c => c && c.text).map((c, i) => <Tick key={i} result={c.result}>{c.text}</Tick>)}
        </Panel>
      )}
    </div>
  )

  if (!groups.length) return <Notice tone="warn">This pack has no lines.</Notice>

  // ── phone ──
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontFamily: font }}>
        <p style={{ margin: 0, fontSize: 13, color: C.muted }}>{KIND_LABEL[a.pack_kind] || 'Pack'} · each line has its own reason and limit.{readOnly ? '' : ' Tap a line to untick it.'}</p>
        {groups.map((g, gi) => {
          const on = g.lines.filter(l => isOn(l.id)).length
          return (
            <div key={gi} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h2 style={{ margin: '8px 0 0', fontSize: 13, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted }}>{g.name} · {on} of {g.lines.length}</h2>
              {g.lines.map(l => {
                const on1 = isOn(l.id)
                const inner = (
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <b style={{ display: 'block', fontSize: 14 }}>{l.target || l.id}</b>
                    {detailText(l.detail) && <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{detailText(l.detail)}</span>}
                    {replies ? (
                      <>
                        <span style={{ display: 'block', fontSize: 13, color: C.soft, marginTop: 4 }}>“{show(l.before)}”</span>
                        {editing === l.id && !readOnly ? (
                          <textarea rows={3} aria-label="Edit reply" value={editValue(l)} onChange={e => setEdit(l, e.target.value)} onClick={e => e.preventDefault()}
                            style={{ width: '100%', marginTop: 6, font: `600 14px ${font}`, border: `2px solid ${C.indigo}`, borderRadius: 10, padding: '8px 10px', boxSizing: 'border-box' }} />
                        ) : <span style={{ display: 'block', fontSize: 14, marginTop: 6, background: C.bg, borderRadius: 10, padding: '8px 10px' }}>{editValue(l)}</span>}
                      </>
                    ) : (
                      <span style={{ display: 'block', fontSize: 14, marginTop: 2 }}>
                        <span style={{ color: C.muted, textDecoration: 'line-through' }}>{show(l.before)}</span> → <span style={{ background: C.mark, fontWeight: 800, padding: '1px 6px', borderRadius: 4 }}>{editValue(l)}</span>
                        <span style={{ marginLeft: 4 }}><LimitChip line={l} /></span>
                      </span>
                    )}
                    {l.why && <span style={{ display: 'block', fontSize: 13, color: C.soft, marginTop: 4, lineHeight: 1.4 }}>{l.why}</span>}
                    {readOnly && statusChip(l.id) && <span style={{ display: 'block', marginTop: 6 }}>{statusChip(l.id)}</span>}
                    {replies && !readOnly && (
                      <span style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <Btn small kind={cur[l.id] === 'approved' ? 'primary' : undefined} onClick={() => { setEditing(null); setLine(l.id, 'approved') }}>Approve</Btn>
                        <Btn small kind={editing === l.id || cur[l.id] === 'edited' ? 'primary' : undefined} onClick={() => setEditing(editing === l.id ? null : l.id)}>Edit</Btn>
                        <Btn small kind={cur[l.id] === 'rejected' ? 'primary' : undefined} onClick={() => { setEditing(null); setLine(l.id, 'rejected') }}>Skip</Btn>
                      </span>
                    )}
                  </span>
                )
                const box = { display: 'flex', gap: 12, alignItems: 'flex-start', background: on1 ? '#fff' : '#FAFAFC', border: `1px solid ${on1 ? C.line : C.line2}`, borderRadius: 14, padding: 14, opacity: on1 ? 1 : 0.7 }
                if (replies || readOnly) return <div key={l.id} style={box}>{inner}</div>
                return (
                  <label key={l.id} style={{ ...box, cursor: 'pointer' }}>
                    <input type="checkbox" checked={on1} onChange={() => setLine(l.id, on1 ? 'rejected' : 'approved')} aria-label={`Run: ${l.target || l.id}`} style={{ width: 22, height: 22, accentColor: C.indigo, flex: 'none', marginTop: 2 }} />
                    {inner}
                  </label>
                )
              })}
            </div>
          )
        })}
        <Panel style={{ padding: '12px 14px' }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>{ticked} of {total} {readOnly ? 'went ahead' : replies ? 'to send' : 'ticked'}{tt ? ` · ${tt}` : ''}</p>
          {!readOnly && <Btn style={{ marginTop: 8, width: '100%' }} onClick={() => setAll(all.map(l => l.id), ticked !== total)}>{ticked === total ? (replies ? 'Skip all' : 'Untick all') : 'Tick all'}</Btn>}
        </Panel>
        <WhySection artefact={a} />
        {extras}
      </div>
    )
  }

  // ── desktop ──
  const cols = replies ? '170px minmax(0,1fr) minmax(0,1.3fr) 120px 230px' : '52px minmax(0,1.25fr) 190px minmax(0,1.5fr) 150px 120px'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontFamily: font }}>
      {summary}
      <Panel style={{ padding: 0, overflowX: 'auto' }}>
        <div style={{ minWidth: replies ? 1000 : 1060 }}>
          <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 14, padding: '10px 16px', fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted }}>
            {replies ? <><span>Where and when</span><span>They said</span><span>Our reply (edit in place)</span><span>Category</span><span>Decision</span></>
              : <><span>Run</span><span>Change</span><span>Before → after</span><span>Why (and the data it’s based on)</span><span>Limit</span><span /></>}
          </div>
          {groups.map((g, gi) => {
            const ids = g.lines.map(l => l.id)
            const on = g.lines.filter(l => isOn(l.id)).length
            return (
              <div key={gi}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: C.bg, borderTop: `1px solid ${C.line2}` }}>
                  {readOnly || replies ? <b style={{ fontSize: 15 }}>{g.name}</b> : (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 36, cursor: 'pointer' }}>
                      <input type="checkbox" checked={on === ids.length} onChange={() => setAll(ids, on !== ids.length)} style={{ width: 20, height: 20, accentColor: C.indigo }} />
                      <b style={{ fontSize: 15 }}>{g.name}</b>
                    </label>
                  )}
                  <Chip tone="muted">{on} of {ids.length}</Chip>
                  {g.note && <span style={{ fontSize: 13, color: C.muted }}>{g.note}</span>}
                </div>
                {g.lines.map(l => {
                  n += 1
                  const on1 = isOn(l.id)
                  const ed = editing === l.id && !readOnly
                  if (replies) return (
                    <div key={l.id} style={{ display: 'grid', gridTemplateColumns: cols, gap: 14, padding: '14px 16px', borderTop: `1px solid ${C.line2}`, alignItems: 'start', opacity: on1 ? 1 : 0.55 }}>
                      <span style={{ fontSize: 13, fontWeight: 800 }}>{l.target || l.id}<span style={{ display: 'block', fontWeight: 600, color: C.muted }}>{detailText(l.detail)}</span></span>
                      <span style={{ fontSize: 14, lineHeight: 1.45, color: C.soft }}>“{show(l.before)}”</span>
                      <span>
                        {ed ? (
                          <>
                            <textarea rows={3} aria-label="Edit reply" value={editValue(l)} onChange={e => setEdit(l, e.target.value)}
                              style={{ width: '100%', boxSizing: 'border-box', font: `600 14px ${font}`, border: `2px solid ${C.indigo}`, borderRadius: 10, padding: '8px 10px', resize: 'vertical' }} />
                            <span style={{ display: 'block', fontSize: 12, color: C.muted, fontWeight: 700, marginTop: 4 }}>Your edit is re-checked by the Brand checker before it sends.</span>
                          </>
                        ) : (
                          <>
                            <span style={{ display: 'block', fontSize: 14, lineHeight: 1.45, background: C.bg, borderRadius: 10, padding: '8px 10px' }}>{editValue(l)}</span>
                            {l.why && <span style={{ display: 'block', fontSize: 12, color: C.muted, fontWeight: 700, marginTop: 4 }}>{l.why}</span>}
                          </>
                        )}
                      </span>
                      <span><LimitChip line={l} /></span>
                      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {readOnly ? statusChip(l.id) : (
                          <>
                            <Btn small aria-pressed={cur[l.id] === 'approved'} kind={cur[l.id] === 'approved' ? 'primary' : undefined} onClick={() => { setEditing(null); setLine(l.id, 'approved') }}>Approve</Btn>
                            <Btn small aria-pressed={ed || cur[l.id] === 'edited'} kind={ed || cur[l.id] === 'edited' ? 'primary' : undefined} onClick={() => setEditing(ed ? null : l.id)}>Edit</Btn>
                            <Btn small aria-pressed={cur[l.id] === 'rejected'} kind={cur[l.id] === 'rejected' ? 'primary' : undefined} onClick={() => { setEditing(null); setLine(l.id, 'rejected') }}>Skip</Btn>
                          </>
                        )}
                      </span>
                    </div>
                  )
                  return (
                    <div key={l.id} style={{ padding: '12px 16px', borderTop: `1px solid ${C.line2}`, background: on1 ? '#fff' : '#FAFAFC' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 14, alignItems: 'start' }}>
                        <span style={{ display: 'flex', minHeight: 44, alignItems: 'flex-start', paddingTop: 2 }}>
                          {readOnly ? <span style={{ fontWeight: 800, color: on1 ? '#1E6B3A' : C.faint }}>{on1 ? '✓' : '–'}</span>
                            : <input type="checkbox" checked={on1} onChange={() => setLine(l.id, on1 ? 'rejected' : (cur[`${l.id}:edit`] != null ? 'edited' : 'approved'))} aria-label={`Run line ${n}`} style={{ width: 22, height: 22, accentColor: C.indigo }} />}
                        </span>
                        <span style={{ color: on1 ? C.ink : C.faint }}>
                          <b style={{ fontSize: 14, display: 'block' }}>{n}. {l.target || l.id}</b>
                          {detailText(l.detail) && <span style={{ fontSize: 13, color: C.muted }}>{detailText(l.detail)}</span>}
                        </span>
                        <span style={{ fontSize: 14, lineHeight: 1.6 }}>
                          <span style={{ color: C.muted, textDecoration: 'line-through' }}>{show(l.before)}</span> →{' '}
                          {ed ? <input value={editValue(l)} onChange={e => setEdit(l, e.target.value)} aria-label={`New value for line ${n}`} style={{ font: `700 14px ${font}`, color: C.ink, border: `1px solid ${C.border}`, borderRadius: 8, padding: '0 10px', minHeight: 36, width: 90 }} />
                            : <span style={{ background: C.mark, fontWeight: 800, padding: '1px 6px', borderRadius: 4 }}>{editValue(l)}</span>}
                          {l.weekly_delta && typeof l.weekly_delta.amount === 'number' && (
                            <span style={{ display: 'block', fontSize: 12, color: C.muted, fontWeight: 700 }}>{money(l.weekly_delta.amount, l.weekly_delta.currency)} a week</span>
                          )}
                          {cur[`${l.id}:edit`] != null && !ed && <span style={{ display: 'block', fontSize: 12, color: C.indigo, fontWeight: 800 }}>Edited (was {show(l.after)})</span>}
                        </span>
                        <span style={{ fontSize: 13, lineHeight: 1.45 }}>{l.why || ''}</span>
                        <span><LimitChip line={l} /></span>
                        <span>{readOnly ? statusChip(l.id) : <Btn small onClick={() => setEditing(ed ? null : l.id)}>{ed ? 'Done' : 'Edit'}</Btn>}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </Panel>
      <WhySection artefact={a} />
      {extras}
      {readOnly && task.decision && <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Outcome: {outcomeChip(task.decision)?.label}</p>}
    </div>
  )
}
