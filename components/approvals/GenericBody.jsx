// The generic approval body (boards Card, CardPhone): live preview where there is one, what changes (before/after),
// why with the evidence source, expected effect and undo, checks, after-yes and history. Serves every type without a
// rich renderer: copy, document, design, deploy_plan, pr_link and anything unknown.
import { ARTEFACT_TYPES } from '../../lib/artefactTypes'
import { C, fmtWhen, trail } from '../../lib/approvalsUi'
import { Panel, H2, Tick, Placeholder, Chip } from './ui'

const COMMON_KEYS = ['checks', 'why', 'evidence', 'expected_effect', 'undo', 'after_yes', 'changes', 'where']
const IMG = /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v)

function safeUrl(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null
}

/** Where the preview comes from: the staging URL, or a url/image field on the artefact. */
export function previewOf(task) {
  const a = isObj(task.artefact) ? task.artefact : {}
  const img = [a.image_url, a.thumb_url, a.preview_image, a.url].map(safeUrl).find(u => u && IMG.test(u))
  const link = safeUrl(task.staging_url) || safeUrl(a.preview_url) || safeUrl(a.url) || safeUrl(a.html_url)
  if (!img && !link) return null
  return { img, link }
}

/** The fields an approver may edit before approving (generic types): top-level text, lists of text, change "after" values. */
export function editableFields(task) {
  const a = isObj(task.artefact) ? task.artefact : {}
  const def = ARTEFACT_TYPES[task.artefact_type]
  const out = []
  if (Array.isArray(a.changes)) {
    a.changes.forEach((ch, i) => {
      if (isObj(ch) && typeof ch.after === 'string') out.push({ id: `changes.${i}`, label: ch.field || `Change ${i + 1}`, value: ch.after, rows: ch.after.length > 90 ? 3 : 2 })
    })
    // The before/after list is what the approver is asked about, so it is what they edit.
    if (out.length) return out
  }
  for (const f of def ? def.fields : []) {
    if (COMMON_KEYS.includes(f.key) || f.render === 'link' || f.render === 'code' || f.render === 'badge') continue
    const v = a[f.key]
    if (f.type === 'string' && typeof v === 'string' && v) out.push({ id: f.key, label: f.label || f.key, value: v, rows: v.length > 120 ? 4 : v.length > 60 ? 2 : 1 })
    if (f.type === 'array' && Array.isArray(v) && v.every(x => typeof x === 'string')) {
      v.forEach((s, i) => out.push({ id: `${f.key}.${i}`, label: `${(f.label || f.key).replace(/s$/, '')} ${i + 1}`, value: s, rows: s.length > 90 ? 3 : 2 }))
    }
  }
  return out
}

/** Turns { "<id>": text } from the edit form into decision_edits keyed as the artefact is. Only changed values. */
export function buildEdits(task, values) {
  const a = isObj(task.artefact) ? task.artefact : {}
  const out = {}
  for (const f of editableFields(task)) {
    const v = values[f.id]
    if (v == null || v === f.value) continue
    const [key, idx] = f.id.split('.')
    if (idx == null) { out[key] = v; continue }
    if (key === 'changes') {
      out.changes = out.changes || a.changes.map(ch => (isObj(ch) ? { field: ch.field, after: ch.after } : ch))
      out.changes[Number(idx)] = { ...out.changes[Number(idx)], after: v }
    } else {
      out[key] = out[key] || [...a[key]]
      out[key][Number(idx)] = v
    }
  }
  return out
}

export function GenericPreview({ task, isMobile }) {
  const p = previewOf(task)
  if (!p) return null
  const host = (() => { try { return new URL(p.link || p.img).host } catch { return '' } })()
  return (
    <Panel style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
        <H2 style={{ margin: 0 }}>Live preview</H2>
        {host && <span style={{ fontSize: 13, color: C.muted, fontWeight: 700 }}>{host}</span>}
      </div>
      {p.img ? (
        <img src={p.img} alt={`Preview of ${task.title}`} style={{ width: '100%', borderRadius: 10, border: `1px solid ${C.line}`, display: 'block' }} />
      ) : (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ background: C.grey, padding: '8px 12px', fontSize: 12, fontWeight: 700, color: C.soft, display: 'flex', gap: 8, alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            <span style={{ display: 'inline-flex', gap: 4 }}>{[0, 1, 2].map(i => <span key={i} style={{ width: 9, height: 9, borderRadius: '50%', background: C.border }} />)}</span>
            {p.link}
          </div>
          <Placeholder height={isMobile ? 120 : 200} style={{ borderRadius: 0 }}>Preview opens in a new tab</Placeholder>
        </div>
      )}
      {p.link && (
        <a href={p.link} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', minHeight: 44, alignItems: 'center', fontSize: 14, fontWeight: 800, color: C.indigo }}>
          Open the preview in a new tab ›
        </a>
      )}
    </Panel>
  )
}

function Value({ v, render }) {
  if (v == null || v === '') return <span style={{ color: C.muted }}>—</span>
  if (Array.isArray(v)) {
    if (v.every(x => typeof x !== 'object')) return <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>{v.map((x, i) => <li key={i} style={{ marginBottom: 2 }}>{String(x)}</li>)}</ul>
    return <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(v, null, 2)}</pre>
  }
  if (isObj(v)) return <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(v, null, 2)}</pre>
  const s = String(v)
  if (render === 'link' && safeUrl(s)) return <a href={s} target="_blank" rel="noreferrer" style={{ color: C.indigo, fontWeight: 700, wordBreak: 'break-all' }}>{s}</a>
  if (render === 'code') return <code style={{ background: C.grey, borderRadius: 4, padding: '1px 6px', fontSize: 13 }}>{s}</code>
  if (render === 'badge') return <Chip tone={s === 'high' ? 'bad' : s === 'medium' ? 'warn' : undefined}>{s}</Chip>
  return <span style={{ whiteSpace: 'pre-wrap' }}>{s}</span>
}

function WhatChanges({ task, isMobile, edits }) {
  const a = isObj(task.artefact) ? task.artefact : {}
  if (Array.isArray(a.changes) && a.changes.length) {
    const edited = edits && Array.isArray(edits.changes) ? edits.changes : null
    if (isMobile) return (
      <Panel>
        <H2>What changes</H2>
        {a.changes.map((ch, i) => (
          <p key={i} style={{ margin: i ? '8px 0 0' : 0, fontSize: 13, lineHeight: 1.45 }}>
            <b>{ch.field}</b><br />
            <span style={{ color: C.muted, textDecoration: 'line-through', textDecorationColor: '#C9A3A3' }}>{String(ch.before ?? '—')}</span><br />
            <span style={{ background: C.mark, fontWeight: 700 }}>{String(edited?.[i]?.after ?? ch.after ?? '—')}</span>
          </p>
        ))}
      </Panel>
    )
    return (
      <Panel>
        <H2>What changes</H2>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(0,1fr) minmax(0,1fr)', border: `1px solid ${C.line2}`, borderRadius: 10, overflow: 'hidden', minWidth: 520 }}>
            {['Field', 'Before', 'After'].map(h => <div key={h} style={{ padding: '10px 12px', background: C.bg, fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted }}>{h}</div>)}
            {a.changes.map((ch, i) => [
              <div key={`f${i}`} style={cell}><b>{ch.field}</b></div>,
              <div key={`b${i}`} style={cell}><span style={{ color: C.muted, textDecoration: 'line-through', textDecorationColor: '#C9A3A3' }}>{String(ch.before ?? '—')}</span></div>,
              <div key={`a${i}`} style={cell}><span style={{ background: C.mark, fontWeight: 700 }}>{String(edited?.[i]?.after ?? ch.after ?? '—')}</span></div>,
            ])}
          </div>
        </div>
      </Panel>
    )
  }
  const def = ARTEFACT_TYPES[task.artefact_type]
  const fields = def ? def.fields.filter(f => !COMMON_KEYS.includes(f.key) && a[f.key] != null && a[f.key] !== '')
    : Object.keys(a).filter(k => !COMMON_KEYS.includes(k)).map(k => ({ key: k, label: k.replace(/_/g, ' ') }))
  if (!fields.length && !task.staging_url) {
    return <Panel><H2>What’s in it</H2><p style={{ margin: 0, fontSize: 14, color: C.muted }}>{task.artefact ? 'No details on this card.' : 'Waiting for the agent to attach the details.'}</p></Panel>
  }
  return (
    <Panel>
      <H2>What’s in it</H2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {fields.map(f => {
          const ev = edits && Object.prototype.hasOwnProperty.call(edits, f.key) ? edits[f.key] : undefined
          return (
            <div key={f.key}>
              <p style={{ margin: '0 0 3px', fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted }}>{f.label || f.key}{ev !== undefined && ' · edited'}</p>
              <div style={{ fontSize: 14, lineHeight: 1.5 }}><Value v={ev !== undefined ? ev : a[f.key]} render={f.render} /></div>
            </div>
          )
        })}
        {task.staging_url && (
          <div>
            <p style={{ margin: '0 0 3px', fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted }}>Staging URL</p>
            <Value v={task.staging_url} render="link" />
          </div>
        )}
      </div>
    </Panel>
  )
}
const cell = { padding: '10px 12px', borderTop: `1px solid ${C.line2}`, fontSize: 14, lineHeight: 1.45 }

export function WhySection({ artefact }) {
  const a = isObj(artefact) ? artefact : {}
  const ev = Array.isArray(a.evidence) ? a.evidence.filter(e => e && e.text) : []
  if (!a.why && !ev.length) return null
  return (
    <Panel>
      <H2>Why</H2>
      {a.why && <p style={{ margin: ev.length ? '0 0 10px' : 0, fontSize: 14, lineHeight: 1.5 }}>{a.why}</p>}
      {ev.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ev.map((e, i) => (
            <li key={i} style={{ fontSize: 14, lineHeight: 1.5 }}>{e.text}
              {e.source && <span style={{ display: 'block', fontSize: 12, fontWeight: 800, color: C.muted, marginTop: 2 }}>{e.source}</span>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

export function EffectUndo({ artefact, isMobile }) {
  const a = isObj(artefact) ? artefact : {}
  if (!a.expected_effect && !a.undo) return null
  if (isMobile) return (
    <Panel>
      <H2>Expected effect and undo</H2>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>{a.expected_effect}{a.expected_effect && a.undo ? ' ' : ''}{a.undo && <>Undo: {a.undo}</>}</p>
    </Panel>
  )
  return (
    <div style={{ display: 'grid', gridTemplateColumns: a.expected_effect && a.undo ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: 16 }}>
      {a.expected_effect && <Panel><H2>Expected effect</H2><p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>{a.expected_effect}</p></Panel>}
      {a.undo && <Panel><H2>Undo</H2><p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>{a.undo}</p></Panel>}
    </div>
  )
}

export function ChecksSection({ artefact }) {
  const checks = (isObj(artefact) && Array.isArray(artefact.checks) ? artefact.checks : []).filter(c => c && c.text)
  if (!checks.length) return null
  const allPass = checks.every(c => c.result === 'pass')
  return (
    <Panel>
      <H2>{allPass ? 'Checks passed' : 'Checks'}</H2>
      {checks.map((c, i) => <Tick key={i} result={c.result}>{c.text}</Tick>)}
    </Panel>
  )
}

export function AfterYes({ artefact }) {
  const list = isObj(artefact) && Array.isArray(artefact.after_yes) ? artefact.after_yes.filter(Boolean) : []
  if (!list.length) return null
  return (
    <Panel>
      <H2>After you say yes</H2>
      <ol style={{ margin: 0, paddingLeft: 20, listStyle: 'decimal', fontSize: 14, lineHeight: 1.55 }}>{list.map((s, i) => <li key={i}>{String(s)}</li>)}</ol>
    </Panel>
  )
}

export function HistorySection({ task }) {
  const rows = trail(task)
  if (!rows.length) return null
  return (
    <Panel>
      <H2>History</H2>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 10, fontSize: 13, padding: '4px 0' }}>
          <span style={{ fontWeight: 800, color: C.muted }}>{fmtWhen(r.at)}</span><span>{r.text}</span>
        </div>
      ))}
    </Panel>
  )
}

/** The left column of the generic card. */
export default function GenericBody({ task, artefact, isMobile, edits }) {
  return (
    <>
      <WhatChanges task={task} isMobile={isMobile} edits={edits} />
      <WhySection artefact={artefact} />
      <EffectUndo artefact={artefact} isMobile={isMobile} />
      <ChecksSection artefact={artefact} />
      <AfterYes artefact={artefact} />
    </>
  )
}
