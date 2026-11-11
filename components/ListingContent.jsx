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
                  <a key={j} href={u} target="_blank" rel="noopener noreferrer" title={im.alt || ''} style={{ display: 'block', ...(m.images.length === 1 || parseInt(im.px || '0', 10) >= 900 ? { flex: '1 1 100%', maxWidth: 970 } : { flex: '0 1 300px', maxWidth: 300 }) }}>
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

// The live image set at a size you can actually review: one card per slot, the whole picture (no cropping) on white,
// the slot and pixel size under it, click to open the full-size image from Amazon.
export function ImagesGallery({ field, isMobile }) {
  const live = Array.isArray(field && field.live) ? field.live.filter(Boolean) : []
  const [big, setBig] = useState(null)
  if (!field) return null
  return (
    <Panel pad={isMobile ? '14px' : undefined} style={{ marginTop: isMobile ? 0 : 20 }}>
      <H2>Images on Amazon now</H2>
      {field.note ? <p style={{ margin: '0 0 10px', fontSize: 13.5, background: C.badBg, color: C.bad, borderRadius: 8, padding: '8px 12px' }}>{field.note}</p> : null}
      {live.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 140 : 200}px, 1fr))`, gap: isMobile ? 8 : 14 }}>
          {live.map((im, i) => {
            const u = safeUrl(im.url)
            return (
              <figure key={`${im.slot}-${i}`} style={{ margin: 0, border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
                {u ? (
                  <button type="button" onClick={() => setBig(im)} aria-label={`Show ${im.label || im.slot} larger`} style={{ display: 'block', width: '100%', aspectRatio: '1 / 1', padding: 0, border: 0, background: '#fff', cursor: 'zoom-in' }}>
                    <img src={u} alt={im.label || `Image ${im.slot}`} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                  </button>
                ) : <div style={{ aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted }}>No link</div>}
                <figcaption style={{ padding: '6px 10px', fontSize: 12.5, borderTop: `1px solid ${C.line2}`, display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                  <b>{im.slot === 'MAIN' ? 'Main' : im.slot}</b><span style={{ color: C.muted }}>{im.px || ''}</span>
                </figcaption>
              </figure>
            )
          })}
        </div>
      ) : <Note>Amazon returned no images for this listing in this marketplace.</Note>}
      {big ? (
        <div role="dialog" aria-modal="true" aria-label={big.label || 'Image'} onClick={() => setBig(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,12,40,.82)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, cursor: 'zoom-out' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 12, maxWidth: 'min(1100px, 96vw)', maxHeight: '94vh', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <img src={safeUrl(big.url)} alt={big.label || 'Image'} style={{ maxWidth: '100%', maxHeight: '82vh', objectFit: 'contain' }} />
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', fontSize: 14 }}>
              <b>{big.slot === 'MAIN' ? 'Main image' : big.slot} {big.px ? <span style={{ color: C.muted, fontWeight: 600 }}>· {big.px}</span> : null}</b>
              <span style={{ display: 'flex', gap: 12 }}>
                <a href={safeUrl(big.url)} target="_blank" rel="noopener noreferrer" style={{ color: C.indigo, fontWeight: 800 }}>Open full size</a>
                <button type="button" onClick={() => setBig(null)} style={{ background: 'none', border: 0, color: C.indigo, font: "800 14px 'Nunito', sans-serif", cursor: 'pointer' }}>Close</button>
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </Panel>
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
