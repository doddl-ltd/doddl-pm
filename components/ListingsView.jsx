// Amazon listings (boards Listings / ListingsPhone, ListingDiff / ListingDiffPhone): live vs should be live.
// GET /api/listings for the matrix, GET /api/listings/:asin/:marketplace for one listing field by field
// (opened in place). An open listing_change approval for a listing is linked via onOpenApproval.
import { useEffect, useMemo, useState } from 'react'
import { apiFetch, supabase } from '../lib/supabase'
import { C, Panel, H2, Lbl, Note, Chip, Pill, Pills, Tick, Btn, StateLine, fmtDay, fmtWhen } from './approvals/renderers/reviewKit'
import { FIELD_STATUS, ImageCompare, differs } from './approvals/renderers/ListingChangeReview'
import { AplusPanel, AttributesPanel, ImagesGallery, EditableTable, fieldRows } from './ListingContent'

// Matrix columns; Bullets rolls up Bullet 1–5.
const COLS = [
  ['Title', ['Title']], ['Bullets', ['Bullet 1', 'Bullet 2', 'Bullet 3', 'Bullet 4', 'Bullet 5']], ['Description', ['Description']],
  ['Search terms', ['Search terms']], ['Images', ['Images']], ['A+', ['A+ content']], ['Price', ['Price']], ['Variations', ['Variations']],
  ['Category', ['Category']], ['Age range', ['Age range']], ['Safety', ['Safety documents']], ['Buy Box', ['Buy Box']],
]
const RANK = ['problem', 'drift', 'in_flight', 'proposed', 'match', 'na']
const worst = (list) => list.filter(Boolean).sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0] || null
const OVERALL = {
  match: ['Matches', C.okBg, C.ok], drift: ['Drifted', C.warnBg, C.warn], in_flight: ['On its way', C.blueBg, C.blue],
  proposed: ['Change proposed', C.soft, C.indigo], problem: ['Problem', C.badBg, C.bad],
}
const DOT = { match: '#BFE3CB', drift: '#F0B867', in_flight: '#8FB5E3', proposed: '#C9B6F2', problem: '#E38F8F', na: '#E4E0EE' }
const WORD = { drift: 'differs', in_flight: 'on its way', proposed: 'change proposed', problem: 'missing or blocked' }
const nameOf = (r) => [r.product || r.asin, r.colour].filter(Boolean).join(' · ')
const keyOf = (r) => `${r.asin}|${r.marketplace}`
// One global listing per ASIN; its marketplaces in this order.
const MARKET_ORDER = ['UK', 'US', 'CA', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'IE', 'PL', 'SE']
const mOrder = (m) => { const i = MARKET_ORDER.indexOf(m); return i < 0 ? 99 : i }
const OVERALL_RANK = ['problem', 'drift', 'in_flight', 'proposed', 'match']
const worstOverall = (list) => list.slice().sort((a, b) => OVERALL_RANK.indexOf(a) - OVERALL_RANK.indexOf(b))[0] || 'match'
export function groupByAsin(rows) {
  const m = new Map()
  for (const r of rows) (m.get(r.asin) || m.set(r.asin, []).get(r.asin)).push(r)
  return [...m.entries()].map(([asin, rs]) => {
    rs.sort((a, b) => mOrder(a.marketplace) - mOrder(b.marketplace))
    const lead = rs.find(r => r.marketplace === 'UK') || rs.find(r => r.marketplace === 'US') || rs[0]
    const cells = {}
    for (const [label, fs] of COLS) cells[label] = worst(rs.flatMap(r => fs.map(f => r.cells && r.cells[f])))
    return { asin, rows: rs, lead, name: nameOf(lead), skus: [...new Set(rs.flatMap(r => String(r.sku || '').split(', ')).filter(Boolean))], overall: worstOverall(rs.map(r => r.overall)), cells, edits: rs.reduce((n, r) => n + (r.edits || 0), 0) }
  }).sort((a, b) => a.name.localeCompare(b.name) || a.asin.localeCompare(b.asin))
}
function MarketChips({ rows, onPick, small }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {rows.map(r => (
        <button key={r.marketplace} type="button" onClick={(e) => { e.stopPropagation(); onPick(r) }} title={`Amazon ${r.marketplace}: ${(OVERALL[r.overall] || OVERALL.match)[0]}${r.listing_status ? ` · ${r.listing_status}` : ''}`}
          style={{ minWidth: small ? 30 : 34, minHeight: small ? 26 : 28, padding: '0 6px', borderRadius: 6, border: 0, background: DOT[r.overall] || DOT.na, color: C.ink, font: "800 11px 'Nunito', sans-serif", cursor: 'pointer' }}>{r.marketplace}</button>
      ))}
    </span>
  )
}

function overallChip(r) {
  const [label, bg, fg] = OVERALL[r.overall] || OVERALL.match
  return <Chip bg={bg} fg={fg}>{r.overall === 'drift' && r.drifted ? `${label} ${r.drifted}` : label}</Chip>
}

function Sym({ status, field }) {
  if (!status) return <span title={`${field}: not checked`} style={{ color: C.faint }}>·</span>
  const s = FIELD_STATUS[status] || FIELD_STATUS.na
  return <span title={`${field}: ${s.label}`} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 30, height: 26, borderRadius: 7, fontSize: 12, fontWeight: 800, padding: '0 6px', background: s.bg, color: s.fg }}>{s.sym}</span>
}

function useWeekEvents() {
  const [events, setEvents] = useState(null)
  useEffect(() => {
    let live = true
    const since = new Date(Date.now() - 7 * 86400_000).toISOString()
    supabase.from('listing_events').select('asin, marketplace, at, text, kind').gte('at', since).order('at', { ascending: false }).limit(20)
      .then(({ data, error }) => { if (live) setEvents(error ? [] : data || []) }, () => { if (live) setEvents([]) })
    return () => { live = false }
  }, [])
  return events
}

function Detail({ sel, rows, isMobile, onBack, onSelect, onOpenApproval }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [onlyDiff, setOnlyDiff] = useState(isMobile)
  const load = async () => {
    const r = await apiFetch(`/api/listings/${encodeURIComponent(sel.asin)}/${encodeURIComponent(sel.marketplace)}`)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `Could not load the listing (${r.status})`)
    return j
  }
  // Edits are saved in PM as proposed changes; nothing is sent to Amazon from this screen.
  const saveEdit = async (row, value) => {
    const r = await apiFetch('/api/listings/edits', { method: 'POST', body: JSON.stringify({ asin: sel.asin, marketplace: sel.marketplace, kind: row.kind, name: row.name, value, live: row.live ?? null }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `Could not save the edit (${r.status})`)
    setData(await load())
  }
  const withdrawEdit = async (row) => {
    const r = await apiFetch(`/api/listings/edits?id=${encodeURIComponent(row.edit.id)}`, { method: 'PATCH' })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setError(j.error || `Could not remove the edit (${r.status})`); return }
    setData(await load())
  }
  useEffect(() => {
    let live = true
    setData(null); setError('')
    ;(async () => {
      try {
        const r = await apiFetch(`/api/listings/${encodeURIComponent(sel.asin)}/${encodeURIComponent(sel.marketplace)}`)
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || `Could not load the listing (${r.status})`)
        if (live) setData(j)
      } catch (e) { if (live) setError(e.message) }
    })()
    return () => { live = false }
  }, [sel.asin, sel.marketplace])

  const siblings = rows.filter(r => r.asin === sel.asin).sort((a, b) => mOrder(a.marketplace) - mOrder(b.marketplace))
  const p = (data && data.product) || sel
  const fields = (data && data.fields) || []
  const diff = fields.filter(f => differs(f.status))
  const edits = (data && data.edits) || []
  const shown = onlyDiff ? fields.filter(f => differs(f.status) || edits.some(e => e.kind === 'field' && e.name === f.field)) : fields
  const img = fields.find(f => f.field === 'Images')
  const openApproval = ((data && data.approvals) || []).find(a => !a.decision)
  const events = (data && data.events) || []

  const tabs = siblings.length > 1 ? (isMobile
    ? <Pills label="Market">{siblings.map(r => <Pill key={keyOf(r)} on={keyOf(r) === keyOf(sel)} onClick={() => onSelect(r)}>Amazon {r.marketplace}</Pill>)}</Pills>
    : (
      <div role="tablist" style={{ display: 'flex', gap: 22, borderBottom: `1px solid ${C.line}`, marginTop: 18, flexWrap: 'wrap' }}>
        {siblings.map(r => {
          const on = keyOf(r) === keyOf(sel)
          return <button key={keyOf(r)} role="tab" aria-selected={on} type="button" onClick={() => onSelect(r)} style={{ background: 'none', border: 0, borderBottom: `3px solid ${on ? C.indigo : 'transparent'}`, font: "800 14px 'Nunito', sans-serif", color: on ? C.indigo : C.muted, padding: '0 4px', minHeight: 44, cursor: 'pointer' }}>Amazon {r.marketplace}</button>
        })}
      </div>
    )) : null

  const tiles = [
    [`Listing status on ${p.marketplace}`, p.listing_status || '–', /active|buyable/i.test(p.listing_status || '') ? C.ok : C.ink],
    ['Fields that differ', `${diff.length} of ${fields.length}`, diff.length ? C.warn : C.ok],
    ['Buy Box', p.buy_box || '–', C.ink],
    ['Should-be-live source', p.should_source || '–', C.ink],
  ]
  const banner = openApproval ? (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', background: C.soft, borderRadius: 12, padding: '10px 14px', marginTop: 14 }}>
      <span style={{ fontSize: 14, fontWeight: 700, flex: '1 1 240px' }}>A change for this listing is waiting for approval{openApproval.title ? `: ${openApproval.title}` : ''}.</span>
      {onOpenApproval ? <Btn primary onClick={() => onOpenApproval(openApproval.id)}>Open the approval</Btn> : null}
    </div>
  ) : null

  const body = data ? (<>
    {isMobile
      ? <Tick checked={onlyDiff} onChange={setOnlyDiff}>Only fields that differ</Tick>
      : (
        <div role="group" aria-label="Show" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          <Pill on={!onlyDiff} onClick={() => setOnlyDiff(false)} style={{ minHeight: 40 }}>Every field</Pill>
          <Pill on={onlyDiff} onClick={() => setOnlyDiff(true)} style={{ minHeight: 40 }}>Only what differs</Pill>
        </div>
      )}
    {isMobile
      ? <EditableTable rows={fieldRows(shown, edits)} isMobile onSave={saveEdit} onWithdraw={withdrawEdit} empty="No fields to show." />
      : <Panel pad="0" style={{ marginTop: 12, overflow: 'hidden' }}><EditableTable rows={fieldRows(shown, edits)} onSave={saveEdit} onWithdraw={withdrawEdit} empty="No fields to show." /></Panel>}
    <Note style={{ marginTop: 8 }}>Edits are saved in PM as proposed changes. Nothing is sent to Amazon from this screen.</Note>
    <ImagesGallery field={img} isMobile={isMobile} />
    {img && Array.isArray(img.should) && img.should.length ? (
      <Panel pad={isMobile ? '14px' : undefined} style={{ marginTop: isMobile ? 0 : 20 }}>
        <H2>Images: live vs should be live</H2>
        <ImageCompare live={Array.isArray(img.live) ? img.live : []} should={Array.isArray(img.should) ? img.should : []} isMobile={isMobile} sourceNote={img.should_meta} />
        {img.note ? <Note style={{ marginTop: 10 }}>{img.note}</Note> : null}
      </Panel>
    ) : null}
    <AplusPanel product={p} isMobile={isMobile} />
    <AttributesPanel product={p} edits={edits} isMobile={isMobile} onSave={saveEdit} onWithdraw={withdrawEdit} />
    <Panel pad={isMobile ? '14px' : undefined} style={{ marginTop: isMobile ? 0 : 20 }}>
      <H2>History</H2>
      {events.length ? events.map((e, i) => (
        <div key={e.id || i} style={{ display: 'flex', gap: 12, padding: '8px 0', borderTop: i ? '1px solid #F1EEF6' : 0, fontSize: 13, lineHeight: 1.45 }}>
          <span style={{ flex: 'none', width: 80, color: C.muted, fontWeight: 700 }}>{fmtDay(e.at, { day: 'numeric', month: 'short' })}</span><span>{e.text}</span>
        </div>
      )) : <Note>No history yet.</Note>}
    </Panel>
  </>) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 0 }}>
      <button type="button" onClick={onBack} style={{ alignSelf: 'flex-start', background: 'none', border: 0, padding: 0, font: "800 14px 'Nunito', sans-serif", color: C.indigo, cursor: 'pointer', minHeight: 44 }}>‹ Amazon listings</button>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Chip bg={C.plumBg} fg={C.plum}>Amazon listing</Chip>
        {sel.overall ? overallChip(sel) : null}
      </div>
      <h1 style={{ margin: isMobile ? 0 : '12px 0 4px', fontSize: isMobile ? 22 : 28, fontWeight: 800, lineHeight: 1.25 }}>{nameOf(p)}</h1>
      <p style={{ margin: 0, color: C.muted, fontSize: isMobile ? 13 : 14 }}>
        {[`ASIN ${p.asin}`, p.sku && `SKU ${p.sku}`, p.parent_asin && `parent ${p.parent_asin}`, p.checked_at && `last read from Amazon ${fmtWhen(p.checked_at)}`].filter(Boolean).join(' · ')}
      </p>
      {tabs}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: isMobile ? 8 : 12, marginTop: isMobile ? 0 : 16 }}>
        {(isMobile ? tiles.slice(0, 2) : tiles).map(([k, v, col]) => (
          <Panel key={k} pad={isMobile ? '10px 12px' : '12px 16px'}>
            <Lbl>{k}</Lbl>
            <p style={{ margin: '4px 0 0', fontSize: k === 'Should-be-live source' ? 14 : isMobile ? 15 : 18, fontWeight: 800, color: col }}>{v}</p>
          </Panel>
        ))}
      </div>
      {banner}
      <StateLine loading={!data && !error} error={error} />
      {body}
    </div>
  )
}

export default function ListingsView({ user, isMobile, onOpenApproval }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [market, setMarket] = useState('all')
  const [attention, setAttention] = useState(null) // null = the board's default per layout
  const [sel, setSel] = useState(null)
  const [find, setFind] = useState('')
  const [open, setOpen] = useState({})
  const events = useWeekEvents()

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const r = await apiFetch('/api/listings')
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || `Could not load the listings (${r.status})`)
        if (live) setData(j)
      } catch (e) { if (live) setError(e.message) }
    })()
    return () => { live = false }
  }, [])

  const rows = (data && data.listings) || []
  const markets = (data && data.marketplaces) || []
  const counts = (data && data.counts) || {}
  const att = attention == null ? isMobile : attention
  // Search by ASIN, stock code (SKU) or product title (our short name or the live Amazon title).
  const words = find.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const hit = (r) => !words.length || words.every(w => [r.asin, r.sku, r.product, r.title, r.colour].filter(Boolean).join(' ').toLowerCase().includes(w))
  const shown = rows.filter(r => (market === 'all' || r.marketplace === market) && (!att || r.overall !== 'match') && hit(r))
  const searchBox = (
    <input type="search" value={find} onChange={e => setFind(e.target.value)} placeholder="Search by ASIN, stock code or product title" aria-label="Search listings by ASIN, stock code or product title"
      style={{ width: '100%', maxWidth: isMobile ? 'none' : 520, boxSizing: 'border-box', minHeight: 44, border: `1px solid ${C.border}`, borderRadius: 10, padding: '0 14px', font: "600 15px 'Nunito', sans-serif", background: '#fff' }} />
  )
  const byKey = useMemo(() => Object.fromEntries(rows.map(r => [keyOf(r), r])), [rows])
  // A global listing (ASIN) shows when any of its market rows is shown; search matches the whole ASIN.
  const allGroups = useMemo(() => groupByAsin(rows), [rows])
  const groups = allGroups.map(g => {
    const any = words.length ? g.rows.some(hit) : true
    const rs = g.rows.filter(r => (market === 'all' || r.marketplace === market) && (!att || r.overall !== 'match'))
    return any && rs.length ? { ...g, shown: rs } : null
  }).filter(Boolean)
  const asins = allGroups.length

  const wrap = (children) => <div style={{ padding: isMobile ? '4px 4px 16px' : '4px 16px 40px', color: C.ink, fontFamily: "'Nunito', sans-serif" }}>{children}</div>
  if (sel) return wrap(<Detail sel={sel} rows={rows} isMobile={isMobile} onBack={() => setSel(null)} onSelect={setSel} onOpenApproval={onOpenApproval} />)

  const tiles = [
    ['Global listings', asins, C.ink, `${asins} ASIN${asins === 1 ? '' : 's'} across ${markets.length} market${markets.length === 1 ? '' : 's'} (${rows.length} market listings)`],
    ['Match', counts.match || 0, C.ok, 'Live is exactly what should be live'],
    ['Drifted', counts.drift || 0, C.warn, 'Amazon or another seller changed a field'],
    ['Change on its way', counts.in_flight || 0, C.blue, 'Approved, sent, Amazon still processing'],
    ['Problem', counts.problem || 0, C.bad, 'Suppressed, missing or no Buy Box'],
  ]
  const toLook = (m) => rows.filter(r => (m === 'all' || r.marketplace === m) && r.overall !== 'match').length

  const eventsPanel = (
    <Panel pad={isMobile ? '14px' : '18px 20px'} style={{ flex: '1 1 480px' }}>
      <H2 style={{ fontSize: isMobile ? 17 : 18 }}>{isMobile ? 'Changed on Amazon this week' : 'What changed on Amazon this week'}</H2>
      {events == null ? <Note>Loading…</Note> : events.length ? events.map((e, i) => {
        const r = byKey[keyOf(e)]
        return (
          <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 0', borderTop: i ? '1px solid #F1EEF6' : 0, fontSize: 14, lineHeight: 1.45 }}>
            <span style={{ flex: 'none', width: isMobile ? 64 : 92, color: C.muted, fontSize: 13, fontWeight: 700 }}>{fmtDay(e.at)}</span>
            <span><b>{r ? `${nameOf(r)} · ${e.marketplace}` : `${e.asin} · ${e.marketplace}`}</b>: {e.text}</span>
          </div>
        )
      }) : <Note>Nothing changed this week.</Note>}
    </Panel>
  )

  if (isMobile) {
    return wrap(
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, lineHeight: 1.25, fontWeight: 800 }}>Amazon listings: live vs should be live</h1>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: C.muted }}>Any gap between what shoppers see and what you approved shows here.</p>
        </div>
        <StateLine loading={!data && !error} error={error} />
        {data ? (<>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            {tiles.slice(1).map(([k, n, col]) => (
              <div key={k} style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: '10px 12px' }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: C.muted, textTransform: 'uppercase' }}>{k}</p>
                <p style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 800, color: col }}>{n}</p>
              </div>
            ))}
          </div>
          {searchBox}
          <Pills label="Market">{['all', ...markets].map(m => <Pill key={m} on={market === m} onClick={() => setMarket(m)}>{m === 'all' ? 'All markets' : m}</Pill>)}</Pills>
          <Tick checked={att} onChange={setAttention}>Only listings that need attention</Tick>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {groups.length ? groups.map(g => {
              const ks = COLS.map(([label]) => g.cells[label] || 'na')
              const odd = COLS.map(([label], i) => (WORD[ks[i]] ? `${label} ${WORD[ks[i]]}` : null)).filter(Boolean)
              return (
                <div key={g.asin} role="button" tabIndex={0} onClick={() => setSel(g.shown[0])} onKeyDown={(e) => { if (e.key === 'Enter') setSel(g.shown[0]) }} style={{ display: 'block', width: '100%', textAlign: 'left', background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, color: C.ink, cursor: 'pointer', boxSizing: 'border-box' }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                    <span><span style={{ display: 'block', fontSize: 15, fontWeight: 800 }}>{g.name}</span><span style={{ display: 'block', fontSize: 13, color: C.muted }}>ASIN {g.asin} · {g.rows.length} market{g.rows.length === 1 ? '' : 's'}</span></span>
                    {overallChip({ overall: g.overall })}
                  </span>
                  <span style={{ display: 'block', marginTop: 8 }}><MarketChips rows={g.shown} onPick={setSel} small /></span>
                  <span aria-hidden="true" style={{ display: 'flex', gap: 3, marginTop: 8 }}>{ks.map((k, i) => <span key={i} style={{ flex: 1, height: 8, borderRadius: 3, background: DOT[k] }} />)}</span>
                  <span style={{ display: 'block', marginTop: 6, fontSize: 13, color: C.body }}>{odd.length ? odd.join(' · ') : 'Every field matches'}</span>
                </div>
              )
            }) : <Note style={{ fontSize: 14 }}>{rows.length ? 'Nothing needs attention here.' : 'No listings are being watched yet.'}</Note>}
          </div>
          {eventsPanel}
        </>) : null}
      </div>,
    )
  }

  return wrap(<>
    <Lbl style={{ margin: '0 0 6px' }}>Checked against Amazon every morning</Lbl>
    <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: '-0.01em' }}>Amazon listings: live vs should be live</h1>
    <p style={{ margin: '6px 0 0', color: C.muted, fontSize: 15, maxWidth: 820 }}>“Should be live” is the approved version: the product fact sheet plus every listing change you have approved. “Live” is what Amazon shows shoppers today. Any gap shows here, field by field.</p>
    <StateLine loading={!data && !error} error={error} />
    {data ? (<>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12, marginTop: 22 }}>
        {tiles.map(([k, n, col, sub]) => (
          <Panel key={k} pad="14px 16px">
            <Lbl>{k}</Lbl>
            <p style={{ margin: '4px 0 0', fontSize: 26, fontWeight: 800, color: col }}>{n}</p>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: C.muted }}>{sub}</p>
          </Panel>
        ))}
      </div>
      <div style={{ marginTop: 22 }}>{searchBox}{words.length ? <span style={{ marginLeft: 12, fontSize: 14, color: C.muted }}>{groups.length} ASIN{groups.length === 1 ? '' : 's'} found</span> : null}</div>
      <div role="tablist" style={{ display: 'flex', gap: 22, borderBottom: `1px solid ${C.line}`, marginTop: 14, flexWrap: 'wrap' }}>
        {['all', ...markets].map(m => {
          const on = market === m
          return (
            <button key={m} type="button" role="tab" aria-selected={on} onClick={() => setMarket(m)} style={{ background: 'none', border: 0, borderBottom: `3px solid ${on ? C.indigo : 'transparent'}`, font: "800 14px 'Nunito', sans-serif", color: on ? C.indigo : C.muted, padding: '0 4px', minHeight: 44, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {m === 'all' ? 'All markets' : m} <span style={{ background: C.soft, color: C.indigo, borderRadius: 999, fontSize: 12, padding: '0 8px' }}>{toLook(m)} to look at</span>
            </button>
          )
        })}
      </div>
      <div role="group" aria-label="Show" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
        <Pill on={!att} onClick={() => setAttention(false)} style={{ minHeight: 40 }}>Every listing</Pill>
        <Pill on={att} onClick={() => setAttention(true)} style={{ minHeight: 40 }}>Needs attention only</Pill>
      </div>
      <Panel pad="0" style={{ marginTop: 14, overflow: 'hidden' }}>
        <div className="scroll-x">
          <table style={{ width: '100%', minWidth: 1120, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>{['Global listing (ASIN) · markets', 'Overall', ...COLS.map(c => c[0]), ''].map((h, i) => <th key={i} style={{ textAlign: i === 0 ? 'left' : 'center', fontSize: 11, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: C.muted, padding: '10px 6px', background: C.bg, whiteSpace: 'nowrap' }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {groups.map(g => {
                const isOpen = !!open[g.asin] || market !== 'all'
                const cellTd = { padding: '8px 6px', borderTop: `1px solid ${C.line2}`, textAlign: 'center' }
                return [
                  <tr key={g.asin} style={{ background: isOpen ? C.bg : 'transparent' }}>
                    <td style={{ padding: '8px 6px 8px 8px', borderTop: `1px solid ${C.line2}` }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <button type="button" onClick={() => setOpen(o => ({ ...o, [g.asin]: !o[g.asin] }))} aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} the markets for ${g.name}`} style={{ flex: 'none', width: 28, height: 28, borderRadius: 6, border: `1px solid ${C.border}`, background: '#fff', color: C.indigo, font: "800 14px 'Nunito', sans-serif", cursor: 'pointer' }}>{isOpen ? '–' : '+'}</button>
                        <div>
                          <b>{g.name}</b>{g.edits ? <span style={{ marginLeft: 8, background: C.soft, color: C.indigo, borderRadius: 999, fontSize: 11, fontWeight: 800, padding: '1px 8px' }}>{g.edits} edit{g.edits === 1 ? '' : 's'}</span> : null}
                          <br /><span style={{ color: C.muted }}>ASIN {g.asin}{g.skus.length ? ` · ${g.skus.slice(0, 3).join(', ')}${g.skus.length > 3 ? ' …' : ''}` : ''}</span>
                          <div style={{ marginTop: 6 }}><MarketChips rows={g.rows} onPick={setSel} /></div>
                        </div>
                      </div>
                    </td>
                    <td style={cellTd}>{overallChip({ overall: g.overall })}</td>
                    {COLS.map(([label]) => <td key={label} style={cellTd}><Sym field={`${label} (worst market)`} status={g.cells[label]} /></td>)}
                    <td style={{ ...cellTd, padding: '8px 12px 8px 6px' }}>
                      <button type="button" onClick={() => setSel(g.shown[0])} aria-label={`Open ${g.name}`} style={{ display: 'inline-flex', minHeight: 36, alignItems: 'center', padding: '0 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', font: "800 13px 'Nunito', sans-serif", color: C.indigo, cursor: 'pointer' }}>Open</button>
                    </td>
                  </tr>,
                  ...(isOpen ? g.shown.map(r => (
                    <tr key={keyOf(r)}>
                      <td style={{ padding: '6px 6px 6px 44px', borderTop: `1px solid ${C.line2}` }}><b>Amazon {r.marketplace}</b><span style={{ color: C.muted }}>{r.sku ? ` · ${r.sku}` : ''}{r.listing_status ? ` · ${r.listing_status}` : ''}</span>{r.edits ? <span style={{ marginLeft: 8, background: C.soft, color: C.indigo, borderRadius: 999, fontSize: 11, fontWeight: 800, padding: '1px 8px' }}>{r.edits} edit{r.edits === 1 ? '' : 's'}</span> : null}</td>
                      <td style={cellTd}>{overallChip(r)}</td>
                      {COLS.map(([label, fs]) => <td key={label} style={cellTd}><Sym field={label} status={worst(fs.map(f => r.cells && r.cells[f]))} /></td>)}
                      <td style={{ ...cellTd, padding: '6px 12px 6px 6px' }}>
                        <button type="button" onClick={() => setSel(r)} aria-label={`Open ${g.name} on ${r.marketplace}`} style={{ display: 'inline-flex', minHeight: 32, alignItems: 'center', padding: '0 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', font: "800 12px 'Nunito', sans-serif", color: C.indigo, cursor: 'pointer' }}>Open {r.marketplace}</button>
                      </td>
                    </tr>
                  )) : []),
                ]
              })}
            </tbody>
          </table>
          {!groups.length ? <Note style={{ padding: 16 }}>{rows.length ? 'Nothing needs attention here.' : 'No listings are being watched yet.'}</Note> : null}
        </div>
      </Panel>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, fontSize: 13, color: C.body, alignItems: 'center' }}>
        {[['match', 'matches'], ['drift', 'live differs from should be live'], ['proposed', 'change proposed'], ['in_flight', 'approved change processing'], ['problem', 'missing or blocked'], ['na', 'not used in this market']].map(([k, w]) => <span key={k} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Sym status={k} field={w} /> {w}</span>)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginTop: 24, alignItems: 'flex-start' }}>
        {eventsPanel}
        <Panel pad="18px 20px" style={{ flex: '1 1 380px' }}>
          <H2 style={{ fontSize: 18 }}>How this works</H2>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.6, listStyle: 'decimal' }}>
            <li>The Listing agent keeps the should-be-live copy for every product and market, built from the product fact sheet.</li>
            <li>Every morning it reads each live listing from Amazon and compares field by field.</li>
            <li>A gap becomes a card: put ours back, or accept Amazon’s version as the new should-be-live.</li>
            <li>New copy you ask for goes through the Brand checker and claims check, then to you on the listing screen.</li>
            <li>After your yes it is sent to Amazon, shown as “on its way”, and checked again 24 hours later.</li>
          </ol>
        </Panel>
      </div>
    </>) : null}
  </>)
}
