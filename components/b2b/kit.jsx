// Shared pieces for the B2B campaign screens (boards docs/b2b-campaigns/design/*): the 7-step track, figures,
// tag lists, the default fetcher. House look via the Approvals v2 review kit.
import { apiFetch } from '../../lib/supabase'
import { callJson } from '../approvals/ui'
import { C, Chip, dueText } from '../approvals/renderers/reviewKit'

export const defaultFetcher = (path, init) => callJson(apiFetch, path, init)

export const STEP_TONE = {
  done: { bg: C.okBg, fg: C.ok },
  now: { bg: C.indigo, fg: '#fff' },
  wait: { bg: C.warnBg, fg: C.warn },
  todo: { bg: C.grey, fg: C.muted },
}

const BAR = { done: '#7FC39A', now: C.indigo, wait: '#E8A54B', todo: '#E2DEEC' }

export const CHIP_TONE = {
  wait: { bg: C.warnBg, fg: C.warn },
  bad: { bg: C.badBg, fg: C.bad },
  ok: { bg: C.okBg, fg: C.ok },
  info: { bg: C.soft, fg: C.indigo },
  muted: { bg: C.grey, fg: C.body },
}

export function NextChip({ next, style }) {
  if (!next) return null
  const t = CHIP_TONE[next.tone] || CHIP_TONE.muted
  return <Chip bg={t.bg} fg={t.fg} style={{ whiteSpace: 'normal', textAlign: 'right', ...style }}>{next.text}</Chip>
}

/** The 7-step track (board B2BCampaigns .track). On phones: a compact bar with the current step named. */
export function Track({ steps, isMobile }) {
  const list = steps || []
  if (isMobile) {
    const cur = list.find(s => s.state === 'wait' || s.state === 'now') || list.filter(s => s.state === 'done').slice(-1)[0]
    return (
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${list.length || 7}, minmax(0, 1fr))`, gap: 3 }} aria-hidden="true">
          {list.map((s, i) => <span key={i} style={{ height: 6, borderRadius: 3, background: BAR[s.state] || BAR.todo }} />)}
        </div>
        {cur && (
          <p style={{ margin: '6px 0 0', fontSize: 13, fontWeight: 800, color: C.body }}>
            Step {list.indexOf(cur) + 1} of {list.length} · {cur.label}{cur.due_at ? ` · ${dueText(cur.due_at)}` : cur.note ? ` · ${cur.note}` : ''}
          </p>
        )}
      </div>
    )
  }
  return (
    <ol style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'grid', gridTemplateColumns: `repeat(${list.length || 7}, minmax(0, 1fr))`, gap: 4 }} aria-label="Steps">
      {list.map((s, i) => {
        const t = STEP_TONE[s.state] || STEP_TONE.todo
        const note = s.due_at ? dueText(s.due_at) : s.note
        return (
          <li key={i} style={{ borderRadius: 8, padding: '6px 8px', fontSize: 12, fontWeight: 800, lineHeight: 1.25, background: t.bg, color: t.fg, minWidth: 0, overflowWrap: 'anywhere' }}>
            {s.label}
            {note ? <span style={{ display: 'block', fontWeight: 700, opacity: 0.85 }}>{note}</span> : null}
          </li>
        )
      })}
    </ol>
  )
}

export function Nums({ nums, isMobile }) {
  const list = nums || []
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${isMobile ? Math.min(3, list.length) : list.length}, minmax(0, 1fr))`, gap: 8, marginTop: 12 }}>
      {list.map((n, i) => (
        <div key={i} style={{ background: C.bg, borderRadius: 10, padding: '8px 10px', minWidth: 0 }}>
          <b style={{ display: 'block', fontSize: 18 }}>{n.v == null ? '–' : n.v}</b>
          <span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>{n.l}</span>
        </div>
      ))}
    </div>
  )
}

const TAG_TONE = { must: { bg: C.okBg, bd: '#BFE3CB' }, nice: { bg: C.soft, bd: '#D9CEF1' }, not: { bg: C.badBg, bd: '#EBC2C2' }, plain: { bg: C.bg, bd: C.line } }

export function Tag({ kind = 'plain', children, onRemove, style }) {
  const t = TAG_TONE[kind]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, borderRadius: 8, padding: '4px 10px', margin: '0 6px 6px 0', background: t.bg, border: `1px solid ${t.bd}`, maxWidth: '100%', overflowWrap: 'anywhere', ...style }}>
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${typeof children === 'string' ? children : ''}`}
          style={{ border: 0, background: 'none', cursor: 'pointer', font: "800 14px 'Nunito', sans-serif", color: C.muted, padding: '0 2px', minWidth: 24, minHeight: 24 }}>×</button>
      )}
    </span>
  )
}

export function Tags({ items, kind, empty = '–' }) {
  const list = (items || []).filter(Boolean)
  if (!list.length) return <span style={{ color: C.faint }}>{empty}</span>
  return <span>{list.map((x, i) => <Tag key={i} kind={kind}>{x}</Tag>)}</span>
}

/** A label / value row (boards .def / .crit). On phones the label sits on top. */
export function DefRow({ label, children, isMobile, labelWidth = 170, first }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : `${labelWidth}px minmax(0, 1fr)`, gap: isMobile ? 4 : 12, padding: '12px 0', borderTop: first ? 0 : '1px solid #F1EEF6', fontSize: 14, lineHeight: 1.5, alignItems: 'start' }}>
      <b>{label}</b>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  )
}

export function Tile({ label, value, note, color = C.ink }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: '14px 16px', minWidth: 0 }}>
      <p style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted, margin: 0 }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: 26, fontWeight: 800, color }}>{value}</p>
      {note ? <p style={{ margin: '2px 0 0', fontSize: 13, color: C.muted }}>{note}</p> : null}
    </div>
  )
}

export const font = "'Nunito', system-ui, sans-serif"
