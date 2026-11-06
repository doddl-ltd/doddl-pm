// Shared building blocks for the Approvals v2 review renderers and the HQ views (studio, calendar,
// listings). House look from the design boards (docs/approvals-v2/design): Nunito, indigo #3D157D,
// ink #190e3e, inline styles, 44px touch targets.

export const C = {
  ink: '#190e3e', indigo: '#3D157D', lilac: '#C9B6F2', bg: '#F6F4FA', line: '#E4E0EE', line2: '#EFECF5',
  muted: '#5B5470', body: '#4A4458', faint: '#8F88A6', border: '#CFC8E0', soft: '#EEE9F8', grey: '#F0EEF4',
  ok: '#1E6B3A', okBg: '#E2F2E7', warn: '#8A4B00', warnBg: '#FBE9D2', bad: '#A12B2B', badBg: '#F8E1E1',
  blue: '#1D4E89', blueBg: '#E1ECF8', plum: '#7A1F5C', plumBg: '#F6E3EF',
}

export const TONE = { ok: C.ok, warn: C.warn, bad: C.bad, info: C.indigo, muted: C.muted }

const STRIPES = (a, b, n = 10) => `repeating-linear-gradient(135deg,${a} 0 ${n}px,${b} ${n}px ${n * 2}px)`
export const STRIPE_LIGHT = STRIPES('#ECE8F4', '#F4F1F9')
export const STRIPE_DARK = STRIPES('#2A2440', '#332C4D')

export function Panel({ children, style, pad, ...rest }) {
  return (
    <section style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: pad || '18px 20px', minWidth: 0, ...style }} {...rest}>
      {children}
    </section>
  )
}

export function H2({ children, style }) {
  return <h2 style={{ fontSize: 17, fontWeight: 800, margin: '0 0 10px', color: C.ink, ...style }}>{children}</h2>
}

export function Lbl({ children, style }) {
  return <p style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted, margin: 0, ...style }}>{children}</p>
}

export function Note({ children, style }) {
  return <p style={{ margin: 0, fontSize: 13, color: C.muted, lineHeight: 1.5, ...style }}>{children}</p>
}

export function Chip({ children, bg = C.soft, fg = C.indigo, style }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, borderRadius: 999, padding: '3px 10px', background: bg, color: fg, whiteSpace: 'nowrap', ...style }}>{children}</span>
}

/** Striped placeholder where a picture or video would be (media URLs are optional everywhere). */
export function Ph({ children, style, dark, url, alt, video }) {
  const base = { position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: 12, fontWeight: 800, overflow: 'hidden' }
  if (url) {
    return (
      <div style={{ ...base, background: dark ? '#111' : '#F4F1F9', ...style }}>
        {video
          ? <video src={url} muted playsInline controls style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <img src={url} alt={alt || ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
      </div>
    )
  }
  return <div style={{ ...base, background: dark ? STRIPE_DARK : STRIPE_LIGHT, color: dark ? '#DCD6EC' : C.muted, ...style }}>{children}</div>
}

const RES = { pass: ['Pass', C.ok], check: ['Check', C.warn], fix: ['Fix', C.bad] }

export function Checks({ checks, empty = 'No checks reported.' }) {
  const list = Array.isArray(checks) ? checks.filter(Boolean) : []
  if (!list.length) return <Note>{empty}</Note>
  return (
    <div>
      {list.map((c, i) => {
        const [word, col] = RES[c.result] || [c.result || 'Note', C.muted]
        return (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.45, padding: '7px 0', borderTop: i ? `1px solid #F1EEF6` : 0 }}>
            <span style={{ color: col, fontWeight: 800, flex: 'none', width: 54 }}>{word}</span>
            <span>{c.text}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Segmented buttons (board .seg). options: [{value, label}] */
export function Seg({ options, value, onChange, label, style, full }) {
  return (
    <div role="group" aria-label={label} style={{ display: full ? 'flex' : 'inline-flex', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', background: '#fff', flexWrap: 'wrap', ...style }}>
      {options.map(o => {
        const on = o.value === value
        return (
          <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange(o.value)}
            style={{ border: 0, background: on ? C.ink : '#fff', color: on ? '#fff' : C.ink, font: "800 14px 'Nunito', sans-serif", minHeight: 44, padding: '0 16px', cursor: 'pointer', flex: full ? '1 1 0' : 'none' }}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Pill({ on, children, onClick, style, ...rest }) {
  return (
    <button type="button" aria-pressed={!!on} onClick={onClick}
      style={{ flex: 'none', minHeight: 44, padding: '0 14px', borderRadius: 999, border: `1px solid ${on ? C.ink : C.border}`, background: on ? C.ink : '#fff', color: on ? '#fff' : C.ink, font: "800 14px 'Nunito', sans-serif", cursor: 'pointer', whiteSpace: 'nowrap', ...style }} {...rest}>
      {children}
    </button>
  )
}

export function Pills({ children, label }) {
  return <div role="group" aria-label={label} className="scroll-x" style={{ display: 'flex', gap: 8, paddingBottom: 4 }}>{children}</div>
}

export function Tick({ checked, onChange, children, disabled, style }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, fontSize: 14, fontWeight: 700, cursor: disabled ? 'default' : 'pointer', ...style }}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={e => onChange && onChange(e.target.checked)} style={{ width: 18, height: 18, accentColor: C.indigo }} />
      {children}
    </label>
  )
}

export function Radio({ name, checked, onChange, children, disabled }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, fontSize: 14, fontWeight: 700, cursor: disabled ? 'default' : 'pointer' }}>
      <input type="radio" name={name} checked={!!checked} disabled={disabled} onChange={() => onChange && onChange()} style={{ width: 18, height: 18, accentColor: C.indigo }} />
      {children}
    </label>
  )
}

export const inputStyle = {
  font: "600 14px 'Nunito', sans-serif", color: C.ink, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px',
  minHeight: 44, boxSizing: 'border-box', width: '100%', background: '#fff', resize: 'vertical',
}

export const selectStyle = { ...inputStyle, font: "700 13px 'Nunito', sans-serif", minHeight: 40, padding: '0 8px' }

/** A labelled field with an optional count on the right. */
export function Field({ id, label, hint, children, style }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12, ...style }}>
      <label htmlFor={id} style={{ fontSize: 13, fontWeight: 800, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span>{label}</span>{hint ? <span style={{ color: C.muted, fontWeight: 700 }}>{hint}</span> : null}
      </label>
      {children}
    </div>
  )
}

export function Btn({ children, primary, danger, style, ...rest }) {
  return (
    <button type="button" style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 46, padding: '0 20px', borderRadius: 10,
      font: "800 15px 'Nunito', sans-serif", border: `1px solid ${primary ? C.indigo : danger ? '#E3B9B9' : C.border}`,
      background: primary ? C.indigo : '#fff', color: primary ? '#fff' : danger ? C.bad : C.ink,
      cursor: rest.disabled ? 'not-allowed' : 'pointer', opacity: rest.disabled ? 0.55 : 1, boxSizing: 'border-box', ...style,
    }} {...rest}>{children}</button>
  )
}

/** Collapsible panel for phones (board <details>). */
export function Fold({ title, children, open }) {
  return (
    <Panel pad="14px">
      <details open={open}>
        <summary style={{ fontSize: 15, fontWeight: 800, cursor: 'pointer', minHeight: 32, display: 'flex', alignItems: 'center' }}>{title}</summary>
        <div style={{ marginTop: 10 }}>{children}</div>
      </details>
    </Panel>
  )
}

export function Steps({ items }) {
  const list = (items || []).filter(Boolean)
  if (!list.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {list.map((t, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.4 }}>
          <span style={{ flex: 'none', width: 26, height: 26, borderRadius: '50%', background: C.soft, color: C.indigo, fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
          <span>{t}</span>
        </div>
      ))}
    </div>
  )
}

/** Why + evidence + expected effect + undo (keys every artefact may carry). */
export function WhyBlock({ why, evidence, expected, undo }) {
  const ev = (evidence || []).filter(Boolean)
  if (!why && !ev.length && !expected && !undo) return null
  return (
    <div style={{ fontSize: 14, lineHeight: 1.55 }}>
      {why ? <p style={{ margin: 0 }}>{why}</p> : null}
      {ev.length ? (
        <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 13, color: C.body, listStyle: 'disc' }}>
          {ev.map((e, i) => <li key={i} style={{ marginTop: 4 }}>{e.text}{e.source ? <span style={{ color: C.muted }}> · {e.source}</span> : null}</li>)}
        </ul>
      ) : null}
      {expected ? <p style={{ margin: '10px 0 0' }}><b>Expected effect:</b> {expected}</p> : null}
      {undo ? <p style={{ margin: '6px 0 0' }}><b>To undo:</b> {undo}</p> : null}
    </div>
  )
}

export const th = { textAlign: 'left', fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted, padding: '8px 10px', background: C.bg, whiteSpace: 'nowrap' }
export const td = { padding: 10, borderTop: `1px solid ${C.line2}`, verticalAlign: 'top', lineHeight: 1.45 }

export function Table({ head, rows, minWidth = 640 }) {
  return (
    <div className="scroll-x">
      <table style={{ width: '100%', minWidth, borderCollapse: 'collapse', fontSize: 14 }}>
        <thead><tr>{head.map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={{ ...td, fontWeight: j === 0 ? 800 : 400 }}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

/** Phone mock frame (board .phone). */
export function PhoneFrame({ children, width = 250, dark, style }) {
  return <div style={{ width, flex: 'none', border: `8px solid ${C.ink}`, borderRadius: 30, background: dark ? '#111' : '#fff', overflow: 'hidden', boxSizing: 'border-box', ...style }}>{children}</div>
}

/** Red bands where platform buttons and captions cover the picture (9:16). */
export function SafeZones() {
  const band = { position: 'absolute', left: 0, right: 0, background: 'rgba(161,43,43,.28)', pointerEvents: 'none' }
  return (
    <>
      <span aria-hidden="true" style={{ ...band, top: 0, height: '14%', borderBottom: `2px dashed ${C.bad}` }} />
      <span aria-hidden="true" style={{ ...band, bottom: 0, height: '35%', borderTop: `2px dashed ${C.bad}` }} />
    </>
  )
}

export function Avatar({ size = 24 }) {
  return <span aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', background: C.indigo, flex: 'none', display: 'inline-block' }} />
}

export const mini = { fontSize: 11, lineHeight: 1.35 }

/** "0:03" or 3 -> seconds. */
export function toSeconds(t) {
  if (typeof t === 'number') return t
  const s = String(t == null ? '' : t).trim()
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s)
  const m = s.match(/^(\d+):(\d{1,2})(?:\.\d+)?$/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0
}

/** 3 -> "0:03" */
export function clock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function text(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(text).join(', ')
  if (typeof v === 'object') return v.label || v.text || Object.entries(v).map(([k, x]) => `${k}: ${text(x)}`).join(' · ')
  return String(v)
}

/** "Due in 21h" / "3h overdue" from an ISO time. */
export function dueText(at, now = Date.now()) {
  if (!at) return ''
  const h = Math.round((new Date(at).getTime() - now) / 3600_000)
  if (Number.isNaN(h)) return ''
  if (h >= 0) return h >= 48 ? `Due in ${Math.round(h / 24)} days` : `Due in ${h}h`
  return -h >= 48 ? `${Math.round(-h / 24)} days overdue` : `${-h}h overdue`
}

export function fmtDay(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  if (!iso) return ''
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('en-GB', { timeZone: 'Europe/London', ...opts })
}

export function fmtWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Panel-width page grid: on phones everything stacks. */
export function Cols({ children, isMobile, gap = 20, style }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 12 : gap, alignItems: 'flex-start', ...style }}>{children}</div>
}

export function Col({ children, basis = 380, style }) {
  return <div style={{ flex: `1 1 ${basis}px`, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16, ...style }}>{children}</div>
}

/** Loading / error / empty line for the views. */
export function StateLine({ loading, error, empty, children }) {
  if (loading) return <Note style={{ padding: '24px 0' }}>Loading…</Note>
  if (error) return <p role="alert" style={{ margin: '16px 0', padding: '12px 14px', borderRadius: 12, background: C.badBg, color: C.bad, fontWeight: 700, fontSize: 14 }}>{error}</p>
  if (empty) return <Note style={{ padding: '24px 0' }}>{children}</Note>
  return null
}
