import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { C, Panel, H2, Lbl, Note, Chip, Btn, StateLine, PhoneFrame, inputStyle, fmtDay, fmtWhen } from '../approvals/renderers/reviewKit'
import { Detail } from '../ListingsView'
import { SLOTS } from '../../lib/pm/families'
import { ENGLISH, LANGUAGE } from '../../lib/pm/marketImages'

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
const signedOff = (f) => !!(f.signoff && f.signoff.Jon && f.signoff.Laura)
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
                <td style={{ padding: '10px 12px', fontWeight: 800, color: f.signoff && f.signoff.Jon && f.signoff.Laura ? C.ok : C.warn }}>{f.signoff && f.signoff.Jon && f.signoff.Laura ? 'Signed off' : f.master === 'approved' ? 'Approved' : f.master ? 'Draft' : 'None yet'}</td>
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
const TABS = [['master', 'Master'], ['colours', 'Colours'], ['images', 'Images'], ['aplus', 'A+ page'], ['countries', 'Countries'], ['rank', 'Rank & reviews'], ['evidence', 'Evidence']]

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
  const signed = f.signoff || {}
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
      <div style={{ background: signed.Jon && signed.Laura ? B.mint : B.cream, border: `1px solid ${signed.Jon && signed.Laura ? B.teal : B.yellow}`, borderRadius: 14, padding: '12px 18px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 15, color: signed.Jon && signed.Laura ? C.ok : '#8a6400' }}>{signed.Jon && signed.Laura ? 'Master signed off' : 'Draft'}{data.master ? ` · master ${data.master.master_sku || data.master.asin} (${data.master.status})` : ' · no master yet'}</b>
        <span style={{ flex: '1 1 240px', fontSize: 14, color: C.muted }}>Every colour and country is built from the signed-off master. Sign-off needs both names.</span>
        <span style={{ fontSize: 13, fontWeight: 800 }}>Jon {signed.Jon ? `✓ ${fmtDay(signed.Jon)}` : '○'} · Laura {signed.Laura ? `✓ ${fmtDay(signed.Laura)}` : '○'}</span>
        <Btn primary onClick={() => op({ op: 'signoff' })}>Sign off the master</Btn>
      </div>
      {tab === 'master' ? <MasterTab data={data} isMobile={isMobile} op={op} lead={ukLead} reload={reload} onEdit={() => setOpen({ ...ukLead, startTab: 'master' })} /> : null}
      {tab === 'colours' ? <ColoursTab data={data} isMobile={isMobile} onOpen={(m) => setOpen({ asin: m.asin, marketplace: m.marketplace, startTab: false })} /> : null}
      {tab === 'images' ? <ImagesTab data={data} isMobile={isMobile} op={op} onEdit={() => setOpen({ ...ukLead, startTab: 'master' })} /> : null}
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
  const P = [['Top searches in the title', s.parts.title, 30], ['In bullets or description', s.parts.bullets, 15], ['In the search terms', s.parts.terms, 10], ['Space used', s.parts.space, 10], ['Images', s.parts.images, 15], ['A+ page live', s.parts.aplus, 5], ['Family and attributes', s.parts.family, 5]]
  const copy = data.copy || {}
  const attrs = (data.master && data.master.attributes) || []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) minmax(0, 1.1fr)', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <Panel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, font: `900 18px ${F}`, color: B.indigo, flex: 1 }}>Copy (UK English)</h2>
              <Btn onClick={onEdit}>Write new copy from the keywords</Btn>
            </div>
            <Note>{data.copy_source === 'master' ? 'From the family master.' : 'From the live UK listing: no master copy yet.'} Edit opens the master editor (copy, attributes, images, translations, send per store).</Note>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '84px minmax(0, 1fr) 44px' : '104px minmax(0, 1fr) 64px 40px', gap: '8px 10px', fontSize: 13.5, lineHeight: 1.45, marginTop: 8, alignItems: 'start' }}>
              {COPY_ROWS.map(([k, label, max]) => {
                const v = copy[k] || ''
                const n = k === 'search_terms' ? bytesOf(v) : v.length
                return [
                  <b key={`${k}l`}>{label}</b>,
                  <span key={`${k}v`} style={{ color: v ? C.ink : C.faint, overflowWrap: 'anywhere' }}>{v ? (v.length > 220 ? `${v.slice(0, 220)}…` : v) : 'Empty'}</span>,
                  <span key={`${k}n`} style={{ fontSize: 12, fontWeight: 800, color: n > max ? C.bad : n ? C.ok : C.faint }}>{n}/{max}{k === 'search_terms' ? ' B' : ''}</span>,
                  isMobile ? null : <button key={`${k}e`} type="button" onClick={onEdit} style={editLink}>Edit</button>,
                ]
              })}
            </div>
          </Panel>
          <Panel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ margin: 0, font: `900 18px ${F}`, color: B.indigo, flex: 1 }}>Attributes shared by every colour</h2>
              <button type="button" onClick={onEdit} style={editLink}>+ Add attribute</button>
            </div>
            {attrs.length ? (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, minmax(0, 1fr))', gap: 8, marginTop: 10, fontSize: 13 }}>
                {attrs.map(([k, v]) => <div key={k} style={{ background: C.grey || '#f6f4fa', borderRadius: 10, padding: 10, display: 'flex', justifyContent: 'space-between', gap: 6 }}><span style={{ minWidth: 0, overflowWrap: 'anywhere' }}><b style={{ display: 'block' }}>{k}</b>{v}</span><button type="button" onClick={onEdit} style={editLink}>Edit</button></div>)}
              </div>
            ) : <Note style={{ marginTop: 6 }}>No attributes in the master yet: add them in the master editor.</Note>}
          </Panel>
          <Panel>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}><h2 style={{ margin: 0, font: `900 18px ${F}`, color: B.indigo }}>SEO score (UK)</h2><span style={{ font: `900 32px ${F}` }}><Score v={s.score} /></span></div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '4px 24px', fontSize: 13, marginTop: 6 }}>
              {P.map(([t, v, max]) => <div key={t} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t}</span><b style={{ color: v < max / 2 ? C.bad : C.ink }}>{v} / {max}</b></div>)}
              <div style={{ display: 'flex', justifyContent: 'space-between', color: s.penalties.length ? C.bad : C.ink }}><span>Penalties</span><b>{s.penalties.length ? `−${s.penalties.reduce((a, [, v]) => a + v, 0)}` : 0}</b></div>
            </div>
            {s.penalties.map(([t, v]) => <div key={t} style={{ fontSize: 12.5, color: C.bad }}>• {t} (−{v})</div>)}
            <Note style={{ marginTop: 8 }}>Keywords weighted by search volume over the {s.basis}; parts add to 90 and are shown out of 100.</Note>
          </Panel>
        </div>
        <Panel style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><h2 style={{ margin: 0, font: `900 18px ${F}`, color: B.indigo, flex: 1 }}>Keyword focus (UK)</h2><Btn onClick={reload}>Refresh volumes</Btn></div>
          <Note>Brand Analytics, every colour in the family{k.period_from ? `, ${fmtDay(k.period_from)} – ${fmtDay(k.period_to)}` : ''}. Sent daily by the Hub; reopen this tab to see the latest.</Note>
          <div style={{ overflowX: 'auto', marginTop: 6 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 520, fontSize: 12.5 }}>
              <thead><tr>{['Search', 'Volume', 'Shown', 'Clicks', 'Buys', 'Conv.', 'Where', 'Focus'].map(h => <th key={h} scope="col" style={{ textAlign: 'left', padding: '4px 6px', color: C.muted, fontWeight: 800 }}>{h}</th>)}</tr></thead>
              <tbody>{(all ? k.focus : k.focus.slice(0, 20)).map(x => (
                <tr key={x.search_query} style={{ borderTop: `1px solid ${C.line2}`, opacity: x.choice === 'watch' ? 0.6 : 1, background: x.choice === 'focus' ? B.mint : 'transparent' }}>
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
              {k.removed.map(x => <div key={x.search_query} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}><span style={{ flex: 1, color: C.muted }}>{x.search_query}</span><span>{x.query_volume == null ? '–' : x.query_volume.toLocaleString()}</span><button type="button" onClick={() => choose(x.search_query, 'auto')} style={{ background: 'none', border: 0, color: B.indigo, font: `800 12px ${F}`, cursor: 'pointer' }}>Restore</button></div>)}
            </details>
          ) : null}
          <Note style={{ marginTop: 6 }}>Shown, clicks and buys are doddl's own on each search; Amazon's share of all impressions and clicks needs the Hub to send the search totals too.</Note>
          {k.suggested.length ? (
            <div style={{ marginTop: 10 }}>
              <Lbl>Suggested searches not on the listing</Lbl>
              {k.suggested.map(x => <div key={x.search_query} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, padding: '3px 0' }}><span style={{ flex: 1 }}>{x.search_query}{x.store_wide ? <span style={{ color: C.muted }}> · store-wide</span> : null}</span><span>{(x.query_volume || 0).toLocaleString()}</span><button type="button" onClick={() => add(x.search_query)} style={{ background: 'none', border: 0, color: B.indigo, font: `800 12.5px ${F}`, cursor: 'pointer' }}>+ Add to focus</button><button type="button" onClick={() => choose(x.search_query, 'out')} style={{ background: 'none', border: 0, color: C.muted, font: `800 12.5px ${F}`, cursor: 'pointer' }}>Not relevant</button></div>)}
            </div>
          ) : null}
          <form onSubmit={e => { e.preventDefault(); add(kw) }} style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <label style={{ flex: 1 }}><span style={{ position: 'absolute', left: -9999 }}>Add your own keyword</span><input value={kw} onChange={e => setKw(e.target.value)} placeholder="Add your own keyword, e.g. plate for toddlers 2 years" style={{ ...inputStyle, width: '100%', minHeight: 38 }} /></label>
            <Btn primary type="submit">Add</Btn>
          </form>
        </Panel>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Btn primary onClick={onEdit}>Open the master editor</Btn>
        <Note style={{ margin: 0 }}>Copy, attributes, images, translations and the send per store. The family master is the master of {lead.asin}, shared by every colour.</Note>
      </div>
    </div>
  )
}

function ColoursTab({ data, isMobile, onOpen }) {
  const sold = data.members.filter(m => m.role !== 'parent')
  const asins = [...new Set(sold.map(m => m.asin))]
  const stores = STORE_ORDER.filter(s => sold.some(m => m.marketplace === s))
  return (
    <Panel pad="0" style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640, fontSize: 13 }}>
        <thead><tr style={{ background: B.lilac }}>{['Colour / product', 'ASIN', ...stores].map(h => <th key={h} scope="col" style={{ textAlign: 'left', padding: '10px 12px', font: `800 12.5px ${F}`, color: B.indigo }}>{h}</th>)}</tr></thead>
        <tbody>{asins.map(a => {
          const here = sold.filter(m => m.asin === a)
          const name = (here.find(m => m.marketplace === 'UK' && m.colour) || here.find(m => m.colour) || {}).colour
          return (
            <tr key={a} style={{ borderTop: `1px solid ${C.line2}` }}>
              <td style={{ padding: '9px 12px' }}><b>{name || here[0].sku}</b>{here.some(m => m.is_pack) ? <Chip style={{ marginLeft: 6 }}>pack</Chip> : null}<div style={{ color: C.muted, fontSize: 12 }}>{(here[0].product || '').slice(0, 60)}</div></td>
              <td style={{ padding: '9px 12px', fontFamily: 'monospace' }}>{a}</td>
              {stores.map(s => { const m = here.find(x => x.marketplace === s); return <td key={s} style={{ padding: '9px 12px' }}>{m ? <button type="button" onClick={() => onOpen(m)} title={`${m.sku} · ${m.role}`} style={{ background: 'none', border: 0, padding: 0, font: `800 12.5px ${F}`, color: m.role === 'standalone' ? C.warn : B.indigo, cursor: 'pointer', textAlign: 'left' }}>{m.colour || m.sku}{m.role === 'standalone' ? ' (alone)' : ''}</button> : <span style={{ color: C.faint }}>–</span>}</td> })}
            </tr>
          )
        })}</tbody>
      </table>
      <div style={{ padding: '8px 12px' }}><Note>Each colour holds only what differs from the master (colour name, its own images). Click a store to open that listing.</Note></div>
    </Panel>
  )
}

function Thumb({ s, size = 88 }) {
  return <div title={`${s.slot} · ${s.from}`} style={{ width: size, height: size, borderRadius: 8, overflow: 'hidden', border: `2px ${s.missing ? 'dashed' : 'solid'} ${s.missing ? B.yellow : s.from === 'colour' ? B.pink : C.line}`, background: s.missing ? B.cream : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: C.warn, flex: '0 0 auto' }}>{s.url ? <img src={s.url} alt={`${s.slot}`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : 'Missing'}</div>
}
function ImagesTab({ data, isMobile, op, onEdit }) {
  const im = data.images
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Panel style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '300px minmax(0, 1fr)', gap: 20, alignItems: 'center' }}>
        <div aria-hidden="true" style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, display: 'flex', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{[B.rose, B.lilac, B.lilac, B.rose].map((c, i) => <span key={i} style={{ width: 26, height: 26, borderRadius: 4, background: c, border: i === 0 ? `2px solid ${B.pink}` : 0 }} />)}</div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ height: 110, borderRadius: 8, background: B.rose, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#a33d62' }}>{(im.colours[0] && im.colours[0].colour) || 'Colour'} on white</div>
            <div style={{ display: 'flex', gap: 6 }}>{im.colours.slice(0, 4).map((c, i) => <span key={c.asin} style={{ width: 30, height: 30, borderRadius: 6, background: [B.pink, B.teal, B.yellow, B.indigo][i], outline: i === 0 ? `3px solid ${B.indigo}` : 0, outlineOffset: 1 }} />)}</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, lineHeight: 1.5 }}>
          <b style={{ fontSize: 16, color: B.indigo }}>Master + colour, combined per colour</b>
          <span>On Amazon every colour is its own listing with its own 7 images. Clicking a colour swatch swaps the whole gallery to that colour's 7; the parent's images are never shown.</span>
          <span>doddlHQ keeps one <b>master set</b> (pictures that look the same in any colour) and a <b>colour set</b> for each colour (where the colour shows), builds each colour's 7 from the slot map below, and sends them to that colour's own listing. A missing colour picture is never borrowed from another colour.</span>
        </div>
      </Panel>
      <Panel style={{ overflowX: 'auto' }}>
        <Lbl>What each colour shows (UK)</Lbl>
        <table style={{ borderCollapse: 'collapse', marginTop: 8, fontSize: 12.5 }}>
          <thead><tr><th />{SLOTS.map(s => <th key={s} scope="col" style={{ padding: 4 }}>
            <button type="button" onClick={() => op({ op: 'slot', slot: s, from: im.slot_map[s] === 'colour' ? 'master' : 'colour' })} title="Switch between master and by colour" style={{ ...pill(im.slot_map[s] === 'colour'), minHeight: 30, padding: '0 10px', fontSize: 12 }}>{s} · {im.slot_map[s] === 'colour' ? 'colour' : 'master'}</button>
          </th>)}</tr></thead>
          <tbody>{im.colours.map(c => (
            <tr key={c.asin}><th scope="row" style={{ textAlign: 'left', padding: '6px 10px 6px 0', minWidth: 120 }}>{c.colour}<div style={{ color: C.muted, fontWeight: 700, fontSize: 11 }}>{c.asin}</div></th>{c.slots.map(s => <td key={s.slot} style={{ padding: 4 }}><Thumb s={s} size={isMobile ? 64 : 88} /></td>)}</tr>
          ))}</tbody>
        </table>
        {!im.colours.length ? <Note>No UK colours in this family yet.</Note> : null}
        <Note style={{ marginTop: 8 }}>Pink border = the colour's own picture; grey = the master picture shared by every colour. Click a slot heading to switch it.</Note>
      </Panel>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
        <Panel style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <b style={{ fontSize: 16, color: B.indigo }}>Master set</b>
          <span style={{ fontSize: 13, color: C.muted }}>{SLOTS.filter(s => im.slot_map[s] !== 'colour').join(', ') || 'No slots'} · used by every colour</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{(im.master || []).filter(x => x.url).slice(0, 6).map(x => <Thumb key={x.slot} s={{ ...x, from: 'master' }} size={48} />)}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Btn onClick={onEdit}>Upload</Btn><Btn onClick={onEdit}>Pick from library</Btn></div>
        </Panel>
        {im.colours.map((c, i) => (
          <Panel key={c.asin} style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: `6px solid ${[B.pink, B.teal, B.yellow, B.indigo][i % 4]}` }}>
            <b style={{ fontSize: 16, color: B.indigo }}>{c.colour} set</b>
            <span style={{ fontSize: 13, color: C.muted }}>{SLOTS.filter(s => im.slot_map[s] === 'colour').join(', ') || 'No colour slots'}{c.slots.some(s => s.missing) ? ` · ${c.slots.filter(s => s.missing).length} missing` : ''}</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{c.slots.filter(s => s.from === 'colour').map(s => <Thumb key={s.slot} s={s} size={48} />)}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Btn onClick={onEdit}>Upload</Btn><Btn onClick={onEdit}>Pick from library</Btn></div>
          </Panel>
        ))}
      </div>
      <Note>Upload and Pick open the master's image editor (the image library picker is there). Other countries use the same sets; pictures with words get a translated copy (MAIN never has words), shown on Countries.</Note>
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

function RankTab({ data, isMobile }) {
  const sold = data.members.filter(m => m.role !== 'parent')
  const byKey = (a, m) => data.reviews.filter(r => r.asin === a && r.marketplace === m)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Panel pad="0" style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720, fontSize: 13 }}>
          <thead><tr style={{ background: B.lilac }}>{['Colour / product', 'Store', 'Best category rank', 'Stars', 'Reviews', 'vs 7 days ago', 'Read'].map(h => <th key={h} scope="col" style={{ textAlign: 'left', padding: '10px 12px', font: `800 12.5px ${F}`, color: B.indigo }}>{h}</th>)}</tr></thead>
          <tbody>{sold.sort((a, b) => STORE_ORDER.indexOf(a.marketplace) - STORE_ORDER.indexOf(b.marketplace)).map(m => {
            const ranks = data.ranks.filter(r => r.asin === m.asin && r.marketplace === m.marketplace && r.sales_rank).sort((a, b) => a.sales_rank - b.sales_rank)
            const rv = byKey(m.asin, m.marketplace)
            const now = rv[0], week = rv.find(r => r.date <= new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10))
            const d = now && week && now.reviews != null && week.reviews != null ? now.reviews - week.reviews : null
            return (
              <tr key={`${m.asin}|${m.marketplace}`} style={{ borderTop: `1px solid ${C.line2}` }}>
                <td style={{ padding: '8px 12px' }}><b>{m.colour || m.sku}</b><div style={{ color: C.muted, fontSize: 11 }}>{m.asin}</div></td>
                <td style={{ padding: '8px 12px' }}>{m.marketplace}</td>
                <td style={{ padding: '8px 12px' }}>{ranks[0] ? `#${ranks[0].sales_rank.toLocaleString()} ${ranks[0].title}` : <span style={{ color: C.faint }}>–</span>}{ranks.length > 1 ? <div style={{ color: C.muted, fontSize: 11 }}>{ranks.slice(1, 3).map(r => `#${r.sales_rank.toLocaleString()} ${r.title}`).join(' · ')}</div> : null}</td>
                <td style={{ padding: '8px 12px' }}>{now && now.rating != null ? `${Number(now.rating).toFixed(1)} ★` : '–'}</td>
                <td style={{ padding: '8px 12px' }}>{now && now.reviews != null ? now.reviews.toLocaleString() : now ? <span style={{ color: C.warn }}>{now.status}</span> : '–'}</td>
                <td style={{ padding: '8px 12px', fontWeight: 800, color: d == null ? C.faint : d < 0 ? C.bad : d > 0 ? C.ok : C.muted }}>{d == null ? '–' : d > 0 ? `+${d}` : d === 0 ? 'no change' : d}</td>
                <td style={{ padding: '8px 12px', color: C.muted }}>{now ? fmtDay(now.date) : ranks[0] ? fmtDay(ranks[0].read_on) : '–'}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </Panel>
      {!data.reviews.length ? <Note>Stars and review counts: capture starts once the review source is switched on. Rank is read daily from Amazon's catalog.</Note> : null}
      <Note>Alerts (once capture runs): review count falls, stars fall by 0.1 or more, a colour's count stops matching its family (the first sign of a split), rank halves within 3 days.</Note>
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
