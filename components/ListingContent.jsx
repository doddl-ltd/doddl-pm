// One Amazon listing's content beyond the copy fields, as HQ's bulk pull read it (Jon 2026-11-11: images, A+ content and
// every attribute): the A+ documents applied to the ASIN with each module's text and images, the category and
// variations, and every attribute from the live page and from our own listing, searchable.
import { useMemo, useState } from 'react'
import { C, Panel, H2, Note, Chip, Pill, fmtDay } from './approvals/renderers/reviewKit'
import { StatusChip } from './approvals/renderers/ListingChangeReview'

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

// ─── Editable field table ──────────────────────────────────────────────────────
// The same layout as the listing's copy fields (Field | Live on Amazon now | Should be live | State), with an edit box
// in the "Should be live" column. Saved edits are proposed changes held in PM: nothing is sent to Amazon from here.

// Where an edit is: saved in PM → with HQ for checks → waiting for approval → sent to Amazon (or refused, with why).
export const EDIT_STAGE = {
  proposed: { label: 'Saved, not sent', bg: C.soft, fg: C.indigo },
  submitted: { label: 'With HQ for checks', bg: C.blueBg, fg: C.blue },
  in_approval: { label: 'Waiting for approval', bg: C.warnBg, fg: C.warn },
  refused: { label: 'Refused', bg: C.badBg, fg: C.bad },
  sent: { label: 'Sent to Amazon', bg: C.okBg, fg: C.ok },
}
const canChange = (e) => !e || ['proposed', 'refused', 'sent'].includes(e.status)
const bytes = (s) => new TextEncoder().encode(s || '').length
const meta = (m) => (m ? <span style={{ display: 'block', fontSize: 12, color: C.muted, fontWeight: 600, marginTop: 4 }}>{m}</span> : null)
const shortDate = (iso) => { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) } catch { return '' } }

function show(v, field) {
  if (v == null || v === '') return '–'
  if (Array.isArray(v) && v.length && typeof v[0] === 'object') return field === 'Images' ? `${v.length} images (shown below)` : v.map(x => x.label || x.slot || '').join(' · ')
  if (Array.isArray(v)) return v.join(' · ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function EditBox({ row, onSave, onCancel }) {
  const start = row.edit ? row.edit.value : (typeof row.live === 'string' ? row.live : '')
  const [v, setV] = useState(start)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const count = row.limitBytes ? `${bytes(v)} / ${row.limitBytes} bytes` : row.limitChars ? `${v.length} / ${row.limitChars} characters` : `${v.length} characters`
  const over = (row.limitBytes && bytes(v) > row.limitBytes) || (row.limitChars && v.length > row.limitChars)
  const save = async () => {
    setBusy(true); setErr('')
    try { await onSave(row, v) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div>
      <textarea value={v} onChange={e => setV(e.target.value)} rows={Math.min(10, Math.max(2, Math.ceil(v.length / 60)))} aria-label={`New value for ${row.label}`} autoFocus
        style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${C.indigo}`, borderRadius: 8, padding: '8px 10px', font: "600 14px/1.45 'Nunito', sans-serif", resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
        <span style={{ fontSize: 12, color: over ? C.bad : C.muted, fontWeight: 700, marginRight: 'auto' }}>{count}{over ? ' (over the limit)' : ''}</span>
        <button type="button" onClick={onCancel} disabled={busy} style={btn(false)}>Cancel</button>
        <button type="button" onClick={save} disabled={busy || !v.trim() || v.trim() === String(start).trim() && !!row.edit} style={btn(true)}>{busy ? 'Saving…' : 'Save edit'}</button>
      </div>
      {err ? <p role="alert" style={{ margin: '6px 0 0', fontSize: 13, color: C.bad }}>{err}</p> : null}
    </div>
  )
}

const btn = (primary) => ({ minHeight: 34, padding: '0 12px', borderRadius: 8, border: `1px solid ${primary ? C.indigo : C.border}`, background: primary ? C.indigo : '#fff', color: primary ? '#fff' : C.indigo, font: "800 13px 'Nunito', sans-serif", cursor: 'pointer' })

function ShouldCell({ row, editing, onSave, onCancel }) {
  if (editing) return <EditBox row={row} onSave={onSave} onCancel={onCancel} />
  if (row.edit) return <>{row.edit.value}{meta(`Edit by ${row.edit.submitted_by || row.edit.created_by || row.edit.updated_by || ''}${row.edit.updated_at ? `, ${shortDate(row.edit.updated_at)}` : ''}`)}</>
  return <>{show(row.should, row.name)}{meta(row.shouldMeta)}</>
}

function StateCell({ row, onEdit, onWithdraw, busy }) {
  const e = row.edit
  const stage = e ? EDIT_STAGE[e.status] || EDIT_STAGE.proposed : null
  return (
    <>
      {stage
        ? <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 800, borderRadius: 999, padding: '3px 10px', background: stage.bg, color: stage.fg, marginBottom: 6 }}>{stage.label}</span>
        : row.status ? <StatusChip status={row.status} style={{ marginBottom: 6 }} /> : null}
      {e && e.hq_note ? <span style={{ display: 'block', fontSize: 12, color: e.status === 'refused' ? C.bad : C.muted, marginBottom: 6, whiteSpace: 'pre-wrap' }}>{e.hq_note.slice(0, 600)}</span> : null}
      {e && e.status === 'in_approval' && e.approval_task_id ? <a href={`/?view=approvals&task=${e.approval_task_id}`} style={{ display: 'block', fontSize: 12, fontWeight: 800, color: C.indigo, marginBottom: 6 }}>Open the approval</a> : null}
      {row.note && !e ? <span style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 6 }}>{row.note}</span> : null}
      {row.editable && canChange(e) ? (
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => onEdit(row)} style={btn(false)}>{e && e.status === 'proposed' ? 'Change edit' : 'Edit'}</button>
          {e && e.status === 'proposed' ? <button type="button" onClick={() => onWithdraw(row)} disabled={busy} style={{ ...btn(false), color: C.bad, borderColor: C.line }}>Remove edit</button> : null}
        </span>
      ) : null}
    </>
  )
}

/**
 * rows: [{ key, kind: 'field'|'attribute', name, label, limit, live, liveMeta, should, shouldMeta, status, note, edit, editable,
 *          limitChars?, limitBytes? }]
 */
export function EditableTable({ rows, isMobile, onSave, onWithdraw, empty = 'Nothing to show.' }) {
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)
  const save = async (row, value) => { await onSave(row, value); setEditing(null) }
  const withdraw = async (row) => { setBusy(true); try { await onWithdraw(row) } finally { setBusy(false) } }
  if (!rows.length) return <Note>{empty}</Note>
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(r => (
          <div key={r.key} style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: '12px 14px' }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{r.label}{meta(r.limit)}</div>
            <p style={lab}>Live on Amazon now</p>
            <div style={{ fontSize: 14, lineHeight: 1.45, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{show(r.live, r.name)}{meta(r.liveMeta)}</div>
            <p style={lab}>Should be live</p>
            <div style={{ background: r.edit ? '#F1ECFB' : 'transparent', borderRadius: 8, padding: r.edit ? '8px 10px' : 0, fontSize: 14, lineHeight: 1.45, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', fontWeight: r.edit ? 700 : 400 }}>
              <ShouldCell row={r} editing={editing === r.key} onSave={save} onCancel={() => setEditing(null)} />
            </div>
            <div style={{ marginTop: 10 }}><StateCell row={r} onEdit={x => setEditing(x.key)} onWithdraw={withdraw} busy={busy} /></div>
          </div>
        ))}
      </div>
    )
  }
  const cell = { padding: 12, borderTop: `1px solid ${C.line2}`, fontSize: 14, lineHeight: 1.5, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }
  const hd = { ...cell, borderTop: 0, background: C.bg, fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted, whiteSpace: 'normal' }
  return (
    <div className="scroll-x">
      <div style={{ display: 'grid', gridTemplateColumns: '170px minmax(260px,1fr) minmax(260px,1fr) 210px', minWidth: 1000 }}>
        <div style={hd}>Field</div><div style={hd}>Live on Amazon now</div><div style={hd}>Should be live</div><div style={hd}>State</div>
        {rows.map(r => {
          const bad = r.status === 'problem' && !r.edit
          return [
            <div key={`${r.key}-n`} style={{ ...cell, fontWeight: 800, whiteSpace: 'normal' }}>{r.label}{meta(r.limit)}</div>,
            <div key={`${r.key}-l`} style={{ ...cell, background: bad ? '#FFF4E5' : 'transparent' }}>{show(r.live, r.name)}{meta(r.liveMeta)}</div>,
            <div key={`${r.key}-s`} style={{ ...cell, background: (r.edit && r.edit.status !== 'sent') || editing === r.key ? '#F1ECFB' : 'transparent', fontWeight: r.edit && r.edit.status !== 'sent' ? 700 : 400 }}>
              <ShouldCell row={r} editing={editing === r.key} onSave={save} onCancel={() => setEditing(null)} />
            </div>,
            <div key={`${r.key}-a`} style={{ ...cell, whiteSpace: 'normal' }}><StateCell row={r} onEdit={x => setEditing(x.key)} onWithdraw={withdraw} busy={busy} /></div>,
          ]
        })}
      </div>
    </div>
  )
}
const lab = { fontSize: 12, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: C.muted, margin: '10px 0 4px' }

// The copy fields (Title, Bullets, Description, Search terms and the read-only rows) in the editable layout.
const COPY_EDITABLE = ['Title', 'Bullet 1', 'Bullet 2', 'Bullet 3', 'Bullet 4', 'Bullet 5', 'Description', 'Search terms']
const LIMITS = { Title: { limitChars: 200 }, Description: { limitChars: 2000 }, 'Search terms': { limitBytes: 249 } }
export function fieldRows(fields, edits) {
  const byName = Object.fromEntries((edits || []).filter(e => e.kind === 'field' && e.status !== 'withdrawn').map(e => [e.name, e]))
  return fields.map(f => ({
    key: `field:${f.field}`, kind: 'field', name: f.field, label: f.field, limit: f.limit_text, live: f.live, liveMeta: f.live_meta,
    should: f.should, shouldMeta: f.should_meta, status: f.status, note: f.note, edit: byName[f.field] || null,
    editable: COPY_EDITABLE.includes(f.field), ...(LIMITS[f.field] || (/^Bullet/.test(f.field) ? { limitChars: 500 } : {})),
  }))
}

// One row per attribute: the live page's value (what shoppers see), with our listing's value noted when it differs.
export function attributeRows(attributes, edits) {
  const byName = Object.fromEntries((edits || []).filter(e => e.kind === 'attribute' && e.status !== 'withdrawn').map(e => [e.name, e]))
  const m = new Map()
  for (const a of attributes || []) {
    const r = m.get(a.name) || { page: null, ours: null }
    if (a.source === 'page') r.page = a.value; else r.ours = a.value
    m.set(a.name, r)
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, r]) => ({
    key: `attribute:${name}`, kind: 'attribute', name, label: name.replace(/_/g, ' '),
    live: r.page ?? r.ours, liveMeta: r.page == null ? 'Only on our listing (not on the live page)' : r.ours != null && r.ours !== r.page ? `Our listing says: ${r.ours}` : null,
    should: null, shouldMeta: null, status: null, note: null, edit: byName[name] || null, editable: true, source: r.page != null && r.ours != null ? 'both' : r.page != null ? 'page' : 'ours',
  }))
}

export function AttributesPanel({ product, edits, isMobile, onSave, onWithdraw }) {
  const all = useMemo(() => attributeRows(product.attributes, edits), [product.attributes, edits])
  const [q, setQ] = useState('')
  const [src, setSrc] = useState('all')
  if (!Array.isArray(product.attributes)) return null
  const shown = all.filter(r => (src === 'all' || (src === 'edited' ? !!r.edit : src === 'differs' ? /^Our listing says|^Only on our listing/.test(r.liveMeta || '') : true))
    && (!q || `${r.name} ${r.live} ${r.edit ? r.edit.value : ''}`.toLowerCase().includes(q.toLowerCase())))
  const v = product.variations || {}
  const edited = all.filter(r => r.edit).length
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
        {[['all', 'All'], ['differs', 'Live page ≠ our listing'], ['edited', `Edited (${edited})`]].map(([k, l]) => <Pill key={k} on={src === k} onClick={() => setSrc(k)} style={{ minHeight: 40 }}>{l}</Pill>)}
      </div>
      <p style={{ margin: '8px 0 10px', fontSize: 13, color: C.muted }}>{shown.length} of {all.length} attributes. Edits are saved in PM as proposed changes; nothing is sent to Amazon from this screen.</p>
      <Panel pad="0" style={{ overflow: 'hidden' }}>
        <EditableTable rows={shown} isMobile={isMobile} onSave={onSave} onWithdraw={onWithdraw} empty="No attributes match." />
      </Panel>
    </Panel>
  )
}

// The bar above a listing's fields: how many edits are saved, and the button that sends them for approval.
export function EditsBar({ edits, marketplace, onSubmit, isMobile }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const by = (st) => (edits || []).filter(e => e.status === st).length
  const saved = by('proposed'), checking = by('submitted'), waiting = by('in_approval'), refused = by('refused')
  if (!saved && !checking && !waiting && !refused) return null
  const send = async () => { setBusy(true); setErr(''); try { await onSubmit() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  const bits = [checking && `${checking} with HQ for checks`, waiting && `${waiting} waiting for approval`, refused && `${refused} refused (see why below)`].filter(Boolean)
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', background: C.soft, borderRadius: 12, padding: isMobile ? '10px 12px' : '12px 16px', marginTop: 14 }}>
      <span style={{ flex: '1 1 260px', fontSize: 14 }}>
        {saved ? <b>{saved} edit{saved === 1 ? '' : 's'} saved for Amazon {marketplace}, not sent yet. </b> : null}
        {bits.join(' · ')}
        <span style={{ display: 'block', fontSize: 12.5, color: C.muted, marginTop: 2 }}>Sending runs HQ's checks and Amazon's own validation (which changes nothing), then puts an approval card in front of you. Nothing changes on Amazon until it is approved.</span>
      </span>
      {saved ? <button type="button" onClick={send} disabled={busy} style={{ ...btn(true), minHeight: 40, padding: '0 16px' }}>{busy ? 'Sending…' : `Send ${saved} for approval`}</button> : null}
      {err ? <p role="alert" style={{ margin: 0, flexBasis: '100%', fontSize: 13, color: C.bad }}>{err}</p> : null}
    </div>
  )
}
