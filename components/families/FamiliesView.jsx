import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { C, Panel, H2, Lbl, Note, Chip, Btn, StateLine, PhoneFrame, inputStyle, fmtDay, fmtWhen } from '../approvals/renderers/reviewKit'
import { Detail } from '../ListingsView'
import { SLOTS, seoScore, matchImageFile } from '../../lib/pm/families'
import { ENGLISH, LANGUAGE } from '../../lib/pm/marketImages'
import MediaView from '../hq/MediaView'
import ConfirmBtn from '../ConfirmBtn'

// Studio › Amazon listings, by family (Jon 2026-11-19, from the agreed canvas): every family on one page, a family's
// page (master, colours, images, A+, countries, rank + reviews, evidence) and the clean-up list across stores.
// The editing itself reuses the listing screens (Detail: master, store tabs, A+ builder); nothing here sends to Amazon.

const B = { indigo: '#3D157D', teal: '#30BEAA', pink: '#dd6c92', yellow: '#e8b724', lilac: '#f3effb', mint: '#e8f7f4', cream: '#fff6dc', rose: '#fdeef3' }
const F = "'Nunito', sans-serif"
const STORE_ORDER = ['UK', 'US', 'CA', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'IE', 'PL', 'SE']
const FIX = { in_place: ['Fix in place', C.ok, B.mint, 'no risk: names, theme, child flags; the family never splits'], join: ['Join the parent', C.warn, B.cream, 'low risk: a colour joins the parent already there'], relink: ['Relink', C.bad, B.rose, 'short split (about 30 min), out of hours, one family at a time'] }
const STATUS = { open: 'Open', agreed: 'Agreed', in_progress: 'In progress', fixed: 'Fixed', wont_fix: "Won't fix" }

async function call(url, body) {
  const r = await apiFetch(url, body ? { method: 'POST', body: JSON.stringify(body) } : undefined)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Could not load (${r.status})`)
  return j
}
function useLoad(url, deps = []) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    setError('')
    call(url).then(j => { if (live) setData(j) }).catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [url, n, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
  return [data, error, () => setN(x => x + 1), setData]
}
const pill = (on) => ({ minHeight: 38, padding: '0 14px', borderRadius: 999, border: `1px solid ${on ? B.indigo : C.border}`, background: on ? B.indigo : '#fff', color: on ? '#fff' : B.indigo, font: `800 13px ${F}`, cursor: 'pointer' })
const Score = ({ v }) => v == null ? <span style={{ color: C.faint }}>–</span> : <b style={{ color: v >= 75 ? C.ok : v >= 55 ? C.warn : C.bad }}>{v}</b>

// mode: 'list' (Amazon › Listings) or 'cleanup' (Amazon › Clean-up); a family opens inside either and goes back to it.
export default function FamiliesView({ mode = 'list', isMobile, onOpenApproval, onCleanup }) {
  const [view, setView] = useState({ page: mode })
  const home = mode === 'cleanup' ? 'Clean-up' : 'Amazon listings'
  if (view.page === 'family') return <FamilyPage code={view.code} isMobile={isMobile} onOpenApproval={onOpenApproval} backLabel={home} onBack={() => setView({ page: mode })} />
  if (view.page === 'cleanup') return <CleanupPage isMobile={isMobile} onBack={mode === 'cleanup' ? null : () => setView({ page: 'list' })} onOpen={(code) => setView({ page: 'family', code })} />
  return <FamilyList isMobile={isMobile} onOpen={(code) => setView({ page: 'family', code })} onCleanup={onCleanup || (() => setView({ page: 'cleanup' }))} />
}
const signedOff = (f) => !!(f.signoff && f.signoff.Jon && (f.signoff.Laura || f.signoff.solo))
const liveEverywhere = (f) => !f.problems && Object.values(f.stores || {}).every(s => s.state === 'none' || s.state === 'live') && Object.values(f.stores || {}).some(s => s.state === 'live')

// ─── every family ─────────────────────────────────────────────────────────────────────────────────────────────────
function FamilyList({ isMobile, onOpen, onCleanup }) {
  const [data, error, reload] = useLoad('/api/listings/families')
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState('')
  const refresh = async () => { setBusy('Reading the live listings…'); try { await call('/api/listings/families', { op: 'sync' }); reload() } catch (e) { alert(e.message) } finally { setBusy('') } }
  const rows = useMemo(() => {
    let r = (data && data.families) || []
    if (filter === 'problems') r = r.filter(f => f.problems)
    if (filter === 'decisions') r = r.filter(f => f.decisions.length)
    if (filter === 'signoff') r = r.filter(f => !signedOff(f))
    if (filter === 'live') r = r.filter(liveEverywhere)
    const s = search.trim().toLowerCase()
    if (s) r = r.filter(f => `${f.name} ${f.family_code} ${f.lead_asin}`.toLowerCase().includes(s))
    return r
  }, [data, filter, search])
  const stores = data ? STORE_ORDER.filter(s => data.families.some(f => f.stores[s] && f.stores[s].state !== 'none')) : []
  return (
    <div style={{ padding: isMobile ? '0 4px 16px' : '0 16px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px' }}>
          <H2 style={{ margin: 0 }}>Amazon listings</H2>
          <Note>One row per family; a product with one colour is a family of one. Each store keeps its own parent; the family code is doddlHQ's own.</Note>
        </div>
        <input type="search" aria-label="Search families" placeholder="Family, code or ASIN" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, width: 220, minHeight: 38 }} />
        <Btn onClick={refresh} disabled={!!busy}>{busy || 'Refresh from Amazon data'}</Btn>
      </div>
      <div role="group" aria-label="Filter" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={pill(filter === 'all')} onClick={() => setFilter('all')}>All {data ? data.counts.all : ''}</button>
        <button type="button" style={pill(filter === 'problems')} onClick={() => setFilter('problems')}>Needs fixing {data ? data.counts.problems : ''}</button>
        <button type="button" style={pill(filter === 'decisions')} onClick={() => setFilter('decisions')}>Needs your decision {data ? data.counts.decisions : ''}</button>
        <button type="button" style={pill(filter === 'signoff')} onClick={() => setFilter('signoff')}>Waiting for sign-off {data ? data.families.filter(f => !signedOff(f)).length : ''}</button>
        <button type="button" style={pill(filter === 'live')} onClick={() => setFilter('live')}>Live everywhere {data ? data.families.filter(liveEverywhere).length : ''}</button>
        <button type="button" style={{ ...pill(false), borderColor: B.pink, color: '#a33d62' }} onClick={onCleanup}>Clean-up list {data ? `(${data.counts.cleanup_open} open)` : ''} ›</button>
      </div>
      <StateLine loading={!data && !error} error={error} empty={data && !rows.length ? 'No families match.' : ''} />
      {data && rows.length ? (
        <Panel pad="0" style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760, fontSize: 13.5 }}>
            <thead><tr style={{ background: B.lilac }}>
              {['Family', 'Colours', 'Master', ...stores, 'SEO (UK)', 'Needs you'].map(h => <th key={h} scope="col" style={{ textAlign: 'left', padding: '10px 12px', font: `800 12.5px ${F}`, color: B.indigo }}>{h}</th>)}
            </tr></thead>
            <tbody>{rows.map(f => (
              <tr key={f.family_code} onClick={() => onOpen(f.family_code)} style={{ borderTop: `1px solid ${C.line2}`, cursor: 'pointer' }}>
                <td style={{ padding: '10px 12px' }}><button type="button" onClick={(e) => { e.stopPropagation(); onOpen(f.family_code) }} style={{ background: 'none', border: 0, padding: 0, font: `800 14px ${F}`, color: C.ink, cursor: 'pointer', textAlign: 'left' }}>{f.name}</button><div style={{ color: C.muted, fontSize: 12 }}>{f.family_code}</div></td>
                <td style={{ padding: '10px 12px' }}>{f.colours ? f.colour_names.join(' · ') + (f.colours > 4 ? ` +${f.colours - 4}` : '') : `${f.products} product${f.products === 1 ? '' : 's'}`}</td>
                <td style={{ padding: '10px 12px', fontWeight: 800, color: signedOff(f) ? C.ok : C.warn }}>{signedOff(f) ? 'Signed off' : f.master === 'approved' ? 'Approved' : f.master ? 'Draft' : 'None yet'}</td>
                {stores.map(s => { const c = f.stores[s] || { state: 'none' }; return <td key={s} style={{ padding: '10px 12px', fontWeight: 800, fontSize: 12.5, color: c.state === 'problem' ? (c.wave >= 4 ? C.warn : C.bad) : c.state === 'live' ? C.ok : c.state === 'listed' ? B.indigo : C.faint, whiteSpace: 'nowrap' }} title={c.title || ''}>{c.state === 'problem' ? (isMobile ? '!' : c.label) : c.state === 'live' ? 'Live' : c.state === 'listed' ? 'Listed' : '–'}</td> })}
                <td style={{ padding: '10px 12px', fontSize: 15 }}><Score v={f.seo} /></td>
                <td style={{ padding: '10px 12px' }}>{f.decisions.length ? f.decisions.join(' · ') : f.problems ? `${f.problems} to fix` : <span style={{ color: C.muted }}>Nothing</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </Panel>
      ) : null}
      <Note>Store cells: Live · Listed · a problem in red (hover for it) · – not sold there. SEO is out of 100 from the UK listing and its Brand Analytics searches.</Note>
    </div>
  )
}

// ─── clean-up across every family ─────────────────────────────────────────────────────────────────────────────────
function CleanupPage({ isMobile, onBack, onOpen }) {
  const [data, error, reload] = useLoad('/api/listings/families?view=cleanup')
  const [show, setShow] = useState('open')
  const set = async (r, status) => { try { await call('/api/listings/families', { op: 'cleanup', family_code: r.family_code, marketplace: r.marketplace, problem_key: r.problem_key, status }); reload() } catch (e) { alert(e.message) } }
  const items = ((data && data.items) || []).filter(r => show === 'all' || (show === 'open' ? !['fixed', 'wont_fix'].includes(r.status) : show === 'decisions' ? r.decision_needed && r.status === 'open' : r.status === 'fixed'))
  const counts = (k) => ((data && data.items) || []).filter(k).length
  return (
    <div style={{ padding: isMobile ? '0 4px 16px' : '0 16px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {onBack ? <button type="button" onClick={onBack} style={{ alignSelf: 'flex-start', background: 'none', border: 0, padding: 0, font: `800 14px ${F}`, color: B.indigo, cursor: 'pointer', minHeight: 40 }}>‹ Amazon listings</button> : null}
      <div><H2 style={{ margin: 0 }}>Clean-up: every parent and child, all stores</H2><Note>Found from the live listings on each refresh. Each is fixed the least risky way, with rank and reviews snapshotted before and after. A problem that disappears from Amazon is marked fixed by itself.</Note></div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
        {Object.entries(FIX).map(([k, [t, fg, bg, d]]) => <div key={k} style={{ background: bg, borderRadius: 12, padding: '10px 14px' }}><b style={{ color: fg }}>{t}</b><div style={{ fontSize: 13 }}>{d}</div></div>)}
      </div>
      <div role="group" aria-label="Show" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={pill(show === 'open')} onClick={() => setShow('open')}>Open {data ? counts(r => !['fixed', 'wont_fix'].includes(r.status)) : ''}</button>
        <button type="button" style={pill(show === 'decisions')} onClick={() => setShow('decisions')}>Needs your decision {data ? counts(r => r.decision_needed && r.status === 'open') : ''}</button>
        <button type="button" style={pill(show === 'fixed')} onClick={() => setShow('fixed')}>Fixed {data ? counts(r => r.status === 'fixed') : ''}</button>
        <button type="button" style={pill(show === 'all')} onClick={() => setShow('all')}>All</button>
      </div>
      <StateLine loading={!data && !error} error={error} empty={data && !items.length ? 'Nothing here.' : ''} />
      {items.length ? (
        <Panel pad="0" style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 820, fontSize: 13 }}>
            <thead><tr style={{ background: B.lilac }}>{['Wave', 'Family', 'Store', 'Problem found', 'Fix', 'Your decision', 'Status'].map(h => <th key={h} scope="col" style={{ textAlign: 'left', padding: '10px 12px', font: `800 12.5px ${F}`, color: B.indigo }}>{h}</th>)}</tr></thead>
            <tbody>{items.map(r => (
              <tr key={`${r.family_code}|${r.marketplace}|${r.problem_key}`} style={{ borderTop: `1px solid ${C.line2}` }}>
                <td style={{ padding: '9px 12px', fontWeight: 900, color: FIX[r.fix_kind] ? FIX[r.fix_kind][1] : C.ink }}>{r.wave}</td>
                <td style={{ padding: '9px 12px' }}><button type="button" onClick={() => onOpen(r.family_code)} style={{ background: 'none', border: 0, padding: 0, font: `800 13px ${F}`, color: B.indigo, cursor: 'pointer', textAlign: 'left' }}>{r.family}</button></td>
                <td style={{ padding: '9px 12px' }}>{r.marketplace}</td>
                <td style={{ padding: '9px 12px' }}>{r.problem}</td>
                <td style={{ padding: '9px 12px' }}><span style={{ fontWeight: 800, color: FIX[r.fix_kind] ? FIX[r.fix_kind][1] : C.ink }}>{FIX[r.fix_kind] ? FIX[r.fix_kind][0] : r.fix_kind}</span><div style={{ color: C.muted }}>{r.fix}</div></td>
                <td style={{ padding: '9px 12px', color: r.decision_needed ? C.warn : C.faint, fontWeight: 800 }}>{r.decision_needed || '–'}</td>
                <td style={{ padding: '9px 12px' }}>
                  <select aria-label="Status" value={r.status} onChange={e => set(r, e.target.value)} style={{ ...inputStyle, minHeight: 34, width: 130, padding: '0 6px' }}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  {r.updated_by ? <div style={{ fontSize: 11, color: C.faint }}>{r.updated_by} · {fmtDay(r.updated_at)}</div> : null}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </Panel>
      ) : null}
      <Panel>
        <Lbl>Every fix runs the same five steps (one approval per family)</Lbl>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(5, minmax(0, 1fr))', gap: 8, marginTop: 8 }}>
          {[['1 · Snapshot before', 'Screenshot of every colour + rank, stars, reviews'], ['2 · Amazon preview', 'Validated by Amazon first; an error stops here'], ['3 · Change sent', 'Fix in place, join, or relink'], ['4 · Family checked', 'Every colour under one parent, read back'], ['5 · Snapshot after', 'Same day and after 24 h; alert if reviews or stars drop']].map(([t, d], i) => <div key={t} style={{ background: i === 4 ? B.mint : B.lilac, borderRadius: 10, padding: '10px 12px', fontSize: 13 }}><b style={{ display: 'block' }}>{t}</b>{d}</div>)}
        </div>
      </Panel>
    </div>
  )
}

// ─── one family ───────────────────────────────────────────────────────────────────────────────────────────────────
const TABS = [['master', 'Master'], ['colours', 'Colours'], ['images', 'Images'], ['aplus', 'A+ page'], ['markets', 'Markets'], ['countries', 'Countries'], ['rank', 'Rank & reviews'], ['evidence', 'Evidence']]

function FamilyPage({ code, isMobile, onBack, onOpenApproval, backLabel = 'Amazon listings' }) {
  const [data, error, reload] = useLoad(`/api/listings/families?code=${encodeURIComponent(code)}`)
  const [tab, setTab] = useState('master')
  const [open, setOpen] = useState(null) // { asin, marketplace, startTab }
  const op = async (body) => { try { await call('/api/listings/families', { family_code: code, ...body }); reload() } catch (e) { alert(e.message) } }
  if (!data) return <div style={{ padding: 16 }}><StateLine loading={!error} error={error} /></div>
  const f = data.family
  const sold = data.members.filter(m => m.role !== 'parent')
  const ukLead = { asin: f.lead_asin, marketplace: sold.some(m => m.asin === f.lead_asin && m.marketplace === 'UK') ? 'UK' : (sold.find(m => m.asin === f.lead_asin) || {}).marketplace || 'UK' }
  const rowsFor = (asin) => sold.filter(m => m.asin === asin).map(m => ({ asin: m.asin, marketplace: m.marketplace, sku: m.sku }))
  const detail = (sel, startTab) => <Detail key={`${sel.asin}|${sel.marketplace}|${startTab}`} sel={{ ...sel, sku: (sold.find(m => m.asin === sel.asin && m.marketplace === sel.marketplace) || {}).sku }} rows={rowsFor(sel.asin)} isMobile={isMobile} onBack={() => setOpen(null)} onSelect={(r) => setOpen({ asin: r.asin, marketplace: r.marketplace, startTab: false })} onOpenApproval={onOpenApproval} startTab={startTab} />
  const signed = (data.family_master ? data.family_master.approvals : f.signoff) || {}
  const pad = isMobile ? '0 4px 16px' : '0 16px 40px'
  const soldIn = [...new Set(sold.map(m => m.marketplace))].sort((a, b) => STORE_ORDER.indexOf(a) - STORE_ORDER.indexOf(b))
  const homeStore = soldIn.includes('UK') ? 'UK' : soldIn[0]
  const colourCount = new Set(sold.filter(m => m.marketplace === homeStore && !m.is_pack).map(m => m.asin)).size
  if (open) return <div style={{ padding: pad }}><button type="button" onClick={() => setOpen(null)} style={{ background: 'none', border: 0, padding: 0, font: `800 14px ${F}`, color: B.indigo, cursor: 'pointer', minHeight: 40 }}>‹ {f.name}</button>{detail(open, open.startTab)}</div>
  return (
    <div style={{ padding: pad, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button type="button" onClick={onBack} style={{ alignSelf: 'flex-start', background: 'none', border: 0, padding: 0, font: `800 14px ${F}`, color: B.indigo, cursor: 'pointer', minHeight: 40 }}>‹ {backLabel}</button>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, font: `900 30px ${F}`, color: B.indigo }}>{f.name}</h1>
            <Chip bg={B.lilac}>Family code {f.family_code}</Chip>
            <Chip bg={data.seo.score >= 75 ? B.mint : B.cream} fg={data.seo.score >= 75 ? C.ok : C.warn}>SEO (UK) {data.seo.score}</Chip>
          </div>
          <span style={{ fontSize: 14, color: C.muted }}>Theme: {String(f.theme || 'none').toLowerCase().replace(/_/g, ' ')} · {colourCount} colour{colourCount === 1 ? '' : 's'} · sold in {soldIn.join(', ') || 'no store yet'} · every field is editable</span>
        </div>
        <nav aria-label="Family sections" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TABS.map(([k, l]) => <button key={k} type="button" aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)} style={pill(tab === k)}>{l}</button>)}
        </nav>
      </div>
      <div style={{ background: signed.Jon && (signed.Laura || signed.solo) ? B.mint : B.cream, border: `1px solid ${signed.Jon && (signed.Laura || signed.solo) ? B.teal : B.yellow}`, borderRadius: 14, padding: '12px 18px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 15, color: signed.Jon && (signed.Laura || signed.solo) ? C.ok : '#8a6400' }}>{signed.Jon && (signed.Laura || signed.solo) ? 'English master approved' : 'Draft'}{data.family_master ? ` · family master (${data.family_master.status})` : data.master ? ` · master ${data.master.master_sku || data.master.asin} (${data.master.status})` : ' · no master yet'}</b>
        <span style={{ flex: '1 1 240px', fontSize: 14, color: C.muted }}>Stage 1: copy, colours, attributes, images and A+ in English. Translations start only once the structure is right in every store (Markets). Approval needs both names; any edit returns it to draft.</span>
        <span style={{ fontSize: 13, fontWeight: 800 }}>Jon {signed.Jon ? `✓ ${fmtDay(signed.Jon)}` : '○'} · Laura {signed.Laura ? `✓ ${fmtDay(signed.Laura)}` : signed.solo ? 'not needed' : '○'}</span>
        {!(signed.Jon && (signed.Laura || signed.solo)) ? <Btn primary onClick={() => op({ op: 'signoff' })}>Approve the master</Btn> : null}
        {data.family_master && data.family_master.status === 'approved' ? <ConfirmBtn as={Btn} onConfirm={() => op({ op: 'master_apply' })} label="Apply to the colours" confirmLabel="Click again: write each colour's master" /> : null}
        {signed.Jon && !signed.Laura && !signed.solo ? <ConfirmBtn as={Btn} onConfirm={() => op({ op: 'signoff', solo: true })} label="Approve without Laura" confirmLabel="Click again: approve without Laura" /> : null}
      </div>
      {data.target ? <CardsPanel data={data} reload={reload} /> : null}
      {tab === 'master' ? <MasterTab data={data} isMobile={isMobile} op={op} lead={ukLead} reload={reload} onEdit={() => setOpen({ ...ukLead, startTab: 'master' })} /> : null}
      {tab === 'colours' ? <ColoursTab data={data} isMobile={isMobile} op={op} onOpen={(m) => setOpen({ asin: m.asin, marketplace: m.marketplace, startTab: false })} /> : null}
      {tab === 'images' ? <ImagesTab data={data} isMobile={isMobile} reload={reload} /> : null}
      {tab === 'markets' ? <MarketsTab data={data} isMobile={isMobile} reload={reload} /> : null}
      {tab === 'aplus' ? <AplusTab data={data} isMobile={isMobile} lead={ukLead} detail={detail} /> : null}
      {tab === 'countries' ? <CountriesTab data={data} isMobile={isMobile} onOpen={(m) => setOpen({ asin: m.asin, marketplace: m.marketplace, startTab: false })} onEdit={() => setOpen({ ...ukLead, startTab: 'master' })} /> : null}
      {tab === 'rank' ? <RankTab data={data} isMobile={isMobile} /> : null}
      {tab === 'evidence' ? <EvidenceTab data={data} /> : null}
    </div>
  )
}

/** Focus / Watch / Not relevant for one search; clicking the chosen one again puts it back to automatic. */
function ChoicePick({ x, choose }) {
  const opts = [['focus', 'Focus', C.ok], ['watch', 'Watch', C.warn], ['out', 'Not relevant', C.bad]]
  return (
    <span role="group" aria-label={`Focus for ${x.search_query}`} style={{ display: 'inline-flex', gap: 4 }}>
      {opts.map(([v, label, col]) => {
        const on = x.choice === v
        return <button key={v} type="button" aria-pressed={on} onClick={() => choose(x.search_query, on ? 'auto' : v)}
          style={{ minHeight: 28, padding: '0 8px', borderRadius: 8, border: `1px solid ${on ? col : C.line2}`, background: on ? col : '#fff', color: on ? '#fff' : C.ink, font: `800 11.5px ${F}`, cursor: 'pointer' }}>{label}</button>
      })}
    </span>
  )
}

const COPY_ROWS = [['title', 'Title', 200], ['bullet_1', 'Bullet 1', 500], ['bullet_2', 'Bullet 2', 500], ['bullet_3', 'Bullet 3', 500], ['bullet_4', 'Bullet 4', 500], ['bullet_5', 'Bullet 5', 500], ['description', 'Description', 2000], ['search_terms', 'Search terms', 249]]
const bytesOf = (s) => new TextEncoder().encode(String(s || '')).length
const editLink = { background: 'none', border: 0, padding: 0, color: B.indigo, font: `800 13px ${F}`, cursor: 'pointer', textDecoration: 'underline', minHeight: 24 }

function MasterTab({ data, isMobile, op, lead, reload, onEdit }) {
  const [kw, setKw] = useState('')
  const s = data.seo
  const k = data.keywords
  const [all, setAll] = useState(false)
  const add = async (q) => { if (!q.trim()) return; await op({ op: 'keyword_add', query: q.trim() }); setKw('') }
  // Un-focusing one of your own keywords removes it; everything else just records the choice.
  const choose = (q, choice) => {
    const x = k.focus.find(y => y.search_query === q) || {}
    return x.own && x.choice === 'focus' && choice === 'auto'
      ? op({ op: 'keyword_remove', query: q })
      : op({ op: 'keyword_choice', query: q, choice })
  }
  // Multi-select: tick searches (table, not-relevant list, suggestions) and apply one choice to all of them.
  const [sel, setSel] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const toggle = (q) => setSel(prev => { const n = new Set(prev); if (n.has(q)) n.delete(q); else n.add(q); return n })
  const setMany = (qs, on) => setSel(prev => { const n = new Set(prev); for (const q of qs) { if (on) n.add(q); else n.delete(q) } return n })
  const shown = all ? k.focus : k.focus.slice(0, 20)
  const allShown = shown.length > 0 && shown.every(x => sel.has(x.search_query))
  const bulk = async (choice) => {
    const inTable = new Map(k.focus.map(x => [x.search_query, x]))
    const items = [...sel].map(q => {
      const x = inTable.get(q)
      if (!x && choice === 'focus') return { query: q, choice: 'add' }          // a suggestion: becomes one of yours
      if (x && x.own && x.choice === 'focus' && choice === 'auto') return { query: q, choice: 'remove' }
      return { query: q, choice }
    })
    setBusy(true)
    try { await op({ op: 'keyword_bulk', items }); setSel(new Set()) } finally { setBusy(false) }
  }
  const box = (q, label) => <input type="checkbox" checked={sel.has(q)} onChange={() => toggle(q)} aria-label={label || `Select ${q}`} style={{ width: 16, height: 16, accentColor: B.indigo, cursor: 'pointer' }} />
  // ── the English master, edited in place (Stage 1): copy + attributes, live score, Write SEO copy (never auto-saved)
  const [ed, setEd] = useState(() => ({ ...(data.copy || {}) }))
  const [attrEd, setAttrEd] = useState(() => attrRows(data))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [wr, setWr] = useState(null)        // the writer's draft
  const [writing, setWriting] = useState(false)
  const [wErr, setWErr] = useState('')
  useEffect(() => { if (!dirty) { setEd({ ...(data.copy || {}) }); setAttrEd(attrRows(data)) } }, [data]) // eslint-disable-line react-hooks/exhaustive-deps
  const live = useMemo(() => seoScore({ copy: ed, keywords: k.focus, ...(data.score_inputs || {}) }), [ed, k.focus, data.score_inputs])
  const setField = (key, v) => { setEd(prev => ({ ...prev, [key]: v })); setDirty(true) }
  const save = async () => {
    setSaving(true)
    try {
      await call('/api/listings/families', { family_code: data.family.family_code, op: 'master_save', copy: ed, attributes: attrEd.filter(a => a.name.trim()).map(a => ({ name: a.name.trim(), value: parseVal(a.value) })) })
      setDirty(false); reload()
    } catch (e) { alert(e.message) } finally { setSaving(false) }
  }
  const write = async () => {
    setWriting(true); setWErr('')
    try { setWr(await call('/api/listings/families', { family_code: data.family.family_code, op: 'write_seo' })) } catch (e) { setWErr(e.message) } finally { setWriting(false) }
  }
  const P = [['Title words', live.parts.title, 30], ['Lead phrase early in the title', live.parts.lead, 5], ['Searches findable', live.parts.findable, 20], ['Bullet words', live.parts.bullets, 10], ['Space used', live.parts.space, 10], ['Images (7 per colour)', live.parts.images, 15], ['A+ page live', live.parts.aplus, 5], ['Family and attributes', live.parts.family, 5]]
  const fmx = data.family_master
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) minmax(0, 1.1fr)', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <Panel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, font: `900 18px ${F}`, color: B.indigo, flex: 1 }}>English master copy</h2>
              <Btn onClick={write} disabled={writing}>{writing ? 'Writing…' : 'Write SEO copy'}</Btn>
              <Btn primary onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</Btn>
            </div>
            <Note>{data.copy_source === 'family' ? `The family master${fmx && fmx.updated_by ? ` · last saved by ${fmx.updated_by}` : ''}.` : 'From the existing master / live UK listing: saving makes it the family master.'} No colour name in the title: each colour adds its own. Saving returns an approved master to draft. Write SEO copy drafts from the weighted words (Claude Haiku, about 1–2p a run); nothing is saved until you take a field and press Save.</Note>
            {wErr ? <div role="alert" style={{ color: C.bad, fontWeight: 800, fontSize: 13, marginTop: 6 }}>{wErr}</div> : null}
            {wr ? <SeoDraft wr={wr} ed={ed} onTake={(key) => setField(key, wr.draft[key])} onTakeAll={() => { setEd(prev => ({ ...prev, ...wr.draft })); setDirty(true) }} onClose={() => setWr(null)} isMobile={isMobile} /> : null}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
              {COPY_ROWS.map(([key, label, max]) => {
                const v = ed[key] || ''
                const n = key === 'search_terms' ? bytesOf(v) : v.length
                return (
                  <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                    <span style={{ display: 'flex', justifyContent: 'space-between' }}><b>{label}</b><span style={{ fontSize: 12, fontWeight: 800, color: n > max ? C.bad : n ? C.ok : C.faint }}>{n}/{max}{key === 'search_terms' ? ' bytes' : ''}</span></span>
                    <textarea value={v} onChange={e => setField(key, e.target.value)} rows={key === 'description' ? 6 : key === 'title' ? 2 : 3} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', font: `600 13.5px ${F}`, lineHeight: 1.45, resize: 'vertical', borderColor: n > max ? C.bad : undefined }} />
                  </label>
                )
              })}
            </div>
          </Panel>
          <Panel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ margin: 0, font: `900 18px ${F}`, color: B.indigo, flex: 1 }}>Attributes shared by every colour</h2>
              <button type="button" onClick={() => { setAttrEd([...attrEd, { name: '', value: '' }]); setDirty(true) }} style={editLink}>+ Add attribute</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10, fontSize: 13 }}>
              {attrEd.map((a, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '200px minmax(0, 1fr) 34px', gap: 6, alignItems: 'center' }}>
                  <input aria-label="Attribute name" value={a.name} onChange={e => { const n = [...attrEd]; n[i] = { ...a, name: e.target.value }; setAttrEd(n); setDirty(true) }} style={{ ...inputStyle, minHeight: 34 }} />
                  <input aria-label={`Value of ${a.name || 'attribute'}`} value={a.value} onChange={e => { const n = [...attrEd]; n[i] = { ...a, value: e.target.value }; setAttrEd(n); setDirty(true) }} style={{ ...inputStyle, minHeight: 34 }} />
                  <button type="button" aria-label={`Remove ${a.name || 'attribute'}`} onClick={() => { setAttrEd(attrEd.filter((_, j) => j !== i)); setDirty(true) }} style={{ minHeight: 34, border: `1px solid ${C.line2}`, borderRadius: 8, background: '#fff', color: C.bad, font: `900 14px ${F}`, cursor: 'pointer' }}>×</button>
                </div>
              ))}
              {!attrEd.length ? <Note>No attributes yet: add them here.</Note> : null}
            </div>
            <Note style={{ marginTop: 6 }}>Amazon names (e.g. material, age_range_description). Values that are lists or objects stay in Amazon's form. Save with the copy above.</Note>
          </Panel>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            <Panel>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}><h2 style={{ margin: 0, font: `900 18px ${F}`, color: B.indigo }}>SEO score (UK){dirty ? ' · unsaved' : ''}</h2><span style={{ font: `900 32px ${F}` }}><Score v={live.score} /></span></div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '4px 24px', fontSize: 13, marginTop: 6 }}>
                {P.map(([t, v, max]) => <div key={t} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t}</span><b style={{ color: v < max / 2 ? C.bad : C.ink }}>{v} / {max}</b></div>)}
                <div style={{ display: 'flex', justifyContent: 'space-between', color: live.penalties.length ? C.bad : C.ink }}><span>Penalties</span><b>{live.penalties.length ? `−${live.penalties.reduce((a, [, v]) => a + v, 0)}` : 0}</b></div>
              </div>
              {live.penalties.map(([t, v]) => <div key={t} style={{ fontSize: 12.5, color: C.bad }}>• {t} (−{v})</div>)}
              <Note style={{ marginTop: 8 }}>On words, out of 100: {live.basis}{live.lead ? `; lead phrase "${live.lead}"` : ''}. Updates as you type.</Note>
            </Panel>
        <Panel style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><h2 style={{ margin: 0, font: `900 18px ${F}`, color: B.indigo, flex: 1 }}>Keyword focus (UK)</h2><Btn onClick={reload}>Refresh volumes</Btn></div>
          <Note>Brand Analytics, every colour in the family{k.period_from ? `, ${fmtDay(k.period_from)} – ${fmtDay(k.period_to)}` : ''}. Sent daily by the Hub; reopen this tab to see the latest.</Note>
          {sel.size ? (
            <div role="region" aria-label="Selected keywords" style={{ position: 'sticky', top: 0, zIndex: 2, marginTop: 8, background: B.indigo, color: '#fff', borderRadius: 10, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <b style={{ font: `800 13px ${F}`, marginRight: 4 }}>{sel.size} selected</b>
              {[['focus', 'Focus'], ['watch', 'Watch'], ['out', 'Not relevant'], ['auto', 'Reset']].map(([c, label]) => (
                <button key={c} type="button" disabled={busy} onClick={() => bulk(c)} style={{ minHeight: 32, padding: '0 10px', borderRadius: 8, border: 0, background: c === 'out' ? '#dd6c92' : '#fff', color: c === 'out' ? '#fff' : B.indigo, font: `800 12.5px ${F}`, cursor: busy ? 'wait' : 'pointer' }}>{label}</button>
              ))}
              <span style={{ flex: 1 }} />
              <button type="button" onClick={() => setSel(new Set())} style={{ background: 'none', border: 0, color: '#fff', font: `800 12.5px ${F}`, cursor: 'pointer', textDecoration: 'underline' }}>Clear</button>
            </div>
          ) : <Note style={{ marginTop: 6 }}>Tick several searches to change them all at once.</Note>}
          <div style={{ overflowX: 'auto', marginTop: 6 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 540, fontSize: 12.5 }}>
              <thead><tr>
                <th scope="col" style={{ padding: '4px 6px', width: 24 }}><input type="checkbox" checked={allShown} onChange={() => setMany(shown.map(x => x.search_query), !allShown)} aria-label="Select every search shown" style={{ width: 16, height: 16, accentColor: B.indigo, cursor: 'pointer' }} /></th>
                {['Search', 'Volume', 'Shown', 'Clicks', 'Buys', 'Conv.', 'Where', 'Focus'].map(h => <th key={h} scope="col" style={{ textAlign: 'left', padding: '4px 6px', color: C.muted, fontWeight: 800 }}>{h}</th>)}
              </tr></thead>
              <tbody>{shown.map(x => (
                <tr key={x.search_query} style={{ borderTop: `1px solid ${C.line2}`, opacity: x.choice === 'watch' ? 0.6 : 1, background: sel.has(x.search_query) ? B.lilac : x.choice === 'focus' ? B.mint : 'transparent' }}>
                  <td style={{ padding: '4px 6px' }}>{box(x.search_query)}</td>
                  <td style={{ padding: '4px 6px' }}>{x.search_query}{x.own ? <span style={{ color: B.indigo, fontWeight: 800 }}> · yours</span> : null}</td>
                  <td style={{ padding: '4px 6px' }}>{x.query_volume == null ? '–' : x.query_volume.toLocaleString()}</td>
                  <td style={{ padding: '4px 6px' }}>{x.impressions.toLocaleString()}</td><td style={{ padding: '4px 6px' }}>{x.clicks}</td><td style={{ padding: '4px 6px' }}>{x.purchases}</td>
                  <td style={{ padding: '4px 6px' }}>{x.conversion == null ? '–' : `${Math.round(x.conversion * 100)}%`}</td>
                  <td style={{ padding: '4px 6px', fontWeight: 800, color: x.where === 'Missing' ? C.bad : x.where === 'Title' ? C.ok : C.warn }}>{x.where}</td>
                  <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}><ChoicePick x={x} choose={choose} /></td>
                </tr>
              ))}</tbody>
            </table>
            {!k.focus.length ? <Note>No Brand Analytics searches for this family yet.</Note> : null}
            {k.focus.length > 20 ? <button type="button" onClick={() => setAll(!all)} style={{ background: 'none', border: 0, color: B.indigo, font: `800 12.5px ${F}`, cursor: 'pointer', padding: '6px 0' }}>{all ? 'Show top 20' : `Show all ${k.focus.length}`}</button> : null}
          </div>
          <Note style={{ marginTop: 6 }}>Focus: scored and written for (once any search is in focus, only focus searches count in the SEO score). Watch: shown, not scored. Not relevant: hidden, never scored, never given to the copy writer. Nothing chosen: the top 20 by volume count.</Note>
          {(k.removed || []).length ? (
            <details style={{ marginTop: 8, fontSize: 12.5 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 800, color: B.indigo }}>Not relevant ({k.removed.length})</summary>
              <button type="button" onClick={() => setMany(k.removed.map(x => x.search_query), !k.removed.every(x => sel.has(x.search_query)))} style={{ background: 'none', border: 0, color: B.indigo, font: `800 12px ${F}`, cursor: 'pointer', padding: '4px 0' }}>{k.removed.every(x => sel.has(x.search_query)) ? 'Untick all' : 'Tick all'} (then Reset to restore)</button>
              {k.removed.map(x => <div key={x.search_query} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>{box(x.search_query)}<span style={{ flex: 1, color: C.muted }}>{x.search_query}</span><span>{x.query_volume == null ? '–' : x.query_volume.toLocaleString()}</span><button type="button" onClick={() => choose(x.search_query, 'auto')} style={{ background: 'none', border: 0, color: B.indigo, font: `800 12px ${F}`, cursor: 'pointer' }}>Restore</button></div>)}
            </details>
          ) : null}
          <Note style={{ marginTop: 6 }}>Shown, clicks and buys are doddl's own on each search; Amazon's share of all impressions and clicks needs the Hub to send the search totals too.</Note>
          <div style={{ marginTop: 12 }}>
            <Lbl>The words that count (from the searches above)</Lbl>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 420, fontSize: 12.5, marginTop: 4 }}>
                <thead><tr>{['Word', 'Weight', 'Searches', 'Title', 'Bullets', 'Terms'].map(h => <th key={h} scope="col" style={{ textAlign: 'left', padding: '4px 6px', color: C.muted, fontWeight: 800 }}>{h}</th>)}</tr></thead>
                <tbody>{live.words.slice(0, 25).map(w => (
                  <tr key={w.word} style={{ borderTop: `1px solid ${C.line2}` }}>
                    <td style={{ padding: '4px 6px', fontWeight: 800 }}>{w.word}</td><td style={{ padding: '4px 6px' }}>{w.weight.toLocaleString()}</td><td style={{ padding: '4px 6px' }}>{w.phrases}</td>
                    {[w.in_title, w.in_bullets, w.in_terms].map((on, i) => <td key={i} style={{ padding: '4px 6px', fontWeight: 900, color: on ? C.ok : C.faint }}>{on ? '✓' : '–'}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <Note style={{ marginTop: 4 }}>Weight = searches in 3 months for every counted search containing the word (plurals merged; for, with, and… and brand names left out). The title should carry the top words once each; search terms take only words not already in the title or bullets.</Note>
          </div>
          {k.suggested.length ? (
            <div style={{ marginTop: 10 }}>
              <Lbl>Suggested searches not on the listing</Lbl>
              {k.suggested.map(x => <div key={x.search_query} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, padding: '3px 0' }}>{box(x.search_query)}<span style={{ flex: 1 }}>{x.search_query}{x.store_wide ? <span style={{ color: C.muted }}> · store-wide</span> : null}</span><span>{(x.query_volume || 0).toLocaleString()}</span><button type="button" onClick={() => add(x.search_query)} style={{ background: 'none', border: 0, color: B.indigo, font: `800 12.5px ${F}`, cursor: 'pointer' }}>+ Add to focus</button><button type="button" onClick={() => choose(x.search_query, 'out')} style={{ background: 'none', border: 0, color: C.muted, font: `800 12.5px ${F}`, cursor: 'pointer' }}>Not relevant</button></div>)}
            </div>
          ) : null}
          <form onSubmit={e => { e.preventDefault(); add(kw) }} style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <label style={{ flex: 1 }}><span style={{ position: 'absolute', left: -9999 }}>Add your own keyword</span><input value={kw} onChange={e => setKw(e.target.value)} placeholder="Add your own keyword, e.g. plate for toddlers 2 years" style={{ ...inputStyle, width: '100%', minHeight: 38 }} /></label>
            <Btn primary type="submit">Add</Btn>
          </form>
        </Panel>
        </div>
      </div>
    </div>
  )
}

// Attribute rows for the editor: the family master's, else the existing master's. Values that are not text stay JSON.
function attrRows(data) {
  const src = (data.family_master && data.family_master.attributes) || data.attributes || []
  return src.map(a => ({ name: a.name || '', value: typeof a.value === 'string' ? a.value : a.value == null ? '' : JSON.stringify(a.value) }))
}
function parseVal(v) { const t = String(v || '').trim(); if (/^[[{]/.test(t)) { try { return JSON.parse(t) } catch { return t } } return t }

/** The writer's draft beside the current copy, score before and after; take a field or all of them (then Save). */
function SeoDraft({ wr, ed, onTake, onTakeAll, onClose, isMobile }) {
  return (
    <div style={{ marginTop: 10, border: `2px solid ${B.teal}`, borderRadius: 12, padding: 12, background: B.mint, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ font: `900 15px ${F}`, color: B.indigo, flex: 1 }}>Draft from the weighted words · score {wr.before.score} → {wr.after.score}</b>
        <span style={{ fontSize: 12, color: C.muted }}>{wr.model} · cost {wr.cost_gbp_pence}p</span>
        <Btn onClick={onTakeAll}>Take all</Btn>
        <Btn onClick={onClose}>Close</Btn>
      </div>
      {wr.notes ? <Note>{wr.notes}</Note> : null}
      {COPY_ROWS.map(([key, label, max]) => (
        <div key={key} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '90px minmax(0, 1fr) minmax(0, 1fr) 70px', gap: 8, fontSize: 12.5, alignItems: 'start', borderTop: `1px solid ${C.line2}`, paddingTop: 8 }}>
          <b>{label}</b>
          <span style={{ color: C.muted, overflowWrap: 'anywhere' }}><b style={{ display: 'block', color: C.faint, fontSize: 11 }}>NOW</b>{ed[key] || '–'}</span>
          <span style={{ overflowWrap: 'anywhere' }}><b style={{ display: 'block', color: C.ok, fontSize: 11 }}>DRAFT · {key === 'search_terms' ? `${bytesOf(wr.draft[key])} bytes` : `${(wr.draft[key] || '').length}/${max}`}</b>{wr.draft[key] || '–'}{wr.problems[key] ? <span style={{ display: 'block', color: C.bad, fontWeight: 800 }}>{wr.problems[key]}</span> : null}</span>
          <Btn onClick={() => onTake(key)} disabled={!wr.draft[key] || wr.draft[key] === ed[key]}>Take</Btn>
        </div>
      ))}
    </div>
  )
}

function ColourEditor({ data, op }) {
  const t = data.target
  const fm = data.family_master
  const names = new Map(((fm && fm.colours) || []).map(c => [c.asin, c.name]))
  const [ed, setEd] = useState(() => Object.fromEntries((t.children || []).map(a => [a, names.get(a) || ''])))
  const [busy, setBusy] = useState(false)
  const product = (a) => (data.members.find(m => m.asin === a && m.marketplace === 'UK') || data.members.find(m => m.asin === a) || {})
  const opts = (cur) => [...new Set([...(data.standard_colours || []), ...(cur ? [cur] : [])])]
  const changed = (t.children || []).some(a => (ed[a] || '') !== (names.get(a) || ''))
  const saveNames = async () => { setBusy(true); try { await op({ op: 'master_save', colours: (t.children || []).map(a => ({ asin: a, name: ed[a] || '' })) }) } finally { setBusy(false) } }
  return (
    <Panel>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, font: `900 18px ${F}`, color: B.indigo, flex: 1 }}>Colours in the family (target)</h2>
        <Btn primary onClick={saveNames} disabled={!changed || busy}>{busy ? 'Saving…' : changed ? 'Save colour names' : 'Saved'}</Btn>
      </div>
      <Note>Parent SKU <b>{t.parent_sku}</b> in every store · theme {String(t.theme || '').toLowerCase()}. English names from the standard list; other countries get the translated name at stage 4.</Note>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, fontSize: 13 }}>
        {(t.children || []).map(a => (
          <div key={a} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 190px 150px', gap: 10, alignItems: 'center', borderTop: `1px solid ${C.line2}`, paddingTop: 8 }}>
            <span><b style={{ fontFamily: 'monospace' }}>{a}</b> · {product(a).sku || ''}<div style={{ color: C.muted, fontSize: 12 }}>{String(product(a).product || '').slice(0, 70)}</div></span>
            <label><span style={{ position: 'absolute', left: -9999 }}>Colour name for {a}</span>
              <select value={ed[a] || ''} onChange={e => setEd({ ...ed, [a]: e.target.value })} style={{ ...inputStyle, minHeight: 36, width: '100%' }}>
                <option value="">Choose a colour</option>
                {opts(ed[a]).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 700 }}><input type="checkbox" checked={false} onChange={() => op({ op: 'target_pack', asin: a, pack: true })} style={{ width: 16, height: 16, accentColor: B.indigo }} />It's a pack</label>
          </div>
        ))}
        {(t.moved_out || []).map(m => (
          <div key={m.asin} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 190px 150px', gap: 10, alignItems: 'center', borderTop: `1px solid ${C.line2}`, paddingTop: 8, color: C.muted }}>
            <span><b style={{ fontFamily: 'monospace' }}>{m.asin}</b> · {product(m.asin).sku || ''}<div style={{ fontSize: 12 }}>{String(product(m.asin).product || product(m.asin).colour || '').slice(0, 70)}</div></span>
            <span style={{ fontWeight: 800, color: C.warn }}>Moves to {m.to_family}</span>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 700 }}><input type="checkbox" checked onChange={() => op({ op: 'target_pack', asin: m.asin, pack: false })} style={{ width: 16, height: 16, accentColor: B.indigo }} />It's a pack</label>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function ColoursTab({ data, isMobile, onOpen, op }) {
  const sold = data.members.filter(m => m.role !== 'parent')
  const asins = [...new Set(sold.map(m => m.asin))]
  const stores = STORE_ORDER.filter(s => sold.some(m => m.marketplace === s))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    {data.target ? <ColourEditor key={JSON.stringify(data.target) + JSON.stringify((data.family_master || {}).colours || [])} data={data} op={op} /> : null}
    <Panel pad="0" style={{ overflowX: 'auto' }}>
      <div style={{ padding: '10px 12px 0' }}><Lbl>What each store shows today</Lbl></div>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640, fontSize: 13 }}>
        <thead><tr style={{ background: B.lilac }}>{['Colour / product', 'ASIN', ...stores].map(h => <th key={h} scope="col" style={{ textAlign: 'left', padding: '10px 12px', font: `800 12.5px ${F}`, color: B.indigo }}>{h}</th>)}</tr></thead>
        <tbody>{asins.map(a => {
          const here = sold.filter(m => m.asin === a)
          const name = (here.find(m => m.marketplace === 'UK' && m.colour) || here.find(m => m.colour) || {}).colour
          return (
            <tr key={a} style={{ borderTop: `1px solid ${C.line2}` }}>
              <td style={{ padding: '9px 12px' }}><b>{name || here[0].sku}</b>{here.some(m => m.is_pack) ? <Chip style={{ marginLeft: 6 }}>pack</Chip> : null}<div style={{ color: C.muted, fontSize: 12 }}>{(here[0].product || '').slice(0, 60)}</div></td>
              <td style={{ padding: '9px 12px', fontFamily: 'monospace' }}>{a}</td>
              {stores.map(s => { const m = here.find(x => x.marketplace === s); return <td key={s} style={{ padding: '9px 12px' }}>{m ? <button type="button" onClick={() => onOpen(m)} title={`SKU ${m.sku} · ${m.role}`} style={{ background: 'none', border: 0, padding: 0, font: `800 12.5px ${F}`, color: m.colour ? B.indigo : C.bad, cursor: 'pointer', textAlign: 'left' }}>{m.colour || 'no colour name'}<span style={{ display: 'block', fontWeight: 700, fontSize: 11.5, color: m.role === 'standalone' ? C.warn : C.muted }}>{m.role === 'standalone' ? 'alone (no family)' : 'in family'}</span></button> : <span style={{ color: C.faint }}>not sold</span>}</td> })}
            </tr>
          )
        })}</tbody>
      </table>
      <div style={{ padding: '8px 12px' }}><Note>The colour name each store shows today and whether the colour sits in a family there. The target above is what every store must end up with; the Markets tab lists each gap. Click a store to open that listing.</Note></div>
    </Panel>
    </div>
  )
}

// ─── Stage 2: the gap map (read-only) ─────────────────────────────────────────────────────────────────────────────
const GAP_STYLE = { ok: [C.ok, B.mint, '✓'], bad: [C.bad, B.rose, '✗'], none: [C.faint, '#fff', ''], later: [C.muted, B.lilac, '…'], blocked: [C.warn, B.cream, '⏸'] }
const CARD_KIND = { content: 'Listing update', parent: 'New parent', move: 'Move under parent', aplus: 'A+ page send', store_review: 'Store review', aplus_review: 'A+ review' }
/** Every card waiting for this family, with one press to approve them all (Jon only; two-person cards without Laura). */
function CardsPanel({ data, reload }) {
  const [cards, setCards] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const load = () => call('/api/listings/families', { family_code: data.family.family_code, op: 'cards' }).then(r => setCards(r.cards)).catch(e => setMsg(e.message))
  useEffect(() => { load() }, [data]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!cards) return null
  const approveAll = async () => {
    setBusy(true); setMsg('')
    try {
      const r = await call('/api/listings/families', { family_code: data.family.family_code, op: 'cards_approve', ids: cards.map(c => c.id) })
      const bad = r.results.filter(x => x.error)
      setMsg(`Approved ${r.approved} of ${r.results.length}.${bad.length ? ' Not done: ' + bad.map(x => `${x.title.slice(0, 50)} (${x.error})`).join('; ') : ''}`)
      load(); reload()
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  return (
    <Panel>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, font: `900 18px ${F}`, color: B.indigo, flex: 1 }}>Waiting for your approval</h2>
        {cards.length ? <ConfirmBtn as={Btn} primary disabled={busy} onConfirm={approveAll} label={`Approve all ${cards.length}`} confirmLabel={`Click again: approve all ${cards.length} (without Laura)`} /> : <Chip bg={B.mint} fg={C.ok}>Nothing waiting</Chip>}
      </div>
      <Note>Store reviews, Doddl HQ's Amazon cards (each already passed Amazon's validation preview), new parents and moves for this family. Open any card to read it first; Approve all records you as the approver and decides the two-person cards without Laura (you said she is not needed on this family).</Note>
      {msg ? <div role="status" style={{ marginTop: 6, fontSize: 13, fontWeight: 800, color: B.indigo }}>{msg}</div> : null}
      {cards.length ? <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8, fontSize: 13, maxHeight: 280, overflow: 'auto' }}>{cards.map(c => (
        <a key={c.id} href={`/?view=approvals&task=${c.id}`} target="_blank" rel="noreferrer" style={{ display: 'flex', gap: 10, color: C.ink, textDecoration: 'none', padding: '4px 0', borderTop: `1px solid ${C.line2}` }}>
          <span style={{ minWidth: 130, fontWeight: 800, color: B.indigo }}>{CARD_KIND[c.kind] || c.kind}</span><span style={{ flex: 1 }}>{c.title}</span>
        </a>
      ))}</div> : null}
    </Panel>
  )
}

const STEP = { live: ['On Amazon', C.ok, B.mint], sent: ['Sent, waiting for Amazon', C.ok, B.mint], in_approval: ['Waiting for approval', C.warn, B.cream], submitted: ['With HQ for checks', C.warn, B.cream], refused: ['Refused', C.bad, B.rose], todo: ['To do', C.muted, '#fff'] }
function StepChip({ state }) { const [t, fg, bg] = STEP[state] || STEP.todo; return <Chip bg={bg} fg={fg}>{t}</Chip> }

/** Stage 3, one store at a time: create the parent, then move the colours (and UK packs) under it. */
function StructurePanel({ data, reload }) {
  const st = data.structure || {}
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const approved = data.family_master && data.family_master.status === 'approved'
  const send = async (market) => {
    setBusy(market); setMsg('')
    try {
      const r = await call('/api/listings/families', { family_code: data.family.family_code, op: 'structure_send', market })
      setMsg(`${market}: sent ${r.sent.length} change${r.sent.length === 1 ? '' : 's'} to Doddl HQ for checks and approval.`)
      reload()
    } catch (e) { setMsg(`${market}: ${e.message}`) } finally { setBusy('') }
  }
  const stores = STORE_ORDER.filter(s => st[s])
  const content = async (market) => {
    setBusy(`c${market}`); setMsg('')
    try {
      const r = await call('/api/listings/families', { family_code: data.family.family_code, op: 'content_send', market })
      setMsg(`${market} content: ` + r.results.map(x => x.error ? `${x.asin}: ${x.error}` : `${x.asin} ${x.sent} change${x.sent === 1 ? '' : 's'} sent${x.markets && x.markets[0] && x.markets[0].skipped ? ` (${x.markets[0].skipped} waiting)` : ''}`).join(' · '))
      reload()
    } catch (e) { setMsg(`${market}: ${e.message}`) } finally { setBusy('') }
  }
  return (
    <Panel style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, font: `900 18px ${F}`, color: B.indigo, flex: 1 }}>Structure, store by store</h2>
        {approved ? <ConfirmBtn as={Btn} disabled={!!busy} onConfirm={async () => { setBusy('t'); setMsg(''); try { const r = await call('/api/listings/families', { family_code: data.family.family_code, op: 'translate_start', budget: 7 }); setMsg(`Translations started on ${r.started.length} colours (cap $${r.budget_each} each): the agent picks them up within 10 minutes and raises one card per store.`) } catch (e) { setMsg(e.message) } finally { setBusy('') } }} label="Start translations (about $4.30, cap $7)" confirmLabel="Click again: start translations, cap $7" /> : null}
        {approved ? <ConfirmBtn as={Btn} disabled={!!busy} onConfirm={async () => { setBusy('t'); setMsg(''); try { const r = await call('/api/listings/families', { family_code: data.family.family_code, op: 'translate_resume', extra: 2, english_images: true }); setMsg('Translations carry on with English pictures in every store: ' + r.resumed.map(x => x.skipped ? x.asin + ' ' + x.skipped : x.asin + ' budget ' + x.budget).join(' · ')) } catch (e) { setMsg(e.message) } finally { setBusy('') } }} label="Carry on translations (English pictures, +$2)" confirmLabel="Click again: carry on, +$2" /> : null}
        {approved ? <Btn disabled={!!busy} onClick={async () => { setBusy('a'); setMsg(''); try { const r = await call('/api/listings/families', { family_code: data.family.family_code, op: 'aplus_send' }); setMsg('A+ to Doddl HQ: ' + r.markets.map(x => x.market + (x.sent ? ' sent' : ' ' + x.skipped)).join(' · ')) } catch (e) { setMsg(e.message) } finally { setBusy('') } }}>Send A+ to every store</Btn> : null}
        <Chip bg={stores.every(s => st[s].done) ? B.mint : B.cream} fg={stores.every(s => st[s].done) ? C.ok : C.warn}>{stores.filter(s => st[s].done).length} of {stores.length} stores done</Chip>
      </div>
      <Note>Each click raises the next step for that store: first the new parent SKU, then (once Amazon has it) each colour moved under it. Every step goes to Doddl HQ, is checked by Amazon's validation preview and becomes an approval card before anything changes.{approved ? '' : ' Approve the family master first.'}</Note>
      {msg ? <div role="status" style={{ marginTop: 8, fontSize: 13, fontWeight: 800, color: B.indigo }}>{msg}</div> : null}
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720, fontSize: 12.5, marginTop: 8 }}>
        <thead><tr style={{ background: B.lilac }}>{['Store', 'Parent', 'Children', ''].map((h, i) => <th key={i} scope="col" style={{ textAlign: 'left', padding: '8px 10px', font: `800 12.5px ${F}`, color: B.indigo }}>{h}</th>)}</tr></thead>
        <tbody>{stores.map(s => st[s].groups.map((g, gi) => (
          <tr key={`${s}|${g.parent_sku}`} style={{ borderTop: `${gi ? 1 : 2}px solid ${C.line2}`, verticalAlign: 'top' }}>
            <th scope="row" style={{ textAlign: 'left', padding: '8px 10px' }}>{gi ? '' : s}</th>
            <td style={{ padding: '8px 10px' }}><b>{g.parent_sku}</b><div style={{ marginTop: 4 }}><StepChip state={g.parent.state} /></div>{g.parent.asin ? <div style={{ color: C.muted, fontSize: 11 }}>{g.parent.asin}</div> : null}{g.parent.note && g.parent.state === 'refused' ? <div style={{ color: C.bad, fontSize: 11.5, marginTop: 4, maxWidth: 320 }}>{g.parent.note}</div> : null}</td>
            <td style={{ padding: '8px 10px' }}>{g.children.map(c => (
              <div key={c.asin} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '2px 0' }}>
                <span style={{ minWidth: 150 }}><b>{c.colour || c.sku}</b> <span style={{ color: C.muted }}>{c.asin}</span></span><StepChip state={c.state} />
                {c.note && c.state === 'refused' ? <span style={{ color: C.bad, fontSize: 11.5, maxWidth: 360 }}>{c.note}</span> : null}
              </div>
            ))}</td>
            <td style={{ padding: '8px 10px', textAlign: 'right' }}>{gi === 0 ? (st[s].done ? <Chip bg={B.mint} fg={C.ok}>Done</Chip> : st[s].next ? <Btn primary disabled={!approved || !!busy} onClick={() => send(s)}>{busy === s ? 'Sending…' : 'Send next step'}</Btn> : <span style={{ color: C.muted }}>Waiting</span>) : null}{gi === 0 ? <div style={{ marginTop: 6 }}><Btn disabled={!approved || !!busy} onClick={() => content(s)}>{busy === `c${s}` ? 'Sending…' : 'Send content'}</Btn></div> : null}</td>
          </tr>
        )))}</tbody>
      </table>
    </Panel>
  )
}

function MarketsTab({ data, isMobile, reload }) {
  const g = data.gaps
  if (!g) return <Panel><Note>No target structure for this family yet: it is set up family by family (the 2-in-1 Bowl first).</Note></Panel>
  const bad = g.rows.reduce((s, r) => s + Object.values(r.cells).filter(c => c.state === 'bad').length, 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {data.structure ? <StructurePanel data={data} reload={reload} /> : null}
      <Panel>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, font: `900 18px ${F}`, color: B.indigo, flex: 1 }}>Every market against the target and the English master</h2>
          <Chip bg={g.structure_complete ? B.mint : B.rose} fg={g.structure_complete ? C.ok : C.bad}>{g.structure_complete ? 'Structure complete' : 'Structure not complete'}</Chip>
          <Chip bg={B.cream} fg={C.warn}>{bad} gap{bad === 1 ? '' : 's'}</Chip>
        </div>
        <Note>Read-only. Structure first (parent SKU {data.target.parent_sku} in every store, both colours in the family, packs out, colour names); content follows: the UK against the English master, every other store after translation (stage 4), which starts only once the structure is complete everywhere.</Note>
      </Panel>
      <Panel pad="0" style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1100, fontSize: 12 }}>
          <thead><tr style={{ background: B.lilac }}><th scope="col" style={{ textAlign: 'left', padding: '10px 12px', font: `800 12.5px ${F}`, color: B.indigo, minWidth: 150 }}>Part</th>{g.stores.map(s => <th key={s} scope="col" style={{ textAlign: 'left', padding: '10px 8px', font: `800 12.5px ${F}`, color: B.indigo }}>{s}</th>)}</tr></thead>
          <tbody>
            {g.rows.map((r, i) => (
              <tr key={r.key} style={{ borderTop: `${i === 5 ? 3 : 1}px solid ${i === 5 ? B.indigo : C.line2}` }}>
                <th scope="row" style={{ textAlign: 'left', padding: '8px 12px', verticalAlign: 'top' }}>{r.label}<div style={{ fontWeight: 700, fontSize: 11, color: C.muted }}>{r.kind === 'structure' ? 'structure' : 'content'}</div></th>
                {g.stores.map(s => { const c = r.cells[s]; const [fg, bg, mark] = GAP_STYLE[c.state] || GAP_STYLE.none; return <td key={s} style={{ padding: '6px 8px', verticalAlign: 'top', background: bg, color: fg, fontWeight: 700, minWidth: 84, overflowWrap: 'anywhere' }}>{mark ? <b style={{ marginRight: 4 }}>{mark}</b> : null}{c.text}</td> })}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Note>✓ matches · ✗ a gap to fix (with what the store has now) · … waits for a later stage · ⏸ blocked until the structure in that store is fixed · blank: not sold there.</Note>
    </div>
  )
}

const COLOUR_EDGE = [B.pink, B.teal, B.yellow, B.indigo]
const IMG_TYPES = ['image/jpeg', 'image/png', 'image/tiff', 'image/gif']

function Thumb({ s, size = 88, onClear }) {
  return (
    <div title={`${s.slot}${s.missing ? ' · missing' : s.from === 'colour' ? ' · this colour' : ' · old shared picture'}`} style={{ position: 'relative', width: size, height: size, borderRadius: 8, overflow: 'hidden', border: `2px ${s.missing ? 'dashed' : 'solid'} ${s.missing ? B.yellow : s.from === 'colour' ? B.pink : C.line}`, background: s.missing ? B.cream : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: C.warn, flex: '0 0 auto' }}>
      {s.url ? <img src={s.url} alt={s.slot} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : 'Missing'}
      {onClear && s.url && s.from === 'colour' ? <button type="button" onClick={onClear} aria-label={`Remove ${s.slot}`} title="Remove this picture" style={{ position: 'absolute', top: 2, right: 2, width: 22, height: 22, borderRadius: 999, border: 0, background: 'rgba(61,21,125,.85)', color: '#fff', font: `800 12px ${F}`, cursor: 'pointer', lineHeight: '22px', padding: 0 }}>×</button> : null}
    </div>
  )
}

/** Next free slot for a colour, given what it already has and what is waiting in the tray. */
function nextSlot(taken) { return SLOTS.find(s => !taken.has(s)) || null }

/**
 * Bulk upload (Jon 2026-11-23: "upload all the images we want in one go … images for the colour variants only").
 * Drop every picture at once; each is matched to a colour and slot from its file name (green / rose, MAIN / PT03 / _2),
 * anything unmatched takes the next free slot of the chosen colour. Check the tray, fix any row, Save all = one write.
 */
function BulkImages({ data, colours, reload }) {
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState('')
  const [over, setOver] = useState(false)
  const [picking, setPicking] = useState(false)
  const [defColour, setDefColour] = useState(colours.length === 1 ? colours[0].asin : '')
  const im = data.images

  const placed = (asin, list) => new Set(list.filter(r => r.asin === asin).map(r => r.slot).filter(Boolean))
  const addRows = (incoming) => {
    setRows(prev => {
      const out = [...prev]
      for (const x of incoming) {
        const g = matchImageFile(x.name, colours)
        const asin = g.asin || defColour || null
        let slot = g.slot
        if (!slot && asin && asin !== 'all') slot = nextSlot(placed(asin, out))
        out.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, asin, slot, ...x })
      }
      return out
    })
  }
  const addFiles = (list) => {
    const files = [...(list || [])]
    const bad = files.filter(f => !IMG_TYPES.includes(f.type) || f.size > 20 * 1024 * 1024)
    if (bad.length) alert(`Skipped ${bad.length}: Amazon takes JPEG, PNG, TIFF or GIF under 20 MB (${bad.map(f => f.name).join(', ')})`)
    addRows(files.filter(f => !bad.includes(f)).map(f => ({ file: f, name: f.name, preview: URL.createObjectURL(f) })))
  }
  const set = (id, patch) => setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  const drop = (id) => setRows(prev => prev.filter(r => r.id !== id))

  // rows that land on the same colour + slot (All colours counts against every colour)
  const keyOf = (r) => (r.asin === 'all' ? colours.map(c => c.asin) : [r.asin]).map(a => `${a}|${r.slot}`)
  const seen = new Map()
  for (const r of rows) if (r.asin && r.slot) for (const k of keyOf(r)) seen.set(k, (seen.get(k) || 0) + 1)
  const clash = (r) => r.asin && r.slot && keyOf(r).some(k => seen.get(k) > 1)
  const incomplete = rows.filter(r => !r.asin || !r.slot).length
  const clashes = rows.filter(clash).length
  const replaces = (r) => r.asin && r.slot && (r.asin === 'all' ? colours : colours.filter(c => c.asin === r.asin)).some(c => ((im.sets.find(s => s.asin === c.asin) || {}).images || {})[r.slot])

  const saveAll = async () => {
    setBusy('Uploading…')
    try {
      const done = []
      const queue = [...rows]
      let n = 0
      const worker = async () => {
        while (queue.length) {
          const r = queue.shift()
          let url = r.url
          if (!url) {
            const target = r.asin === 'all' ? colours[0].asin : r.asin
            const u = await call('/api/listings/image-upload', { asin: target, locale: 'MASTER', name: r.name, type: r.file.type, size: r.file.size })
            const put = await fetch(u.upload_url, { method: 'PUT', headers: { 'Content-Type': r.file.type }, body: r.file })
            if (!put.ok) throw new Error(`${r.name}: upload failed (${put.status})`)
            url = u.public_url
          }
          done.push({ ...r, url })
          n += 1
          setBusy(`Uploading ${n} of ${rows.length}…`)
        }
      }
      await Promise.all([worker(), worker(), worker()])
      const items = done.flatMap(r => (r.asin === 'all' ? colours.map(c => c.asin) : [r.asin]).map(a => ({ asin: a, slot: r.slot, url: r.url })))
      setBusy('Saving…')
      const current = { master: im.master || {}, colours: Object.fromEntries((im.sets || []).map(s => [s.asin, s.images || {}])) }
      await call('/api/listings/families', { family_code: data.family.family_code, op: 'image_set', items, current })
      rows.forEach(r => r.preview && URL.revokeObjectURL(r.preview))
      setRows([])
      reload()
    } catch (e) { alert(e.message) } finally { setBusy('') }
  }

  const sel = { ...inputStyle, minHeight: 36, padding: '0 8px' }
  return (
    <Panel style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <b style={{ fontSize: 16, color: B.indigo }}>Add pictures, all at once</b>
        <label style={{ fontSize: 13, fontWeight: 800, display: 'flex', gap: 6, alignItems: 'center' }}>Unnamed files go to
          <select value={defColour} onChange={e => setDefColour(e.target.value)} style={sel}>
            <option value="">I'll choose per file</option>
            {colours.map(c => <option key={c.asin} value={c.asin}>{c.colour}</option>)}
            {colours.length > 1 ? <option value="all">Every colour</option> : null}
          </select>
        </label>
      </div>
      <label
        onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files) }}
        style={{ border: `2px dashed ${over ? B.indigo : C.border}`, background: over ? B.lilac : '#fff', borderRadius: 12, padding: '22px 16px', textAlign: 'center', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <b style={{ color: B.indigo, fontSize: 15 }}>Drop all the pictures here, or click to choose several</b>
        <span style={{ fontSize: 13, color: C.muted }}>Name files with the colour and slot and they place themselves, e.g. <code>green_MAIN.jpg</code>, <code>rose_PT03.png</code>, <code>green-2.jpg</code> (1 = MAIN, 2 = PT01 …). Use <code>both</code> for a picture every colour shares.</span>
        <input type="file" multiple accept={IMG_TYPES.join(',')} onChange={e => { addFiles(e.target.files); e.target.value = '' }} style={{ position: 'absolute', left: -9999 }} />
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setPicking(!picking)} style={pill(picking)}>{picking ? 'Close the library' : 'Add from the image library'}</button>
      </div>
      {picking ? <div style={{ border: `1px solid ${C.line2}`, borderRadius: 10, padding: 8, maxHeight: 520, overflow: 'auto' }}><MediaView compact defaultType="02 Product images" pickLabel="Add to the tray" onPick={(x) => addRows([{ url: x.url, preview: x.url, name: x.name || x.title || x.url.split('/').pop() }])} /></div> : null}

      {rows.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560, fontSize: 13 }}>
            <thead><tr style={{ background: B.lilac }}>{['', 'File', 'Colour', 'Slot', ''].map((h, i) => <th key={i} scope="col" style={{ textAlign: 'left', padding: '8px 10px', font: `800 12.5px ${F}`, color: B.indigo }}>{h}</th>)}</tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id} style={{ borderTop: `1px solid ${C.line2}`, background: clash(r) ? B.rose : (!r.asin || !r.slot) ? B.cream : '#fff' }}>
                <td style={{ padding: 6, width: 64 }}><div style={{ width: 56, height: 56, borderRadius: 6, border: `1px solid ${C.line}`, overflow: 'hidden', background: '#fff' }}><img src={r.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /></div></td>
                <td style={{ padding: '6px 10px', overflowWrap: 'anywhere', maxWidth: 260 }}>{r.name}
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: clash(r) ? C.bad : (!r.asin || !r.slot) ? C.warn : replaces(r) ? C.muted : C.ok }}>
                    {clash(r) ? 'Two pictures for the same slot' : !r.asin ? 'Choose a colour' : !r.slot ? 'Choose a slot' : replaces(r) ? 'Replaces the picture there now' : 'Fills an empty slot'}
                  </div>
                </td>
                <td style={{ padding: 6 }}><select value={r.asin || ''} onChange={e => set(r.id, { asin: e.target.value || null })} style={sel} aria-label={`Colour for ${r.name}`}>
                  <option value="">Choose…</option>
                  {colours.map(c => <option key={c.asin} value={c.asin}>{c.colour}</option>)}
                  {colours.length > 1 ? <option value="all">Every colour</option> : null}
                </select></td>
                <td style={{ padding: 6 }}><select value={r.slot || ''} onChange={e => set(r.id, { slot: e.target.value || null })} style={sel} aria-label={`Slot for ${r.name}`}>
                  <option value="">Choose…</option>
                  {SLOTS.map(s => <option key={s} value={s}>{s}</option>)}
                </select></td>
                <td style={{ padding: 6, textAlign: 'right' }}><button type="button" onClick={() => drop(r.id)} style={{ ...pill(false), minHeight: 32, padding: '0 10px' }}>Remove</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
      {rows.length ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Btn primary onClick={saveAll} disabled={!!busy || incomplete > 0 || clashes > 0}>{busy || `Save all ${rows.length}`}</Btn>
          <button type="button" onClick={() => { rows.forEach(r => r.file && r.preview && URL.revokeObjectURL(r.preview)); setRows([]) }} disabled={!!busy} style={pill(false)}>Clear the tray</button>
          <span style={{ fontSize: 13, color: incomplete || clashes ? C.warn : C.muted, fontWeight: 700 }}>
            {incomplete ? `${incomplete} still need a colour or slot. ` : ''}{clashes ? `${clashes} share a slot. ` : ''}{!incomplete && !clashes ? 'Ready. One save, nothing goes to Amazon.' : ''}
          </span>
        </div>
      ) : null}
    </Panel>
  )
}

function ImagesTab({ data, isMobile, reload }) {
  const im = data.images
  const colours = im.colours.map(c => ({ asin: c.asin, colour: c.colour }))
  const [clearing, setClearing] = useState('')
  const clear = async (asin, slot) => {
    if (!confirm(`Remove ${slot} from this colour?`)) return
    setClearing(`${asin}|${slot}`)
    try {
      const current = { master: im.master || {}, colours: Object.fromEntries((im.sets || []).map(s => [s.asin, s.images || {}])) }
      await call('/api/listings/families', { family_code: data.family.family_code, op: 'image_set', items: [{ asin, slot, url: null }], current })
      reload()
    } catch (e) { alert(e.message) } finally { setClearing('') }
  }
  const missing = im.colours.reduce((n, c) => n + c.slots.filter(s => s.missing).length, 0)
  const shared = im.colours.reduce((n, c) => n + c.slots.filter(s => !s.missing && s.from === 'master').length, 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Panel style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, lineHeight: 1.5 }}>
        <b style={{ fontSize: 16, color: B.indigo }}>Seven pictures per colour</b>
        <span>On Amazon every colour is its own listing with its own 7 pictures (MAIN, PT01–PT06); clicking a swatch swaps the whole gallery. So pictures belong to the colour variants only: packs and the parent get none here. Drop everything below in one go.</span>
        <span style={{ color: missing ? C.warn : C.ok, fontWeight: 800 }}>{missing ? `${missing} slot${missing === 1 ? '' : 's'} still empty` : 'Every colour has all 7'}{shared ? ` · ${shared} still use an older shared picture (grey): replace them with the colour's own` : ''}</span>
      </Panel>
      {colours.length ? <BulkImages data={data} colours={colours} reload={reload} /> : <Note>No colours in this family yet: set them on the Colours tab.</Note>}
      <Panel style={{ overflowX: 'auto' }}>
        <Lbl>What each colour shows (UK)</Lbl>
        <table style={{ borderCollapse: 'collapse', marginTop: 8, fontSize: 12.5 }}>
          <thead><tr><th />{SLOTS.map(s => <th key={s} scope="col" style={{ padding: 4, font: `800 12px ${F}`, color: B.indigo }}>{s}</th>)}</tr></thead>
          <tbody>{im.colours.map((c, i) => (
            <tr key={c.asin}>
              <th scope="row" style={{ textAlign: 'left', padding: '6px 10px 6px 8px', minWidth: 120, borderLeft: `6px solid ${COLOUR_EDGE[i % 4]}` }}>{c.colour}<div style={{ color: C.muted, fontWeight: 700, fontSize: 11 }}>{c.asin}</div></th>
              {c.slots.map(s => <td key={s.slot} style={{ padding: 4, opacity: clearing === `${c.asin}|${s.slot}` ? 0.4 : 1 }}><Thumb s={s} size={isMobile ? 64 : 88} onClear={() => clear(c.asin, s.slot)} /></td>)}
            </tr>
          ))}</tbody>
        </table>
        <Note style={{ marginTop: 8 }}>Pink border = this colour's own picture · grey = an older shared picture, kept until you replace it · yellow dashed = empty. × removes a colour's picture.</Note>
      </Panel>
      <Note>Saving changes the family master only (the first save copies today's pictures in, so nothing is lost). Other countries use the same sets; pictures with words get a translated copy at stage 4 (MAIN never has words).</Note>
    </div>
  )
}

const urlsIn = (v, out = []) => { if (typeof v === 'string' && /^https:\/\/.+\.(jpe?g|png|webp)/i.test(v)) out.push(v); else if (v && typeof v === 'object') for (const x of Object.values(v)) urlsIn(x, out); return out }
const textsIn = (v, out = []) => { if (typeof v === 'string' && v.length > 3 && !/^https?:/.test(v)) out.push(v); else if (v && typeof v === 'object') for (const x of Object.values(v)) textsIn(x, out); return out }
function AplusPreview({ live, phone }) {
  const imgs = [...new Set(urlsIn(live))]
  const texts = textsIn(live).slice(0, 6)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: phone ? 6 : 10 }}>
      {imgs.length ? imgs.slice(0, phone ? 4 : 8).map(u => <img key={u} src={u} alt="A+ panel" style={{ width: '100%', borderRadius: 6 }} />) : texts.map((t, i) => <div key={i} style={{ fontSize: phone ? 10 : 12, background: B.lilac, borderRadius: 6, padding: 6 }}>{t.slice(0, 160)}</div>)}
    </div>
  )
}
function AplusTab({ data, isMobile, lead, detail }) {
  const live = data.aplus.live
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {live ? (
        <Panel>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Chip bg={B.mint} fg={C.ok}>A+ is live</Chip><Lbl style={{ margin: 0 }}>What shoppers see now (UK), as read from Amazon</Lbl></div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) 260px', gap: 18, marginTop: 10, alignItems: 'start' }}>
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ background: C.grey, padding: '6px 10px', fontSize: 11, color: C.muted }}>amazon.co.uk/dp/{lead.asin} · Desktop</div>
              <AplusPreview live={live} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}><PhoneFrame width={230}><AplusPreview live={live} phone /></PhoneFrame><b style={{ fontSize: 12, color: B.indigo }}>Phone</b></div>
          </div>
        </Panel>
      ) : (
        <Panel style={{ border: `2px dashed ${C.border}` }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Chip bg={B.cream} fg={C.warn}>No A+ live yet</Chip><Lbl style={{ margin: 0 }}>Build one below: generate it from the master, or upload pictures and type the words per panel</Lbl></div>
          <Note>{data.aplus.draft ? `A draft exists (${data.aplus.draft.status}, updated ${fmtWhen(data.aplus.draft.updated_at)}).` : 'No draft yet.'} After Jon and Laura sign it off it goes with the store's send; Amazon reviews A+ (up to 7 days), then it shows here as live.</Note>
        </Panel>
      )}
      {detail({ asin: lead.asin, marketplace: lead.marketplace }, 'aplus')}
    </div>
  )
}

function TranslationCheck({ data, isMobile, onEdit }) {
  const list = ((data.master && data.master.translations) || []).filter(t => !ENGLISH.includes(t.locale))
  const [loc, setLoc] = useState(list[0] ? list[0].locale : '')
  const t = list.find(x => x.locale === loc)
  if (!list.length) return <Panel><Lbl>Translations</Lbl><Note>No translations of this master yet. They are made from the signed-off master in the master editor (Translations), one check per family per language.</Note></Panel>
  const rows = [['Title', 'title'], ['Bullet 1', 'bullet_1'], ['Search terms', 'search_terms']]
  return (
    <Panel style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, font: `900 18px ${F}`, color: B.indigo, flex: 1 }}>Check the translation</h2>
        <div role="group" aria-label="Language" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{list.map(x => <button key={x.locale} type="button" aria-pressed={loc === x.locale} onClick={() => setLoc(x.locale)} style={pill(loc === x.locale)}>{x.locale} · {LANGUAGE[x.locale] || x.locale}</button>)}</div>
      </div>
      <Note>One check per family per language, not per colour. Search terms come from that store's own Brand Analytics, not a word-for-word translation. Status: {t ? t.status : '–'}{t && t.reviewed_by ? ` · checked by ${t.reviewed_by}` : ''}.</Note>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '110px minmax(0, 1fr) minmax(0, 1fr)', gap: '8px 14px', fontSize: 13, lineHeight: 1.45 }}>
        {!isMobile ? [<b key="h0" />, <b key="h1">Master (UK English)</b>, <b key="h2">{LANGUAGE[loc] || loc}</b>] : null}
        {rows.map(([label, k]) => [
          <b key={`${k}l`}>{label}</b>,
          <span key={`${k}m`} style={{ color: C.muted, overflowWrap: 'anywhere' }}>{(data.copy || {})[k] || '–'}</span>,
          <span key={`${k}t`} style={{ overflowWrap: 'anywhere' }}>{(t && t.copy && t.copy[k]) || <span style={{ color: C.faint }}>Not translated yet</span>}</span>,
        ])}
      </div>
      <div><Btn primary onClick={onEdit}>Check and approve it in the master editor</Btn></div>
    </Panel>
  )
}

function CountriesTab({ data, isMobile, onOpen, onEdit }) {
  const sold = data.members.filter(m => m.role !== 'parent')
  const stores = STORE_ORDER.filter(s => sold.some(m => m.marketplace === s) || data.parents.some(p => p.marketplace === s))
  const langs = new Set((data.master && data.master.languages) || [])
  const notSold = ['UK', 'US', 'DE', 'FR', 'ES', 'IT', 'CA'].filter(s => !stores.includes(s))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Note>The master is written once, in UK English. This is where it goes out: which countries sell the family, each store's parent (kept as it is), the language, and what needs fixing there.</Note>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {stores.map(s => {
          const here = sold.filter(m => m.marketplace === s)
          const ps = data.parents.filter(p => p.marketplace === s)
          const probs = data.cleanup.filter(c => c.marketplace === s && c.status === 'open')
          const english = ENGLISH.includes(s)
          return (
            <Panel key={s} style={{ borderTop: `6px solid ${probs.length ? B.pink : B.teal}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><b style={{ fontSize: 20 }}>{s}</b><span style={{ fontSize: 12, fontWeight: 800, color: probs.length ? C.bad : C.ok }}>{probs.length ? `${probs.length} to fix` : 'No family problems'}</span></div>
              <span style={{ fontSize: 13 }}>{english ? 'English · the master' : `${LANGUAGE[s] || s} · ${langs.has(s) ? 'translation drafted' : 'not translated yet'}`}</span>
              <span style={{ fontSize: 13 }}>{here.length} listing{here.length === 1 ? '' : 's'}: {here.slice(0, 5).map(m => m.colour || m.sku).join(' · ')}{here.length > 5 ? ' …' : ''}</span>
              <span style={{ fontSize: 12, color: C.muted }}>{ps.length ? ps.map(p => `Parent ${p.parent_asin} · ${p.parent_sku || '?'} (${p.children} colour${p.children === 1 ? '' : 's'})`).join(' / ') : 'No parent here'}</span>
              {probs.map(c => <span key={c.problem_key} style={{ fontSize: 12, color: C.bad }}>• {c.problem}</span>)}
              {here[0] ? <Btn onClick={() => onOpen(here.find(m => m.asin === data.family.lead_asin) || here[0])} style={{ alignSelf: 'flex-start', marginTop: 4 }}>Open {s} listing</Btn> : null}
            </Panel>
          )
        })}
        {notSold.length ? (
          <Panel style={{ borderTop: `6px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <b style={{ fontSize: 18 }}>{notSold.join(' · ')}</b>
            <span style={{ fontSize: 13, color: C.muted }}>Not sold. Adding a country starts from the signed-off master: its translation (if needed), its own keyword focus and a new family there, all reviewed before anything is sent.</span>
          </Panel>
        ) : null}
      </div>
      <TranslationCheck data={data} isMobile={isMobile} onEdit={onEdit} />
    </div>
  )
}

// Rank & reviews as a grid (Jon 2026-11-23): stores across the top, colour + ASIN down the side, a date picker that
// opens on the last day read. Stars, reviews and rank (migration 47) are kept per day.
function RankTab({ data, isMobile }) {
  const sold = data.members.filter(m => m.role !== 'parent')
  const stores = STORE_ORDER.filter(s => sold.some(m => m.marketplace === s))
  const nameOf = new Map(((data.family_master && data.family_master.colours) || []).filter(c => c.name).map(c => [c.asin, c.name]))
  const asins = [...new Set(sold.map(m => m.asin))].sort((a, b) => {
    const pa = sold.some(m => m.asin === a && m.is_pack), pb = sold.some(m => m.asin === b && m.is_pack)
    return pa === pb ? 0 : pa ? 1 : -1
  })
  const label = (a) => {
    if (nameOf.get(a)) return nameOf.get(a)
    const here = sold.filter(m => m.asin === a)
    const uk = here.find(m => m.marketplace === 'UK') || here[0]
    return (here.find(m => m.colour) || {}).colour || uk.sku || a
  }
  const hist = data.rank_history || []
  const dates = [...new Set([...data.reviews.map(r => r.date), ...hist.map(r => r.date)])].sort().reverse()
  const [day, setDay] = useState(dates[0] || '')
  const latest = dates[0]
  const weekBefore = (d) => new Date(new Date(d).getTime() - 7 * 864e5).toISOString().slice(0, 10)
  const cell = (a, s) => {
    const m = sold.find(x => x.asin === a && x.marketplace === s)
    if (!m) return null
    const rv = data.reviews.filter(r => r.asin === a && r.marketplace === s)
    const now = day ? rv.find(r => r.date === day) : rv[0]
    const week = day ? rv.find(r => r.date <= weekBefore(day)) : null
    const d = now && week && now.reviews != null && week.reviews != null ? now.reviews - week.reviews : null
    // that day's best rank from the history; the latest read (listing_categories) when no history row exists for the latest date
    const onDay = hist.filter(r => r.asin === a && r.marketplace === s && r.date === day && r.sales_rank).sort((x, y) => x.sales_rank - y.sales_rank)
    const current = data.ranks.filter(r => r.asin === a && r.marketplace === s && r.sales_rank).sort((x, y) => x.sales_rank - y.sales_rank)
    const rank = onDay[0] || ((!day || day === latest) ? current[0] : null)
    const before = rank ? hist.filter(r => r.asin === a && r.marketplace === s && r.node === (rank.node || '') && r.date <= weekBefore(day || latest) && r.sales_rank)[0] : null
    return { m, now, d, rank, rankWas: before ? before.sales_rank : null }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, fontWeight: 800, display: 'flex', gap: 8, alignItems: 'center', color: B.indigo }}>Date
          <select value={day} onChange={e => setDay(e.target.value)} disabled={!dates.length} style={{ ...inputStyle, minHeight: 38 }}>
            {dates.length ? dates.map((d, i) => <option key={d} value={d}>{fmtDay(d)}{i === 0 ? ' (latest)' : ''}</option>) : <option value="">No reads yet</option>}
          </select>
        </label>
        {day && day !== latest ? <button type="button" onClick={() => setDay(latest)} style={pill(false)}>Back to latest</button> : null}
        <span style={{ fontSize: 12.5, color: C.muted }}>Change = reviews against 7 days before the date shown.</span>
      </div>
      <Panel pad="0" style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 160 + stores.length * 150, fontSize: 12.5 }}>
          <thead><tr style={{ background: B.lilac }}>
            <th scope="col" style={{ textAlign: 'left', padding: '10px 12px', font: `800 12.5px ${F}`, color: B.indigo, position: 'sticky', left: 0, background: B.lilac, zIndex: 1 }}>Colour / ASIN</th>
            {stores.map(s => <th key={s} scope="col" style={{ textAlign: 'left', padding: '10px 12px', font: `800 12.5px ${F}`, color: B.indigo }}>{s}</th>)}
          </tr></thead>
          <tbody>{asins.map(a => (
            <tr key={a} style={{ borderTop: `1px solid ${C.line2}` }}>
              <th scope="row" style={{ textAlign: 'left', padding: '8px 12px', verticalAlign: 'top', position: 'sticky', left: 0, background: '#fff', zIndex: 1, minWidth: 150 }}>
                <b>{label(a)}</b>{sold.some(m => m.asin === a && m.is_pack) ? <Chip style={{ marginLeft: 6 }}>pack</Chip> : null}
                <div style={{ color: C.muted, fontSize: 11, fontWeight: 700 }}>{a}</div>
              </th>
              {stores.map(s => {
                const c = cell(a, s)
                if (!c) return <td key={s} style={{ padding: '8px 12px', background: '#fafafa' }} />
                const { now, d, rank, rankWas } = c
                return (
                  <td key={s} style={{ padding: '8px 12px', verticalAlign: 'top', minWidth: 140 }}>
                    <div style={{ fontWeight: 800 }}>{now && now.rating != null ? `${Number(now.rating).toFixed(1)} ★` : <span style={{ color: C.faint }}>– ★</span>}
                      <span style={{ marginLeft: 8 }}>{now && now.reviews != null ? now.reviews.toLocaleString() : now ? <span style={{ color: C.warn }}>{now.status}</span> : <span style={{ color: C.faint }}>not read</span>}</span>
                      {d != null ? <span style={{ marginLeft: 6, color: d < 0 ? C.bad : d > 0 ? C.ok : C.muted }}>{d > 0 ? `+${d}` : d === 0 ? '±0' : d}</span> : null}
                    </div>
                    {rank ? <div style={{ marginTop: 2 }}>#{rank.sales_rank.toLocaleString()} <span style={{ color: C.muted }}>{rank.title}</span>{rankWas ? <span style={{ marginLeft: 6, fontWeight: 800, color: rankWas > rank.sales_rank ? C.ok : rankWas < rank.sales_rank ? C.bad : C.muted }} title={'7 days before: #' + rankWas.toLocaleString()}>{rankWas > rank.sales_rank ? '▲' : rankWas < rank.sales_rank ? '▼' : '='}</span> : null}</div> : <div style={{ marginTop: 2, color: C.faint }}>no rank read</div>}
                  </td>
                )
              })}
            </tr>
          ))}</tbody>
        </table>
      </Panel>
      {!data.reviews.length ? <Note>No stars or review counts read yet. Rank is read daily from Amazon's catalog.</Note> : null}
      <Note>Each cell: stars · reviews · change vs 7 days before · best category rank that day (▲ better / ▼ worse than 7 days before, hover for the old rank). Grey = not sold in that store. Rank history starts 23 Nov 2026.</Note>
      <Note>Alerts: review count falls, stars fall by 0.1 or more, a colour's count stops matching its family (the first sign of a split), rank halves within 3 days.</Note>
    </div>
  )
}

function EvidenceTab({ data }) {
  const ev = data.evidence
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Note>A dated screenshot of each colour's live page with the values read from it, daily and before and after every change, kept 2 years and never edited: the record to put to Amazon if reviews or rank go missing.</Note>
      {ev.length ? (
        <Panel pad="0" style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640, fontSize: 13 }}>
            <thead><tr style={{ background: B.lilac }}>{['When', 'ASIN', 'Store', 'Why taken', 'Values read', 'Screenshot'].map(h => <th key={h} scope="col" style={{ textAlign: 'left', padding: '10px 12px', font: `800 12.5px ${F}`, color: B.indigo }}>{h}</th>)}</tr></thead>
            <tbody>{ev.map(e => (
              <tr key={e.id} style={{ borderTop: `1px solid ${C.line2}` }}>
                <td style={{ padding: '8px 12px' }}>{fmtWhen(e.taken_at)}</td><td style={{ padding: '8px 12px' }}>{e.asin}</td><td style={{ padding: '8px 12px' }}>{e.marketplace}</td>
                <td style={{ padding: '8px 12px', fontWeight: 800 }}>{e.reason}{e.change_ref ? ` · ${e.change_ref}` : ''}</td>
                <td style={{ padding: '8px 12px' }}>{Object.entries(e.values || {}).map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')}</td>
                <td style={{ padding: '8px 12px', color: C.muted }}>{e.screenshot_url ? <a href={e.screenshot_url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 800, color: B.indigo }}><img src={e.screenshot_url} alt={`Screenshot of ${e.asin} in ${e.marketplace}`} style={{ width: 64, height: 40, objectFit: 'cover', objectPosition: 'top', borderRadius: 6, border: `1px solid ${C.line2}` }} />Open</a> : e.screenshot_key ? e.screenshot_key.split('/').pop() : '–'}</td>
              </tr>
            ))}</tbody>
          </table>
        </Panel>
      ) : <Panel><Note>No snapshots yet: capture starts once the review source is switched on. The clean-up takes one before and after every change.</Note></Panel>}
    </div>
  )
}
