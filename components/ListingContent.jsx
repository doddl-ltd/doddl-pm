// One Amazon listing's content beyond the copy fields, as HQ's bulk pull read it (Jon 2026-11-11: images, A+ content and
// every attribute): the A+ documents applied to the ASIN with each module's text and images, the category and
// variations, and every attribute from the live page and from our own listing, searchable.
import { useMemo, useState } from 'react'
import { C, Panel, H2, Note, Chip, Pill, fmtDay } from './approvals/renderers/reviewKit'

const safeUrl = (u) => (/^https:\/\/m\.media-amazon\.com\//i.test(String(u || '')) ? u : null)
const STATUS = { APPROVED: ['Live', C.okBg, C.ok], DRAFT: ['Draft', C.grey, C.muted], SUBMITTED: ['Submitted', C.blueBg, C.blue], REJECTED: ['Rejected', C.badBg, C.bad] }

function AplusDoc({ d, isMobile }) {
  const [open, setOpen] = useState(d.status === 'APPROVED')
  const [label, bg, fg] = STATUS[d.status] || [d.status, C.grey, C.muted]
  return (
    <div style={{ borderTop: `1px solid ${C.line2}`, padding: '12px 0' }}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', width: '100%', background: 'none', border: 0, padding: 0, font: 'inherit', color: C.ink, cursor: 'pointer', textAlign: 'left', minHeight: 36 }}>
        <Chip bg={bg} fg={fg}>{label}</Chip>
        <b style={{ fontSize: 15 }}>{d.name || 'A+ document'}</b>
        <span style={{ color: C.muted, fontSize: 13 }}>{(d.modules || []).length} modules{d.updated ? ` · updated ${fmtDay(d.updated)}` : ''}</span>
        <span aria-hidden="true" style={{ marginLeft: 'auto', color: C.indigo, fontWeight: 800 }}>{open ? '–' : '+'}</span>
      </button>
      {open && (d.modules || []).map((m, i) => (
        <div key={i} style={{ margin: '12px 0 0', padding: isMobile ? 10 : 14, background: C.bg, borderRadius: 12 }}>
          <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em' }}>Module {i + 1} · {m.type}</p>
          {(m.images || []).length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {m.images.map((im, j) => {
                const u = safeUrl(im.url)
                return u ? (
                  <a key={j} href={u} target="_blank" rel="noopener noreferrer" title={im.alt || ''} style={{ display: 'block', flex: (m.images.length === 1 ? '1 1 100%' : '0 1 220px'), maxWidth: m.images.length === 1 ? 970 : 220 }}>
                    <img src={u} alt={im.alt || `A+ image ${j + 1}`} loading="lazy" style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 8, border: `1px solid ${C.line}`, background: '#fff' }} />
                    {im.px ? <span style={{ fontSize: 11, color: C.muted }}>{im.px}</span> : null}
                  </a>
                ) : null
              })}
            </div>
          )}
          {(m.texts || []).length > 0 && (
            <div style={{ marginTop: (m.images || []).length ? 10 : 0, fontSize: 14, lineHeight: 1.5 }}>
              {m.texts.map((t, j) => <p key={j} style={{ margin: '0 0 6px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{t}</p>)}
            </div>
          )}
          {!(m.images || []).length && !(m.texts || []).length ? <Note>No text or images in this module.</Note> : null}
        </div>
      ))}
    </div>
  )
}

export function AplusPanel({ product, isMobile }) {
  const docs = Array.isArray(product.aplus) ? product.aplus : null
  if (docs === null) return null
  return (
    <Panel pad={isMobile ? '14px' : undefined} style={{ marginTop: isMobile ? 0 : 20 }}>
      <H2>A+ content</H2>
      {docs.length
        ? <>
            {docs.filter(d => d.status === 'APPROVED').length > 1 ? <Note style={{ marginTop: 0 }}>More than one live A+ document is applied to this product here.</Note> : null}
            {docs.map(d => <AplusDoc key={d.ref} d={d} isMobile={isMobile} />)}
          </>
        : <Note>No A+ content is applied to this product in this marketplace.</Note>}
    </Panel>
  )
}

export function AttributesPanel({ product, isMobile }) {
  const all = Array.isArray(product.attributes) ? product.attributes : null
  const [q, setQ] = useState('')
  const [src, setSrc] = useState('all')
  const shown = useMemo(() => (all || []).filter(a => (src === 'all' || a.source === src) && (!q || `${a.name} ${a.value}`.toLowerCase().includes(q.toLowerCase()))), [all, q, src])
  if (all === null) return null
  const v = product.variations || {}
  return (
    <Panel pad={isMobile ? '14px' : undefined} style={{ marginTop: isMobile ? 0 : 20 }}>
      <H2>All attributes</H2>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px', margin: '0 0 12px', fontSize: 14 }}>
        <dt style={{ color: C.muted }}>Category</dt><dd style={{ margin: 0 }}>{product.category || '–'}</dd>
        <dt style={{ color: C.muted }}>Variations</dt>
        <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{[v.theme && `by ${String(v.theme).toLowerCase().replace(/_/g, ' ')}`, (v.parent_asins || []).length ? `parent ${v.parent_asins.join(', ')}` : null, (v.child_asins || []).length ? `${v.child_asins.length} children: ${v.child_asins.join(', ')}` : null].filter(Boolean).join(' · ') || 'None'}</dd>
      </dl>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search attributes" aria-label="Search attributes" style={{ flex: '1 1 220px', minHeight: 40, border: `1px solid ${C.border}`, borderRadius: 10, padding: '0 12px', font: "600 14px 'Nunito', sans-serif" }} />
        {[['all', 'Both'], ['page', 'Live page'], ['our listing', 'Our listing']].map(([k, l]) => <Pill key={k} on={src === k} onClick={() => setSrc(k)} style={{ minHeight: 40 }}>{l}</Pill>)}
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 13, color: C.muted }}>{shown.length} of {all.length}. “Live page” is Amazon’s catalogue (what shoppers see); “Our listing” is what doddl submitted.</p>
      <div className="scroll-x" style={{ marginTop: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
          <thead><tr>{['Attribute', 'Value', 'From'].map(h => <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: C.muted, padding: '8px 8px', background: C.bg }}>{h}</th>)}</tr></thead>
          <tbody>
            {shown.map((a, i) => (
              <tr key={`${a.source}-${a.name}-${i}`}>
                <td style={{ padding: '7px 8px', borderTop: `1px solid ${C.line2}`, fontWeight: 700, whiteSpace: 'nowrap', verticalAlign: 'top' }}>{a.name.replace(/_/g, ' ')}</td>
                <td style={{ padding: '7px 8px', borderTop: `1px solid ${C.line2}`, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', verticalAlign: 'top' }}>{a.value}</td>
                <td style={{ padding: '7px 8px', borderTop: `1px solid ${C.line2}`, color: C.muted, whiteSpace: 'nowrap', verticalAlign: 'top' }}>{a.source === 'page' ? 'Live page' : 'Our listing'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
