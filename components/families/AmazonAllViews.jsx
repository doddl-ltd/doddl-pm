import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { C, Panel, H2, Lbl, Note, Chip, Btn, StateLine, inputStyle, fmtDay, fmtWhen } from '../approvals/renderers/reviewKit'

// Amazon › Rank & reviews and Amazon › Evidence: every child ASIN in the four review stores on one page, and every
// evidence screenshot (mock-up boards 11 and 12). Read-only.

const B = { indigo: '#3D157D', teal: '#30BEAA', pink: '#dd6c92', yellow: '#e8b724', lilac: '#f3effb', mint: '#e8f7f4', cream: '#fff6dc', rose: '#fdeef3' }
const F = "'Nunito', sans-serif"
const pill = (on) => ({ minHeight: 36, padding: '0 14px', borderRadius: 999, border: `1px solid ${on ? B.indigo : C.border}`, background: on ? B.indigo : '#fff', color: on ? '#fff' : B.indigo, font: `800 12.5px ${F}`, cursor: 'pointer' })
const th = { textAlign: 'left', padding: '10px 12px', font: `800 12.5px ${F}`, color: B.indigo, whiteSpace: 'nowrap' }
const td = { padding: '8px 12px', verticalAlign: 'top' }

function useJson(url) {
  const [state, setState] = useState({ data: null, error: '' })
  useEffect(() => {
    let live = true
    setState(s => ({ data: s.data, error: '' }))
    apiFetch(url).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Could not load (${r.status})`); if (live) setState({ data: j, error: '' }) })
      .catch(e => { if (live) setState({ data: null, error: e.message }) })
    return () => { live = false }
  }, [url])
  return [state.data, state.error]
}

const STATUS_TXT = { ok: '', no_reviews: 'No reviews yet', missing: 'Page not found', blocked: 'Robot check', error: 'Read failed' }

export function RankAll({ isMobile }) {
  const [data, error] = useJson('/api/listings/rank')
  const [store, setStore] = useState('all')
  const [fam, setFam] = useState('')
  const [alertsOnly, setAlertsOnly] = useState(false)
  const rows = useMemo(() => ((data && data.rows) || []).filter(r => (store === 'all' || r.marketplace === store) && (!fam || r.family_code === fam) && (!alertsOnly || r.alerts.length)), [data, store, fam, alertsOnly])
  const alerts = ((data && data.rows) || []).filter(r => r.alerts.length)
  return (
    <div style={{ padding: isMobile ? '0 4px 16px' : '0 16px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <H2 style={{ margin: 0 }}>Sales rank and reviews</H2>
        <Note>Every colour in UK, DE, FR and US. Stars and review count are read from each product page every morning (with a screenshot); rank comes from Amazon's catalog daily.{data && data.latest ? ` Latest reading ${fmtDay(data.latest)}.` : ''}</Note>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div role="group" aria-label="Store" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['all', ...((data && data.stores) || [])].map(s => <button key={s} type="button" aria-pressed={store === s} style={pill(store === s)} onClick={() => setStore(s)}>{s === 'all' ? 'All stores' : s}</button>)}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 800 }}>Family
          <select value={fam} onChange={e => setFam(e.target.value)} style={{ ...inputStyle, minHeight: 36, width: 220 }}>
            <option value="">All families</option>
            {((data && data.families) || []).map(f => <option key={f.family_code} value={f.family_code}>{f.name}</option>)}
          </select>
        </label>
        <button type="button" aria-pressed={alertsOnly} style={{ ...pill(alertsOnly), borderColor: alertsOnly ? B.pink : C.border, background: alertsOnly ? B.pink : '#fff', color: alertsOnly ? '#fff' : '#a33d62' }} onClick={() => setAlertsOnly(!alertsOnly)}>Alerts {data ? alerts.length : ''}</button>
      </div>
      <StateLine loading={!data && !error} error={error} empty={data && !rows.length ? 'Nothing matches.' : ''} />
      {rows.length ? (
        <Panel pad="0" style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900, fontSize: 13 }}>
            <thead><tr style={{ background: B.lilac }}>{['Colour / product', 'Family', 'Store', 'Best category rank', 'Stars', 'Reviews', 'vs 7 days ago', 'Read', 'Snapshot'].map(h => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
            <tbody>{rows.map(r => (
              <tr key={`${r.asin}|${r.marketplace}`} style={{ borderTop: `1px solid ${C.line2}`, background: r.alerts.length ? B.rose : 'transparent' }}>
                <td style={td}><b>{r.colour || r.sku}</b>{r.is_pack ? <Chip style={{ marginLeft: 6 }}>pack</Chip> : null}<div style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace' }}>{r.asin}</div>{r.alerts.map(a => <div key={a} style={{ color: C.bad, fontSize: 12, fontWeight: 800 }}>{a}</div>)}</td>
                <td style={td}>{r.family}</td>
                <td style={td}>{r.marketplace}</td>
                <td style={td}>{r.rank ? <>#{r.rank.sales_rank.toLocaleString()} <span style={{ color: C.muted }}>{r.rank.title}</span></> : <span style={{ color: C.faint }}>–</span>}</td>
                <td style={td}>{r.rating != null ? `${Number(r.rating).toFixed(1)} ★` : '–'}</td>
                <td style={td}>{r.reviews != null ? r.reviews.toLocaleString() : r.status && STATUS_TXT[r.status] ? <span style={{ color: C.warn, fontWeight: 800 }}>{STATUS_TXT[r.status]}</span> : '–'}</td>
                <td style={{ ...td, fontWeight: 800, color: r.week_change == null ? C.faint : r.week_change < 0 ? C.bad : r.week_change > 0 ? C.ok : C.muted }}>{r.week_change == null ? '–' : r.week_change > 0 ? `+${r.week_change}` : r.week_change === 0 ? 'no change' : r.week_change}</td>
                <td style={{ ...td, color: C.muted, whiteSpace: 'nowrap' }}>{r.date ? fmtDay(r.date) : '–'}</td>
                <td style={td}>{r.screenshot_url ? <a href={r.screenshot_url} target="_blank" rel="noreferrer" style={{ fontWeight: 800, color: B.indigo }}>View</a> : '–'}</td>
              </tr>
            ))}</tbody>
          </table>
        </Panel>
      ) : null}
      <Panel style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: 14, fontSize: 13, lineHeight: 1.45 }}>
        <div><Lbl>Alerts</Lbl>Review count falls (any amount) · stars fall by 0.1 or more on the week · a colour shows fewer reviews than the rest of its family in the same store (the first sign of a split).</div>
        <div><Lbl>Stars and reviews</Lbl>Read from the live product page each morning by Chrome on Jon's PC, at the same moment the screenshot is taken. A missed morning shows as a gap.</div>
        <div><Lbl>Rank</Lbl>From Amazon's catalog, every category the listing ranks in; the best one is shown.</div>
      </Panel>
    </div>
  )
}

const REASONS = [['', 'Any reason'], ['daily', 'Daily'], ['before', 'Before a change'], ['after', 'After a change']]
const csvCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`

export function EvidenceAll({ isMobile }) {
  const [store, setStore] = useState('')
  const [asin, setAsin] = useState('')
  const [reason, setReason] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const qs = new URLSearchParams(Object.entries({ store, asin: asin.trim(), reason, from, to }).filter(([, v]) => v)).toString()
  const [data, error] = useJson(`/api/listings/evidence${qs ? `?${qs}` : ''}`)
  const rows = (data && data.rows) || []
  // Case pack: the filtered snapshots as a CSV (when, store, ASIN, reason, values, screenshot link valid for 6 hours).
  const casePack = () => {
    const head = ['taken_at', 'store', 'asin', 'family', 'colour', 'reason', 'change_ref', 'rating', 'reviews', 'title', 'page_url', 'screenshot_link_6h']
    const lines = rows.map(r => [r.taken_at, r.marketplace, r.asin, r.family, r.colour, r.reason, r.change_ref, r.values && r.values.rating, r.values && r.values.reviews, r.values && r.values.title, r.values && r.values.url, r.screenshot_url].map(csvCell).join(','))
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `doddl-amazon-evidence-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }
  return (
    <div style={{ padding: isMobile ? '0 4px 16px' : '0 16px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px' }}>
          <H2 style={{ margin: 0 }}>Evidence</H2>
          <Note>A dated full-page screenshot of each colour's live page with the values read from it: every morning, and before and after every change. Never edited once taken; the record to put to Amazon if reviews or rank go missing.</Note>
        </div>
        <Btn primary onClick={casePack} disabled={!rows.length}>Build an Amazon case pack</Btn>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, fontWeight: 800 }}>Store
          <select value={store} onChange={e => setStore(e.target.value)} style={{ ...inputStyle, minHeight: 36, width: 120 }}><option value="">All</option>{['UK', 'DE', 'FR', 'US'].map(s => <option key={s} value={s}>{s}</option>)}</select></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, fontWeight: 800 }}>ASIN
          <input value={asin} onChange={e => setAsin(e.target.value)} placeholder="B0…" style={{ ...inputStyle, minHeight: 36, width: 150 }} /></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, fontWeight: 800 }}>Why taken
          <select value={reason} onChange={e => setReason(e.target.value)} style={{ ...inputStyle, minHeight: 36, width: 170 }}>{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, fontWeight: 800 }}>From
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...inputStyle, minHeight: 36, width: 150 }} /></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, fontWeight: 800 }}>To
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...inputStyle, minHeight: 36, width: 150 }} /></label>
      </div>
      <StateLine loading={!data && !error} error={error} empty={data && !rows.length ? 'No snapshots match.' : ''} />
      {rows.length ? (
        <Panel pad="0" style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 860, fontSize: 13 }}>
            <thead><tr style={{ background: B.lilac }}>{['Screenshot', 'When', 'Colour / family', 'Store', 'Why taken', 'Stars', 'Reviews', 'Page'].map(h => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
            <tbody>{rows.map(r => {
              const v = r.values || {}
              return (
                <tr key={r.id} style={{ borderTop: `1px solid ${C.line2}` }}>
                  <td style={td}>{r.screenshot_url ? <a href={r.screenshot_url} target="_blank" rel="noreferrer" aria-label={`Open the screenshot of ${r.asin} in ${r.marketplace}`}><img src={r.screenshot_url} alt="" loading="lazy" style={{ width: 96, height: 60, objectFit: 'cover', objectPosition: 'top', borderRadius: 6, border: `1px solid ${C.line2}`, display: 'block' }} /></a> : <span style={{ color: C.faint }}>–</span>}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtWhen(r.taken_at)}</td>
                  <td style={td}><b>{r.colour || r.asin}</b><div style={{ color: C.muted, fontSize: 12 }}>{r.family || ''} · <span style={{ fontFamily: 'monospace' }}>{r.asin}</span></div></td>
                  <td style={td}>{r.marketplace}</td>
                  <td style={{ ...td, fontWeight: 800, color: r.reason === 'daily' ? C.muted : B.indigo }}>{r.reason}{r.change_ref ? <div style={{ fontWeight: 700, fontSize: 12 }}>{r.change_ref}</div> : null}</td>
                  <td style={td}>{v.rating != null ? `${Number(v.rating).toFixed(1)} ★` : '–'}</td>
                  <td style={td}>{v.reviews != null ? Number(v.reviews).toLocaleString() : v.status && STATUS_TXT[v.status] ? <span style={{ color: C.warn, fontWeight: 800 }}>{STATUS_TXT[v.status]}</span> : '–'}</td>
                  <td style={td}>{v.url ? <a href={v.url} target="_blank" rel="noreferrer" style={{ color: B.indigo, fontWeight: 800 }}>Amazon</a> : '–'}</td>
                </tr>
              )
            })}</tbody>
          </table>
        </Panel>
      ) : null}
      <Note>Case pack: a CSV of the snapshots shown (dates, values, what changed and the screenshot links) to attach to a Seller Support case; open each screenshot to save the image itself. Up to 400 newest snapshots per filter.</Note>
    </div>
  )
}
