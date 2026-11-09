// Amazon listing change (artefact_type listing_change; boards ListingDiff / ListingDiffPhone).
// Field cards live vs should with an action per differing field (lines[field] = push | keep | edit, the
// edit text in lines['<field>:edit']), only-differs toggle, image comparison, checks, keywords, history.
// The field table and image comparison are also used read-only by ListingsView.
import { useEffect, useState } from 'react'
import { C, Panel, H2, Note, Pill, Tick, inputStyle, selectStyle, Checks, Steps, WhyBlock, Fold, Cols, text, fmtDay } from './reviewKit'

export const FIELD_STATUS = {
  match: { label: 'Matches', bg: C.okBg, fg: C.ok, sym: '✓' },
  drift: { label: 'Amazon changed it', bg: C.warnBg, fg: C.warn, sym: '≠' },
  proposed: { label: 'We propose a change', bg: C.soft, fg: C.indigo, sym: '+' },
  in_flight: { label: 'On its way', bg: C.blueBg, fg: C.blue, sym: '→' },
  problem: { label: 'Missing or blocked', bg: C.badBg, fg: C.bad, sym: '!' },
  na: { label: 'Not used', bg: C.grey, fg: C.muted, sym: '–' },
}
export const differs = (status) => status && status !== 'match' && status !== 'na'

export function StatusChip({ status, style }) {
  const s = FIELD_STATUS[status] || { label: status || 'Unknown', bg: C.grey, fg: C.muted }
  return <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 800, borderRadius: 999, padding: '3px 10px', background: s.bg, color: s.fg, ...style }}>{s.label}</span>
}

/** A field value as words: images arrays summarise, objects flatten. */
export function valueText(v, field) {
  if (v == null || v === '') return '–'
  if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
    if (field === 'Images' || v[0].slot != null) return `${v.length} image${v.length === 1 ? '' : 's'}: ${v.map(x => [x.slot, x.label].filter(Boolean).join(' ')).join(' · ')}`
  }
  return text(v)
}

const ACTIONS = [
  { value: 'push', label: 'Send should-be-live to Amazon', short: 'Send should-be-live to Amazon' },
  { value: 'keep', label: 'Keep Amazon’s version as the new should-be-live', short: 'Keep Amazon’s version' },
  { value: 'edit', label: 'Edit before sending', short: 'Edit before sending' },
]

function ActionPicker({ f, lines, setLines, readOnly, isMobile }) {
  const val = lines[f.field] || ''
  const editKey = `${f.field}:edit`
  const set = (v) => {
    if (readOnly || !setLines) return
    const next = { ...lines, [f.field]: v }
    if (v === 'edit' && typeof next[editKey] !== 'string') next[editKey] = typeof f.should === 'string' ? f.should : valueText(f.should, f.field)
    if (v !== 'edit') delete next[editKey]
    setLines(next)
  }
  return (
    <div style={{ marginTop: 6 }}>
      <select aria-label={`Action for ${f.field}`} style={selectStyle} value={val} disabled={readOnly} onChange={e => set(e.target.value)}>
        {!val ? <option value="" disabled>Choose what to do</option> : null}
        {ACTIONS.map(a => <option key={a.value} value={a.value}>{isMobile ? a.short : a.label}</option>)}
      </select>
      {val === 'edit' ? (
        <textarea aria-label={`Your version of ${f.field}`} rows={3} style={{ ...inputStyle, marginTop: 6, fontSize: 13 }} readOnly={readOnly}
          value={typeof lines[editKey] === 'string' ? lines[editKey] : ''} onChange={e => setLines && setLines({ ...lines, [editKey]: e.target.value })} />
      ) : null}
    </div>
  )
}

const meta = (m) => (m ? <span style={{ display: 'block', fontSize: 12, color: C.muted, fontWeight: 600, marginTop: 4 }}>{m}</span> : null)

/** Desktop: Field | Live | Should | What to do. Phone: one card per field. actions=false → read-only. */
export function FieldTable({ fields, isMobile, actions, lines = {}, setLines, readOnly }) {
  if (!fields.length) return <Note>No fields to show.</Note>
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {fields.map(f => {
          const d = differs(f.status)
          return (
            <div key={f.field} style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}><span style={{ fontWeight: 800, fontSize: 15 }}>{f.field}</span><StatusChip status={f.status} /></div>
              {d ? (<>
                <p style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: C.muted, margin: '10px 0 4px' }}>Live on Amazon now</p>
                <div style={{ background: '#FFF4E5', borderRadius: 8, padding: '8px 10px', fontSize: 14, lineHeight: 1.45, wordBreak: 'break-word' }}>{valueText(f.live, f.field)}{meta(f.live_meta)}</div>
                <p style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: C.muted, margin: '10px 0 4px' }}>Should be live</p>
                <div style={{ background: '#F1ECFB', borderRadius: 8, padding: '8px 10px', fontSize: 14, lineHeight: 1.45, fontWeight: 700, wordBreak: 'break-word' }}>{valueText(f.should, f.field)}{meta(f.should_meta)}</div>
                {actions ? <ActionPicker f={f} lines={lines} setLines={setLines} readOnly={readOnly} isMobile /> : f.note ? <p style={{ margin: '8px 0 0', fontSize: 13, color: C.muted }}>{f.note}</p> : null}
              </>) : <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.45, wordBreak: 'break-word' }}>{valueText(f.live, f.field)}</p>}
            </div>
          )
        })}
      </div>
    )
  }
  const cell = { padding: 12, borderTop: `1px solid ${C.line2}`, fontSize: 14, lineHeight: 1.5, wordBreak: 'break-word' }
  const hd = { ...cell, borderTop: 0, background: C.bg, fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted }
  return (
    <div className="scroll-x">
      <div style={{ display: 'grid', gridTemplateColumns: '150px minmax(260px,1fr) minmax(260px,1fr) 210px', minWidth: 1000 }}>
        <div style={hd}>Field</div><div style={hd}>Live on Amazon now</div><div style={hd}>Should be live</div><div style={hd}>{actions ? 'What to do' : 'State'}</div>
        {fields.map(f => {
          const d = differs(f.status)
          return [
            <div key={`${f.field}-n`} style={{ ...cell, fontWeight: 800 }}>{f.field}{meta(f.limit_text)}</div>,
            <div key={`${f.field}-l`} style={{ ...cell, background: d ? '#FFF4E5' : 'transparent' }}>{valueText(f.live, f.field)}{meta(f.live_meta)}</div>,
            <div key={`${f.field}-s`} style={{ ...cell, background: d ? '#F1ECFB' : 'transparent', fontWeight: d ? 700 : 400 }}>{valueText(f.should, f.field)}{meta(f.should_meta)}</div>,
            <div key={`${f.field}-a`} style={cell}>
              <StatusChip status={f.status} style={{ marginBottom: 6 }} />
              {actions && d ? <ActionPicker f={f} lines={lines} setLines={setLines} readOnly={readOnly} /> : f.note ? <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{f.note}</span> : null}
            </div>,
          ]
        })}
      </div>
    </div>
  )
}

/** Two rows of image slots, differences outlined, missing slots red. */
export function ImageCompare({ live = [], should = [], isMobile, sourceNote }) {
  const L = (live || []).filter(Boolean), S = (should || []).filter(Boolean)
  if (!L.length && !S.length) return <Note>No images reported.</Note>
  const slots = [...new Set([...L, ...S].map((x, i) => String(x.slot != null ? x.slot : i + 1)))].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
  const bySlot = (arr) => Object.fromEntries(arr.map((x, i) => [String(x.slot != null ? x.slot : i + 1), x]))
  const l = bySlot(L), s = bySlot(S)
  const same = (a, b) => a && b && (a.url && b.url ? a.url === b.url : a.label === b.label)
  const tile = (x, slot, other) => {
    const base = { height: isMobile ? 40 : 58, borderRadius: 6, fontSize: 10, fontWeight: 800, display: 'flex', boxSizing: 'border-box', padding: isMobile ? '2px 3px' : 4, overflow: 'hidden', position: 'relative' }
    if (!x) return <div key={slot} style={{ ...base, background: C.badBg, color: C.bad, alignItems: 'center', justifyContent: 'center' }}>Missing</div>
    const diff = !same(x, other)
    return (
      <div key={slot} title={[x.label, x.px ? `${x.px}px` : ''].filter(Boolean).join(' · ')} style={{ ...base, alignItems: 'flex-end', color: C.muted, background: 'repeating-linear-gradient(135deg,#ECE8F4 0 8px,#F4F1F9 8px 16px)', outline: diff ? '2px solid #D98A1F' : 'none' }}>
        {x.url ? <img src={x.url} alt={x.label || `Image ${slot}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
        <span style={{ position: 'relative', background: x.url ? 'rgba(255,255,255,.85)' : 'transparent', borderRadius: 3, padding: x.url ? '0 3px' : 0 }}>{isMobile ? slot : `${slot} ${x.label || ''}`}</span>
      </div>
    )
  }
  const row = (map, other) => <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(slots.length, 7)}, minmax(0, 1fr))`, gap: isMobile ? 4 : 6, marginTop: 6 }}>{slots.map(k => tile(map[k], k, other[k]))}</div>
  const lbl = { fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted, margin: 0 }
  return (
    <div>
      <p style={lbl}>Live on Amazon now</p>
      {row(l, s)}
      <p style={{ ...lbl, marginTop: 14 }}>Should be live{sourceNote ? ` (${sourceNote})` : ''}</p>
      {row(s, l)}
    </div>
  )
}

export function KeywordTable({ keywords }) {
  const list = (keywords || []).filter(Boolean)
  if (!list.length) return <Note>No search words listed.</Note>
  const row = { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 90px 90px', gap: 8, fontSize: 13, padding: '6px 0', borderTop: '1px solid #F1EEF6' }
  return (
    <div>
      <div style={{ ...row, borderTop: 0, fontWeight: 800, color: C.muted }}><span>Search term</span><span>Live</span><span>Should be</span></div>
      {list.map((k, i) => <div key={i} style={row}><span>{k.term}</span><span>{text(k.live) || '–'}</span><span>{text(k.should) || '–'}</span></div>)}
    </div>
  )
}

export function History({ items }) {
  const list = (items || []).filter(Boolean)
  if (!list.length) return <Note>No history yet.</Note>
  return (
    <div>
      {list.map((h, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, padding: '8px 0', borderTop: i ? '1px solid #F1EEF6' : 0, fontSize: 13, lineHeight: 1.45 }}>
          <span style={{ flex: 'none', width: 80, color: C.muted, fontWeight: 700 }}>{/^\d{4}-\d{2}-\d{2}/.test(h.at || '') ? fmtDay(h.at, { day: 'numeric', month: 'short' }) : h.at}</span>
          <span>{h.text}</span>
        </div>
      ))}
    </div>
  )
}

export default function ListingChangeReview({ task, artefact, isMobile, readOnly, lines = {}, setLines }) {
  const a = artefact || {}
  const fields = (a.fields || []).filter(f => f && f.field)
  const [onlyDiff, setOnlyDiff] = useState(true)
  const diffFields = fields.filter(f => differs(f.status))

  // The boards' default for a differing field is "send should-be-live": record it so the decision says so.
  useEffect(() => {
    if (readOnly || !setLines) return
    const missing = diffFields.filter(f => !lines[f.field])
    if (missing.length) setLines({ ...Object.fromEntries(missing.map(f => [f.field, 'push'])), ...lines })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task && task.id, readOnly])

  const shown = onlyDiff ? diffFields : fields
  const pushN = diffFields.filter(f => (lines[f.field] || 'push') === 'push' || lines[f.field] === 'edit').length
  const keepN = diffFields.filter(f => lines[f.field] === 'keep').length
  const images = a.images || {}
  const imgs = (images.live || []).length || (images.should || []).length
  const afterYes = (a.after_yes || []).filter(Boolean)
  const summary = diffFields.length
    ? `${pushN} field${pushN === 1 ? '' : 's'} to send to Amazon${a.marketplace ? ` ${a.marketplace}` : ''}${keepN ? `, ${keepN} to keep as Amazon has it` : ''}. Nothing is sent until the card is approved.`
    : 'Every field matches.'

  const filter = isMobile
    ? <Tick checked={onlyDiff} onChange={setOnlyDiff}>Only fields that differ</Tick>
    : (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="group" aria-label="Show">
        <Pill on={!onlyDiff} onClick={() => setOnlyDiff(false)} style={{ minHeight: 40 }}>Every field</Pill>
        <Pill on={onlyDiff} onClick={() => setOnlyDiff(true)} style={{ minHeight: 40 }}>Only what differs</Pill>
      </div>
    )
  const tiles = [
    ['Listing', [a.product, a.marketplace && `Amazon ${a.marketplace}`].filter(Boolean).join(' · ') || '–', C.ink],
    ['Fields that differ', `${diffFields.length} of ${fields.length}`, diffFields.length ? C.warn : C.ok],
    ['ASIN · SKU', [a.asin, a.sku].filter(Boolean).join(' · ') || '–', C.ink],
  ]

  const tilesRow = (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))', gap: isMobile ? 8 : 12 }}>
      {tiles.slice(0, isMobile ? 2 : 3).map(([k, v, col]) => (
        <div key={k} style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: isMobile ? '10px 12px' : '12px 16px', minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted }}>{k}</p>
          <p style={{ margin: '4px 0 0', fontSize: isMobile ? 15 : 18, fontWeight: 800, color: col, wordBreak: 'break-word' }}>{v}</p>
        </div>
      ))}
    </div>
  )

  const imagePanel = imgs ? (
    <Panel pad={isMobile ? '14px' : undefined} style={{ marginTop: isMobile ? 0 : 20 }}>
      <H2>Images</H2>
      <ImageCompare live={images.live} should={images.should} isMobile={isMobile} />
    </Panel>
  ) : null

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {tilesRow}
        {filter}
        <FieldTable fields={shown} isMobile actions lines={lines} setLines={setLines} readOnly={readOnly} />
        {imagePanel}
        <Fold title="Checks on the should-be-live copy"><Checks checks={a.checks} /></Fold>
        {(a.keywords || []).length ? <Fold title="Search words it should win"><KeywordTable keywords={a.keywords} /></Fold> : null}
        {(a.history || []).length ? <Fold title="History"><History items={a.history} /></Fold> : null}
        {a.why ? <Fold title="Why"><WhyBlock why={a.why} evidence={a.evidence} expected={a.expected_effect} undo={a.undo} /></Fold> : null}
        <Panel pad="14px"><p style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>{summary}</p></Panel>
      </div>
    )
  }

  return (
    <div>
      {tilesRow}
      <div style={{ marginTop: 16 }}>{filter}</div>
      <Panel pad="0" style={{ marginTop: 12, overflow: 'hidden' }}>
        <FieldTable fields={shown} actions lines={lines} setLines={setLines} readOnly={readOnly} />
      </Panel>
      {imagePanel}
      <Cols style={{ marginTop: 20 }}>
        <Panel style={{ flex: '1 1 340px' }}><H2>Checks on the should-be-live copy</H2><Checks checks={a.checks} /></Panel>
        <Panel style={{ flex: '1 1 340px' }}><H2>Search words the listing should win</H2><KeywordTable keywords={a.keywords} /></Panel>
        <Panel style={{ flex: '1 1 300px' }}><H2>History</H2><History items={a.history} /></Panel>
      </Cols>
      {a.why || afterYes.length ? (
        <Cols style={{ marginTop: 20 }}>
          {a.why ? <Panel style={{ flex: '1 1 420px' }}><H2>Why</H2><WhyBlock why={a.why} evidence={a.evidence} expected={a.expected_effect} undo={a.undo} /></Panel> : null}
          {afterYes.length ? <Panel style={{ flex: '1 1 420px' }}><H2>After you say yes</H2><Steps items={afterYes} /></Panel> : null}
        </Cols>
      ) : null}
      <Panel style={{ marginTop: 20 }}>
        <H2>Your answer</H2>
        <p style={{ margin: 0, fontSize: 14, color: C.body }}>Each differing field uses the action you picked above. {summary}</p>
      </Panel>
    </div>
  )
}
