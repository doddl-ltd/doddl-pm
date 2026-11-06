// Shared look for the Approvals v2 screens (docs/approvals-v2/design): chips, panels, buttons, ticks.
import { C, TONES } from '../../lib/approvalsUi'

export const font = "'Nunito', system-ui, sans-serif"

export function Chip({ children, tone, style }) {
  const t = tone ? TONES[tone] : { bg: C.tint, color: C.indigo }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, borderRadius: 999, padding: '3px 10px', background: t.bg, color: t.color, whiteSpace: 'nowrap', ...style }}>
      {children}
    </span>
  )
}

export function Due({ chip, small }) {
  if (!chip) return null
  const t = TONES[chip.tone || 'grey']
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: small ? 12 : 13, fontWeight: 800, borderRadius: 999, padding: small ? '3px 10px' : '4px 12px', background: t.bg, color: t.color, whiteSpace: 'nowrap' }}>
      {chip.text || chip.label}
    </span>
  )
}

export function Panel({ children, style, as: Tag = 'section', ...rest }) {
  return <Tag {...rest} style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: '18px 20px', minWidth: 0, ...style }}>{children}</Tag>
}

export function H2({ children, style }) {
  return <h2 style={{ fontSize: 17, fontWeight: 800, margin: '0 0 10px', color: C.ink, ...style }}>{children}</h2>
}

export function Lbl({ children, style, as: Tag = 'p' }) {
  return <Tag style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted, margin: 0, ...style }}>{children}</Tag>
}

export function Btn({ children, kind, small, style, ...rest }) {
  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: small ? 36 : 46, padding: small ? '0 12px' : '0 20px',
    borderRadius: 10, font: `800 ${small ? 13 : 15}px ${font}`, border: `1px solid ${C.border}`, background: '#fff', color: C.ink,
    cursor: rest.disabled ? 'default' : 'pointer', textDecoration: 'none', boxSizing: 'border-box', opacity: rest.disabled ? 0.55 : 1,
  }
  if (kind === 'primary') Object.assign(base, { background: C.indigo, borderColor: C.indigo, color: '#fff' })
  if (kind === 'danger') Object.assign(base, { color: '#A12B2B', borderColor: '#E3B9B9' })
  return <button type="button" {...rest} style={{ ...base, ...style }}>{children}</button>
}

export function TickIcon({ result = 'pass' }) {
  if (result === 'fix') return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ flex: 'none', marginTop: 2 }}>
      <circle cx="9" cy="9" r="8.5" fill="#F8E1E1" /><path d="M6 6l6 6M12 6l-6 6" stroke="#A12B2B" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
  if (result === 'check') return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ flex: 'none', marginTop: 2 }}>
      <circle cx="9" cy="9" r="8.5" fill="#FBE9D2" /><path d="M9 5v5" stroke="#8A4B00" strokeWidth="2" strokeLinecap="round" /><circle cx="9" cy="13" r="1.2" fill="#8A4B00" />
    </svg>
  )
  if (result === 'pending') return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ flex: 'none', marginTop: 2 }}><circle cx="9" cy="9" r="8" fill="none" stroke={C.border} strokeWidth="1.5" /></svg>
  )
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ flex: 'none', marginTop: 2 }}>
      <circle cx="9" cy="9" r="8.5" fill="#E2F2E7" /><path d="M5 9.2l2.6 2.6L13 6.5" fill="none" stroke="#1E6B3A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Tick({ result, children }) {
  return <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.45, padding: '6px 0' }}><TickIcon result={result} /><span>{children}</span></div>
}

// Striped placeholder for media without a URL (labelled as in the designs).
export function Placeholder({ children, height = 140, style }) {
  return (
    <div style={{ height, background: 'repeating-linear-gradient(135deg,#ECE8F4 0 10px,#F4F1F9 10px 20px)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 12, fontWeight: 800, textAlign: 'center', padding: 8, borderRadius: 8, ...style }}>
      {children}
    </div>
  )
}

export const inputStyle = {
  font: `600 14px ${font}`, color: C.ink, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', minHeight: 44,
  boxSizing: 'border-box', width: '100%', background: '#fff', outline: 'none',
}

export function Field({ label, htmlFor, children, hint }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && <label htmlFor={htmlFor} style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>{label}</label>}
      {children}
      {hint && <span style={{ fontSize: 12, color: C.muted }}>{hint}</span>}
    </div>
  )
}

export function Radio({ name, value, checked, onChange, children }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 40, fontSize: 14, fontWeight: 700, cursor: 'pointer', color: C.ink }}>
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} style={{ width: 18, height: 18, accentColor: C.indigo }} />
      {children}
    </label>
  )
}

export function Segmented({ items, value, onChange, stretch }) {
  return (
    <div role="tablist" style={{ display: 'flex', gap: 4, background: '#ECE8F4', borderRadius: 12, padding: 4 }}>
      {items.map(it => (
        <button key={it.key} type="button" role="tab" aria-selected={value === it.key} onClick={() => onChange(it.key)}
          style={{ flex: stretch ? 1 : 'none', minHeight: 44, border: 0, padding: '0 14px', font: `800 14px ${font}`, borderRadius: 10, cursor: 'pointer',
            background: value === it.key ? '#fff' : 'none', color: value === it.key ? C.indigo : C.muted, boxShadow: value === it.key ? '0 1px 2px rgba(25,14,62,.12)' : 'none' }}>
          {it.label}
        </button>
      ))}
    </div>
  )
}

export function BackLink({ onClick, children = '‹ Approvals' }) {
  return (
    <button type="button" onClick={onClick} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: `800 14px ${font}`, color: C.indigo, minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
      {children}
    </button>
  )
}

export function Notice({ tone = 'info', children, style }) {
  const t = { info: { bg: C.mark, color: C.ink }, ok: { bg: '#E2F2E7', color: '#1E6B3A' }, warn: { bg: '#FBE9D2', color: '#6B3A00' }, bad: { bg: '#F8E1E1', color: '#7A1F1F' }, grey: { bg: C.grey, color: C.ink } }[tone]
  return <div style={{ background: t.bg, color: t.color, borderRadius: 10, padding: '10px 14px', fontSize: 14, lineHeight: 1.5, ...style }}>{children}</div>
}

// "Loading…" / error / empty line in the house tone.
export function Quiet({ children }) {
  return <p style={{ color: C.muted, fontSize: 14, fontWeight: 700, padding: '24px 0' }}>{children}</p>
}

// apiFetch wrapper: JSON in, JSON out, throws with the server's message.
export async function callJson(apiFetch, path, init) {
  const r = await apiFetch(path, init)
  let body = null
  try { body = await r.json() } catch { /* empty */ }
  if (!r.ok) {
    const e = new Error((body && body.error) || (r.status === 401 ? 'Please sign in again' : `Request failed (${r.status})`))
    e.status = r.status
    throw e
  }
  return body
}
