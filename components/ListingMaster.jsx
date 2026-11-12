// The master listing (Jon 2026-11-12): one per ASIN, UK English copy, ONE attribute set for every market (keep or remove
// each), and an image list per market locale. The Master tab edits it; every market tab is scored against it.
import { useMemo, useState } from 'react'
import { C, Panel, H2, Note, Pill } from './approvals/renderers/reviewKit'
import { EditableTable } from './ListingContent'

export const ENGLISH = ['UK', 'US', 'CA', 'IE']
export const LOCALES = ['UK', 'US', 'CA', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'IE', 'PL', 'SE']
const COPY = [['title', 'Title'], ['bullet_1', 'Bullet 1'], ['bullet_2', 'Bullet 2'], ['bullet_3', 'Bullet 3'], ['bullet_4', 'Bullet 4'], ['bullet_5', 'Bullet 5'], ['description', 'Description'], ['search_terms', 'Search terms']]
export const COPY_KEY = Object.fromEntries(COPY.map(([k, l]) => [l, k]))
// Groups that are per market by nature (price, stock, images, variation structure): shown, never scored.
const NOT_SCORED = new Set(['offer', 'images', 'variations'])
const safeImg = (u) => (/^https:\/\/m\.media-amazon\.com\//i.test(String(u || '')) ? u : null)
const norm1 = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
// Lists (values joined with ' | ', e.g. barcodes) compare in any order.
export const norm = (v) => String(v ?? '').split(' | ').map(norm1).sort().join(' | ')

export const CHIPS = {
  match: { label: 'Matches master', bg: C.okBg, fg: C.ok },
  differs: { label: 'Differs from master', bg: C.warnBg, fg: C.warn },
  missing: { label: 'Missing', bg: C.badBg, fg: C.bad },
  remove: { label: 'Master says remove', bg: C.badBg, fg: C.bad },
  translate: { label: 'Check the translation', bg: C.blueBg, fg: C.blue },
  extra: { label: 'Not in the master', bg: C.grey, fg: C.muted },
  none: { label: 'No master value', bg: C.grey, fg: C.muted },
  info: { label: 'Per market', bg: C.grey, fg: C.muted },
}

/** One field or attribute compared with the master, for one market. */
export function compare(live, master, market, { keep = true } = {}) {
  const hasLive = live != null && String(live).trim() !== ''
  if (keep === false) return hasLive ? 'remove' : 'match'
  if (master == null || String(master).trim() === '') return hasLive ? 'none' : 'none'
  if (!hasLive) return 'missing'
  if (norm(live) === norm(master)) return 'match'
  if (!ENGLISH.includes(market) && /\p{L}/u.test(String(master))) return 'translate'
  return 'differs'
}

/** The copy rows of a market tab, with the master as "should be live". */
export function withMaster(rows, master, market) {
  if (!master) return rows
  return rows.map(r => {
    const k = COPY_KEY[r.name]
    if (!k) return r
    const m = (master.copy || {})[k] ?? null
    return { ...r, should: m, shouldMeta: ENGLISH.includes(market) ? 'Master (UK English)' : 'Master (UK English); this market needs the translated version', chip: CHIPS[compare(typeof r.live === 'string' ? r.live : null, m, market)] }
  })
}

// ─── Attributes, grouped the way Amazon groups them ─────────────────────────────
export function groupOf(ptd) {
  const by = {}
  for (const [key, g] of Object.entries((ptd && ptd.groups) || {})) for (const n of g.names || []) by[n] = { key, title: g.title || key }
  return by
}

/** Rows for a market's attributes against the master: every attribute either side, with group, Amazon name and chip. */
export function attributeRowsVsMaster({ live, master, ptd, titlesPtd, market, edits }) {
  const groups = groupOf(ptd)
  // Names in English everywhere (the UK definition), whatever the market.
  const titles = (titlesPtd && titlesPtd.titles) || (ptd && ptd.titles) || {}
  const req = new Set((ptd && ptd.required) || [])
  const byEdit = Object.fromEntries((edits || []).filter(e => e.kind === 'attribute' && e.status !== 'withdrawn').map(e => [e.name, e]))
  const liveBy = {}
  for (const a of live || []) { const r = liveBy[a.name] || { page: null, ours: null }; if (a.source === 'page') r.page = a.value; else r.ours = a.value; liveBy[a.name] = r }
  const mBy = Object.fromEntries(((master && master.attributes) || []).map(a => [a.name, a]))
  const names = [...new Set([...Object.keys(liveBy), ...Object.keys(mBy)])]
  const COPY_ATTRS = new Set(['item_name', 'bullet_point', 'product_description', 'generic_keyword'])
  return names.filter(n => !COPY_ATTRS.has(n)).map(name => {
    const l = liveBy[name] || {}
    const value = l.page ?? l.ours ?? null
    const g = groups[name] || { key: 'other', title: 'Other' }
    const m = mBy[name]
    const scored = !NOT_SCORED.has(g.key)
    const kind = !scored ? 'info' : !m ? (value ? 'extra' : 'none') : compare(value, m.value, market, { keep: m.keep !== false })
    return {
      key: `attribute:${name}`, kind: 'attribute', name, label: titles[name] || name.replace(/_/g, ' '), limit: [req.has(name) ? 'Required by Amazon' : null, name].filter(Boolean).join(' · '),
      live: value, liveMeta: l.page == null && l.ours != null ? 'Only on our listing (not on the live page)' : l.ours != null && l.page != null && norm(l.ours) !== norm(l.page) ? `Our listing says: ${l.ours}` : null,
      should: m ? (m.keep === false ? '(remove)' : m.value) : null, shouldMeta: m ? null : null, chip: CHIPS[kind], kindKey: kind,
      edit: byEdit[name] || null, editable: scored, group: g, required: req.has(name),
    }
  })
}

const ORDER = ['product_identity', 'product_details', 'safety_and_compliance', 'shipping', 'other', 'variations', 'offer', 'images']
export function GroupedTables({ rows, isMobile, onSave, onWithdraw, headers, openFirst = true }) {
  const groups = {}
  for (const r of rows) (groups[r.group.key] || (groups[r.group.key] = { title: r.group.title, rows: [] })).rows.push(r)
  const keys = Object.keys(groups).sort((a, b) => (ORDER.indexOf(a) < 0 ? 50 : ORDER.indexOf(a)) - (ORDER.indexOf(b) < 0 ? 50 : ORDER.indexOf(b)) || a.localeCompare(b))
  const bad = (g) => g.rows.filter(r => ['differs', 'missing', 'remove', 'translate', 'extra'].includes(r.kindKey)).length
  return keys.map((k, i) => <Group key={k} title={groups[k].title} rows={groups[k].rows} problems={bad(groups[k])} open={openFirst && (bad(groups[k]) > 0 || i === 0)} isMobile={isMobile} onSave={onSave} onWithdraw={onWithdraw} headers={headers} />)
}

function Group({ title, rows, problems, open: start, isMobile, onSave, onWithdraw, headers }) {
  const [open, setOpen] = useState(start)
  const sorted = rows.slice().sort((a, b) => Number(b.required) - Number(a.required) || a.label.localeCompare(b.label))
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, marginTop: 10, overflow: 'hidden', background: '#fff' }}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '10px 14px', background: C.bg, border: 0, cursor: 'pointer', font: "800 14px 'Nunito', sans-serif", color: C.ink, textAlign: 'left' }}>
        <span aria-hidden="true" style={{ color: C.indigo, width: 14 }}>{open ? '–' : '+'}</span>
        <span style={{ flex: 1 }}>{title}</span>
        <span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>{rows.length} attribute{rows.length === 1 ? '' : 's'}</span>
        {problems ? <span style={{ fontSize: 12, fontWeight: 800, borderRadius: 999, padding: '2px 9px', background: C.warnBg, color: C.warn }}>{problems} to fix</span> : null}
      </button>
      {open ? <EditableTable rows={sorted} isMobile={isMobile} onSave={onSave} onWithdraw={onWithdraw} headers={headers} /> : null}
    </div>
  )
}

// ─── Images: a filmstrip ─────────────────────────────────────────────────────
export function Filmstrip({ slots, expected, onOpen, size = 104, controls }) {
  const exp = Array.isArray(expected) ? expected : null
  if (!slots || !slots.length) return <Note style={{ margin: 0 }}>No images.</Note>
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {slots.map((im, i) => {
        const u = safeImg(im.url)
        const want = exp ? exp[i] : null
        const state = !exp ? null : !want ? 'extra' : want.url === im.url ? 'match' : 'differs'
        const ring = state === 'match' ? C.ok : state === 'differs' ? '#D98A1F' : state === 'extra' ? C.bad : C.line
        return (
          <figure key={`${im.slot}-${i}`} style={{ margin: 0, width: size }}>
            <button type="button" onClick={() => u && onOpen && onOpen(im)} title={im.slot} style={{ display: 'block', width: size, height: size, padding: 0, border: `2px solid ${ring}`, borderRadius: 8, background: '#fff', cursor: u ? 'zoom-in' : 'default', overflow: 'hidden' }}>
              {u ? <img src={u} alt={im.label || im.slot} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} /> : null}
            </button>
            <figcaption style={{ fontSize: 11, lineHeight: 1.3, marginTop: 3, color: C.muted, display: 'flex', justifyContent: 'space-between', gap: 4 }}>
              <b style={{ color: C.ink }}>{im.slot === 'MAIN' ? 'Main' : im.slot}</b>
              {state === 'match' ? <span style={{ color: C.ok }}>✓ master</span> : state === 'differs' ? <span style={{ color: C.warn }}>not master</span> : state === 'extra' ? <span style={{ color: C.bad }}>extra</span> : <span>{im.px || ''}</span>}
            </figcaption>
            {controls ? controls(i) : null}
          </figure>
        )
      })}
    </div>
  )
}

export function Lightbox({ im, onClose }) {
  if (!im) return null
  const u = safeImg(im.url)
  return (
    <div role="dialog" aria-modal="true" aria-label={im.slot || 'Image'} onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,12,40,.82)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, cursor: 'zoom-out' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 12, maxWidth: 'min(900px, 96vw)', maxHeight: '94vh', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <img src={u} alt={im.slot || 'Image'} style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }} />
        <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', fontSize: 14 }}>
          <b>{im.slot === 'MAIN' ? 'Main image' : im.slot}{im.px ? <span style={{ color: C.muted, fontWeight: 600 }}> · {im.px}</span> : null}</b>
          <span style={{ display: 'flex', gap: 12 }}>
            <a href={u} target="_blank" rel="noopener noreferrer" style={{ color: C.indigo, fontWeight: 800 }}>Open full size</a>
            <button type="button" onClick={onClose} style={{ background: 'none', border: 0, color: C.indigo, font: "800 14px 'Nunito', sans-serif", cursor: 'pointer' }}>Close</button>
          </span>
        </div>
      </div>
    </div>
  )
}

/** A market tab's images: what is live, against the master's set for this locale. */
export function MarketImages({ field, master, market, isMobile }) {
  const [big, setBig] = useState(null)
  const live = Array.isArray(field && field.live) ? field.live.filter(x => x && x.slot !== 'SWCH') : []
  const want = master && master.images ? master.images[market] || null : null
  const off = want ? live.filter((x, i) => !want[i] || want[i].url !== x.url).length + Math.max(0, want.length - live.length) : null
  return (
    <Panel pad={isMobile ? '14px' : undefined} style={{ marginTop: isMobile ? 0 : 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <H2 style={{ margin: 0 }}>Images on Amazon {market}</H2>
        {want ? <span style={{ fontSize: 13, fontWeight: 800, color: off ? C.warn : C.ok }}>{off ? `${off} slot${off === 1 ? '' : 's'} differ from the master` : 'Every slot matches the master'}</span> : <span style={{ fontSize: 13, color: C.muted }}>No master image set for {market} yet</span>}
      </div>
      {field && field.note ? <p style={{ margin: '8px 0 0', fontSize: 13, background: C.badBg, color: C.bad, borderRadius: 8, padding: '6px 10px' }}>{field.note}</p> : null}
      <div style={{ marginTop: 10 }}><Filmstrip slots={live} expected={want} onOpen={setBig} size={isMobile ? 84 : 104} /></div>
      {want ? (<>
        <p style={{ margin: '14px 0 6px', fontSize: 12, fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em' }}>Master images for {market}</p>
        <Filmstrip slots={want} onOpen={setBig} size={isMobile ? 70 : 84} />
      </>) : null}
      <Lightbox im={big} onClose={() => setBig(null)} />
    </Panel>
  )
}

// ─── The Master tab ──────────────────────────────────────────────────────────
// Identity fields (barcodes, brand, maker, model): never removable from the master, whatever Amazon requires.
const NEVER_REMOVE = new Set(['externally_assigned_product_identifier', 'merchant_suggested_asin', 'supplier_declared_has_product_identifier_exemption', 'brand', 'manufacturer', 'model_name', 'model_number', 'part_number', 'item_type_keyword'])
const STATUS = { seed: ['Started from the live UK listing: check it, edit it, then approve it', C.blueBg, C.blue], draft: ['Draft: edited, not yet approved', C.warnBg, C.warn], approved: ['Approved', C.okBg, C.ok] }

export function MasterView({ master, ptd, livePool, isMobile, onChange, onPlan, onSend }) {
  const [locale, setLocale] = useState('UK')
  const [big, setBig] = useState(null)
  const [picking, setPicking] = useState(false)
  const [err, setErr] = useState('')
  const run = async (body) => { setErr(''); try { await onChange(body) } catch (e) { setErr(e.message); throw e } }
  const pool = useMemo(() => {
    const seen = new Set(), out = []
    for (const im of [...Object.values((master && master.images) || {}).flat(), ...(livePool || [])]) if (im && im.url && !seen.has(im.url)) { seen.add(im.url); out.push(im) }
    return out
  }, [master, livePool])
  if (!master) return <Panel style={{ marginTop: 16 }}><H2>Master listing</H2><Note>No master for this ASIN yet. HQ seeds one from the live UK listing.</Note></Panel>
  const [label, bg, fg] = STATUS[master.status] || STATUS.seed
  const copyRows = COPY.map(([k, l]) => ({ key: `master:${k}`, kind: 'copy', name: k, label: l, live: (master.copy || {})[k] ?? null, should: null, editable: true,
    limit: k === 'title' ? '200 characters' : /^bullet/.test(k) ? '500 characters' : k === 'description' ? '2,000 characters' : '249 bytes', ...(k === 'title' ? { limitChars: 200 } : /^bullet/.test(k) ? { limitChars: 500 } : k === 'description' ? { limitChars: 2000 } : { limitBytes: 249 }) }))
  const groups = groupOf(ptd), titles = (ptd && ptd.titles) || {}, req = new Set((ptd && ptd.required) || [])
  const attrRows = ((master.attributes) || []).map(a => {
    const g = groups[a.name] || { key: 'other', title: 'Other' }
    return {
      key: `master-attr:${a.name}`, kind: 'attribute', name: a.name, label: titles[a.name] || a.name.replace(/_/g, ' '), limit: [req.has(a.name) ? 'Required by Amazon' : null, a.name].filter(Boolean).join(' · '),
      live: a.value, should: null, editable: a.keep !== false, group: g, required: req.has(a.name), kindKey: a.keep === false ? 'remove' : null,
      chip: a.keep === false ? CHIPS.remove : null,
      extra: req.has(a.name) ? <span style={{ fontSize: 12, color: C.muted }}>Required: kept everywhere</span> : NEVER_REMOVE.has(a.name) ? <span style={{ fontSize: 12, color: C.muted }}>Identity field: always kept</span> : (
        <button type="button" onClick={() => run({ asin: master.asin, op: 'keep', name: a.name, keep: a.keep === false })} style={{ minHeight: 30, padding: '0 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', color: a.keep === false ? C.indigo : C.bad, font: "800 12px 'Nunito', sans-serif", cursor: 'pointer' }}>{a.keep === false ? 'Keep it' : 'Remove from all markets'}</button>
      ),
    }
  })
  const imgs = (master.images || {})[locale] || []
  const setImgs = (slots) => run({ asin: master.asin, op: 'images', locale, slots: slots.map(x => ({ url: x.url })) })
  const move = (i, d) => { const s = imgs.slice(); const j = i + d; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; setImgs(s) }
  const ctl = (i) => (
    <span style={{ display: 'flex', gap: 2, marginTop: 2 }}>
      {[['◀', () => move(i, -1), 'Move left'], ['▶', () => move(i, 1), 'Move right'], ['✕', () => setImgs(imgs.filter((_, k) => k !== i)), 'Remove']].map(([t, f, a]) => <button key={a} type="button" onClick={f} aria-label={a} title={a} style={{ flex: 1, minHeight: 24, border: `1px solid ${C.line}`, borderRadius: 6, background: '#fff', color: a === 'Remove' ? C.bad : C.indigo, cursor: 'pointer', fontSize: 11 }}>{t}</button>)}
    </span>
  )
  const H = ['Field', 'Master (UK English)', 'Change it', 'State']
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', background: bg, color: fg, borderRadius: 12, padding: '10px 14px', marginTop: 16 }}>
        <b style={{ flex: '1 1 260px', fontSize: 14 }}>{label}{master.status === 'approved' && master.approved_by ? ` by ${master.approved_by}` : ''}</b>
        {master.status !== 'approved'
          ? <button type="button" onClick={() => run({ asin: master.asin, op: 'approve' })} style={{ minHeight: 38, padding: '0 16px', borderRadius: 8, border: 0, background: C.indigo, color: '#fff', font: "800 14px 'Nunito', sans-serif", cursor: 'pointer' }}>Approve the master</button>
          : <button type="button" onClick={() => run({ asin: master.asin, op: 'reopen' })} style={{ minHeight: 38, padding: '0 16px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', color: C.indigo, font: "800 14px 'Nunito', sans-serif", cursor: 'pointer' }}>Reopen for edits</button>}
      </div>
      {err ? <p role="alert" style={{ color: C.bad, fontSize: 13 }}>{err}</p> : null}
      {master.seeded_from ? <Note style={{ marginTop: 6 }}>Started from: {master.seeded_from}. Changes here are saved in PM; nothing goes to Amazon from the master yet.</Note> : null}

      <Panel pad="0" style={{ marginTop: 14, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 4px' }}><H2 style={{ margin: 0 }}>Copy (UK English, the source for every market)</H2></div>
        <EditableTable rows={copyRows} isMobile={isMobile} headers={H} onSave={(row, value) => run({ asin: master.asin, op: 'copy', field: row.name, value })} onWithdraw={async () => {}} />
      </Panel>

      <Panel pad={isMobile ? '14px' : undefined} style={{ marginTop: isMobile ? 0 : 20 }}>
        <H2>Images per market</H2>
        <div role="tablist" aria-label="Market" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {LOCALES.map(l => <Pill key={l} on={locale === l} onClick={() => { setLocale(l); setPicking(false) }} style={{ minHeight: 34 }}>{l}{((master.images || {})[l] || []).length ? '' : ' ·'}</Pill>)}
        </div>
        <Filmstrip slots={imgs} onOpen={setBig} size={isMobile ? 84 : 110} controls={ctl} />
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setPicking(!picking)} disabled={imgs.length >= 9} style={{ minHeight: 34, padding: '0 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', color: C.indigo, font: "800 13px 'Nunito', sans-serif", cursor: 'pointer' }}>{picking ? 'Done adding' : 'Add an image'}</button>
          {locale !== 'UK' && ((master.images || {}).UK || []).length ? <button type="button" onClick={() => setImgs((master.images || {}).UK)} style={{ minHeight: 34, padding: '0 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', color: C.indigo, font: "800 13px 'Nunito', sans-serif", cursor: 'pointer' }}>Use the UK set for {locale}</button> : null}
        </div>
        {picking ? (
          <div style={{ marginTop: 10, padding: 10, background: C.bg, borderRadius: 10 }}>
            <p style={{ margin: '0 0 8px', fontSize: 13, color: C.muted }}>Images already on Amazon for this product (any market). Click one to add it to the end of the {locale} set.</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {pool.map(im => <button key={im.url} type="button" onClick={() => setImgs([...imgs, im])} title="Add" style={{ width: 72, height: 72, padding: 0, border: `1px solid ${C.line}`, borderRadius: 6, background: '#fff', cursor: 'copy', overflow: 'hidden' }}><img src={safeImg(im.url)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /></button>)}
            </div>
          </div>
        ) : null}
        <Lightbox im={big} onClose={() => setBig(null)} />
      </Panel>

      <Panel pad={isMobile ? '14px' : undefined} style={{ marginTop: isMobile ? 0 : 20 }}>
        <H2>Attributes (one set for every market)</H2>
        <Note style={{ marginTop: 0 }}>Every market should carry these values (words in its own language). "Remove from all markets" marks an attribute Amazon does not require for removal everywhere.</Note>
        <GroupedTables rows={attrRows} isMobile={isMobile} headers={H} onSave={(row, value) => run({ asin: master.asin, op: 'attribute', name: row.name, value })} onWithdraw={async () => {}} />
      </Panel>
      <TranslationsPanel master={master} isMobile={isMobile} onChange={onChange} />
      <SendPanel master={master} isMobile={isMobile} onPlan={onPlan} onSend={onSend} />
    </div>
  )
}

// ─── A market tab's attributes, against the master ─────────────────────────────
const TO_FIX = new Set(['differs', 'missing', 'remove', 'translate', 'extra'])
export function MarketAttributes({ product, master, ptd, titlesPtd, market, edits, isMobile, onSave, onWithdraw }) {
  const [q, setQ] = useState('')
  const [only, setOnly] = useState(Boolean(master))
  const all = useMemo(() => attributeRowsVsMaster({ live: product.attributes, master, ptd, titlesPtd, market, edits }), [product.attributes, master, ptd, titlesPtd, market, edits])
  if (!Array.isArray(product.attributes)) return null
  const fix = all.filter(r => TO_FIX.has(r.kindKey) || r.edit)
  const shown = (only ? fix : all).filter(r => !q || `${r.name} ${r.label} ${r.live ?? ''} ${r.should ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  const v = product.variations || {}
  return (
    <Panel pad={isMobile ? '14px' : undefined} style={{ marginTop: isMobile ? 0 : 20 }}>
      <H2>Attributes on Amazon {market}</H2>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px', margin: '0 0 10px', fontSize: 14 }}>
        <dt style={{ color: C.muted }}>Category</dt><dd style={{ margin: 0 }}>{product.category || '–'}</dd>
        <dt style={{ color: C.muted }}>Variations</dt>
        <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{[v.theme && `by ${String(v.theme).toLowerCase().replace(/_/g, ' ')}`, (v.parent_asins || []).length ? `parent ${v.parent_asins.join(', ')}` : null, (v.child_asins || []).length ? `${v.child_asins.length} children` : null].filter(Boolean).join(' · ') || 'None'}</dd>
      </dl>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search attributes" aria-label="Search attributes" style={{ flex: '1 1 220px', minHeight: 40, border: `1px solid ${C.border}`, borderRadius: 10, padding: '0 12px', font: "600 14px 'Nunito', sans-serif" }} />
        <Pill on={only} onClick={() => setOnly(true)} style={{ minHeight: 40 }}>To fix ({fix.length})</Pill>
        <Pill on={!only} onClick={() => setOnly(false)} style={{ minHeight: 40 }}>All ({all.length})</Pill>
      </div>
      {!master ? <Note>No master for this product yet, so nothing is scored.</Note> : null}
      {shown.length ? <GroupedTables rows={shown} isMobile={isMobile} onSave={onSave} onWithdraw={onWithdraw} headers={['Attribute', `Live on Amazon ${market}`, 'Master', 'State']} /> : <Note>{only ? 'Nothing to fix here: every attribute matches the master.' : 'No attributes match.'}</Note>}
    </Panel>
  )
}

// ─── Translations (one per non-English market) ───────────────────────────────
export const LANG_MARKETS = { DE: 'German', FR: 'French', ES: 'Spanish', IT: 'Italian', NL: 'Dutch', BE: 'French (Belgium)', PL: 'Polish', SE: 'Swedish' }
const ttl = { margin: '0 0 2px', fontSize: 12, fontWeight: 800, color: C.muted }
const sbtn = (p) => ({ minHeight: 32, padding: '0 10px', borderRadius: 8, border: `1px solid ${p ? C.indigo : C.border}`, background: p ? C.indigo : '#fff', color: p ? '#fff' : C.indigo, font: "800 12.5px 'Nunito', sans-serif", cursor: 'pointer' })

function TransRow({ label, english, value, onSave }) {
  const [edit, setEdit] = useState(false)
  const [v, setV] = useState(value || '')
  const [busy, setBusy] = useState(false)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 160px) minmax(0, 1fr) minmax(0, 1fr) auto', gap: 12, padding: '10px 0', borderTop: `1px solid ${C.line2}`, fontSize: 13.5, lineHeight: 1.45, alignItems: 'start' }}>
      <b>{label}</b>
      <span style={{ color: C.muted, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{english || '–'}</span>
      {edit
        ? <textarea value={v} onChange={e => setV(e.target.value)} rows={Math.min(8, Math.max(2, Math.ceil(v.length / 60)))} aria-label={`Translation of ${label}`} style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${C.indigo}`, borderRadius: 8, padding: '6px 8px', font: "600 13.5px/1.45 'Nunito', sans-serif" }} />
        : <span style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{value || <span style={{ color: C.muted }}>–</span>}</span>}
      <span style={{ display: 'flex', gap: 6 }}>
        {edit
          ? <><button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await onSave(v); setEdit(false) } finally { setBusy(false) } }} style={sbtn(true)}>Save</button><button type="button" onClick={() => { setV(value || ''); setEdit(false) }} style={sbtn(false)}>Cancel</button></>
          : <button type="button" onClick={() => { setV(value || ''); setEdit(true) }} style={sbtn(false)}>Edit</button>}
      </span>
    </div>
  )
}

export function TranslationsPanel({ master, isMobile, onChange }) {
  const [loc, setLoc] = useState('DE')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const v = (master.variants || {})[loc] || null
  const call = async (body) => { setErr(''); setBusy(true); try { await onChange({ asin: master.asin, locale: loc, ...body }) } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  const words = (master.attributes || []).filter(a => a.keep !== false && v && v.attributes && a.name in v.attributes)
  return (
    <Panel pad={isMobile ? '14px' : undefined} style={{ marginTop: isMobile ? 0 : 20 }}>
      <H2>Translations</H2>
      <Note style={{ marginTop: 0 }}>Each non-English market is built from the UK English master. Translate it, check it, then approve it: your approval is the language review HQ needs before anything is sent to that market.</Note>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0 10px' }}>
        {Object.entries(LANG_MARKETS).map(([k]) => {
          const s = ((master.variants || {})[k] || {}).status
          return <Pill key={k} on={loc === k} onClick={() => setLoc(k)} style={{ minHeight: 34 }}>{k}{s === 'approved' ? ' ✓' : s === 'draft' ? ' ·' : ''}</Pill>
        })}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: C.bg, borderRadius: 10, padding: '8px 12px' }}>
        <span style={{ flex: '1 1 260px', fontSize: 13.5 }}>
          <b>{LANG_MARKETS[loc]} for Amazon {loc}: </b>
          {!v ? 'not translated yet.' : v.status === 'approved' ? `approved by ${v.approved_by}.` : `translated${v.model ? ` by ${v.model}` : ''}, waiting for your check.`}
          {v && v.cost_usd != null ? <span style={{ color: C.muted }}> (cost ${Number(v.cost_usd).toFixed(3)})</span> : null}
        </span>
        <button type="button" disabled={busy || !master.copy || !master.copy.title} onClick={() => call({ op: 'translate' })} style={sbtn(!v)}>{busy ? 'Working…' : v ? 'Translate again' : 'Translate with Claude (about $0.07)'}</button>
        {v && v.status !== 'approved' ? <button type="button" disabled={busy} onClick={() => call({ op: 'variant_approve' })} style={sbtn(true)}>Approve the {LANG_MARKETS[loc]}</button> : null}
      </div>
      {err ? <p role="alert" style={{ color: C.bad, fontSize: 13 }}>{err}</p> : null}
      {v ? (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 160px) minmax(0, 1fr) minmax(0, 1fr) auto', gap: 12, padding: '6px 0' }}>
            <span style={ttl}>Field</span><span style={ttl}>UK English (master)</span><span style={ttl}>{LANG_MARKETS[loc]}</span><span />
          </div>
          {COPY.map(([k, l]) => <TransRow key={`${loc}-${k}`} label={l} english={(master.copy || {})[k]} value={(v.copy || {})[k]} onSave={(value) => call({ op: 'variant_copy', field: k, value })} />)}
          {words.map(a => <TransRow key={`${loc}-a-${a.name}`} label={a.name.replace(/_/g, ' ')} english={a.value} value={v.attributes[a.name]} onSave={(value) => call({ op: 'variant_attr', name: a.name, value })} />)}
        </div>
      ) : null}
    </Panel>
  )
}

// ─── Send the master to the markets ──────────────────────────────────────────
export function SendPanel({ master, isMobile, onPlan, onSend }) {
  const [plans, setPlans] = useState(null)
  const [pick, setPick] = useState({})
  const [open, setOpen] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)
  if (master.status !== 'approved') return (
    <Panel pad={isMobile ? '14px' : undefined} style={{ marginTop: isMobile ? 0 : 20 }}><H2>Send to the markets</H2><Note>Approve the master first. Then you can see, market by market, what changes to match it, and send those changes for approval.</Note></Panel>
  )
  const plan = async () => {
    setErr(''); setBusy(true); setDone(null)
    try { const r = await onPlan(); setPlans(r.plans); setPick(Object.fromEntries(r.plans.filter(p => p.changes.length).map(p => [p.market, true]))) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const chosen = Object.keys(pick).filter(k => pick[k])
  const send = async () => {
    setErr(''); setBusy(true)
    try { const r = await onSend(chosen); setDone(r); setPlans(null) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const short = (x) => { const s = String(x ?? ''); return !s ? '(none)' : /^https:\/\/m\.media-amazon/.test(s) ? 'image' : s.length > 70 ? `${s.slice(0, 67)}…` : s }
  return (
    <Panel pad={isMobile ? '14px' : undefined} style={{ marginTop: isMobile ? 0 : 20 }}>
      <H2>Send to the markets</H2>
      <Note style={{ marginTop: 0 }}>Work out what each market must change to match this master. Sending turns those changes into approval cards, one per market, after HQ's checks and Amazon's own validation. Nothing reaches Amazon until each card is approved.</Note>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <button type="button" onClick={plan} disabled={busy} style={sbtn(!plans)}>{busy && !plans ? 'Working it out…' : plans ? 'Work it out again' : 'Work out the changes'}</button>
        {plans ? <button type="button" onClick={send} disabled={busy || !chosen.length} style={sbtn(true)}>{busy ? 'Sending…' : `Send ${chosen.length} market${chosen.length === 1 ? '' : 's'} for approval`}</button> : null}
      </div>
      {err ? <p role="alert" style={{ color: C.bad, fontSize: 13 }}>{err}</p> : null}
      {done ? <p style={{ background: C.okBg, color: C.ok, borderRadius: 8, padding: '8px 12px', fontSize: 13.5, fontWeight: 700 }}>Sent {done.sent} change{done.sent === 1 ? '' : 's'} to {done.markets.filter(m => m.sent).map(m => m.market).join(', ') || 'no market'}. HQ checks them within the hour; each market's tab then shows its approval card.</p> : null}
      {plans ? (
        <div style={{ marginTop: 12 }}>
          {plans.map(p => (
            <div key={p.market} style={{ borderTop: `1px solid ${C.line2}`, padding: '8px 0' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="checkbox" checked={!!pick[p.market]} disabled={!p.changes.length} onChange={e => setPick(x => ({ ...x, [p.market]: e.target.checked }))} aria-label={`Send to Amazon ${p.market}`} />
                <b style={{ width: 90 }}>Amazon {p.market}</b>
                <span style={{ fontSize: 13.5, flex: 1 }}>{p.blocked ? <span style={{ color: C.muted }}>{p.blocked}</span> : p.changes.length ? `${p.changes.length} change${p.changes.length === 1 ? '' : 's'}` : 'Already matches the master'}{p.skipped.length ? <span style={{ color: C.warn }}> · {p.skipped.length} not sent yet</span> : null}</span>
                {p.changes.length || p.skipped.length ? <button type="button" onClick={() => setOpen(o => ({ ...o, [p.market]: !o[p.market] }))} style={sbtn(false)}>{open[p.market] ? 'Hide' : 'Show'}</button> : null}
              </div>
              {open[p.market] ? (
                <ul style={{ margin: '6px 0 0 26px', padding: 0, fontSize: 13, lineHeight: 1.5 }}>
                  {p.changes.map(c => <li key={c.name}><b>{c.label}</b>: {c.remove ? <span style={{ color: C.bad }}>remove ({short(c.from)})</span> : <>{short(c.from)} → {short(c.to)}</>}</li>)}
                  {p.skipped.map(s => <li key={`s-${s.name}`} style={{ color: C.warn }}><b>{s.name}</b>: not sent, {s.why}</li>)}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </Panel>
  )
}
