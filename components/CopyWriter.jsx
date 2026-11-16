import { useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { C, Note } from './approvals/renderers/reviewKit'

// Master › Copy › "Write new copy" (Jon 2026-11-16): key terms in, Claude writes a new title, bullets, description and
// search terms from them, the UK Brand Analytics searches, the product facts and the copy in place
// (lib/pm/copyWriter.js). The person takes the fields they want; each one saves to the master like a hand edit.
const LABEL = { title: 'Title', bullet_1: 'Bullet 1', bullet_2: 'Bullet 2', bullet_3: 'Bullet 3', bullet_4: 'Bullet 4', bullet_5: 'Bullet 5', description: 'Description', search_terms: 'Search terms' }
const btn = (primary) => ({ minHeight: 36, padding: '0 14px', borderRadius: 10, border: `1px solid ${primary ? C.indigo : C.border}`, background: primary ? C.indigo : '#fff', color: primary ? '#fff' : C.indigo, font: "800 13px 'Nunito', sans-serif", cursor: 'pointer' })
const box = { width: '100%', boxSizing: 'border-box', border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 10px', font: "600 14px 'Nunito', sans-serif" }

export default function CopyWriter({ master, onSave }) {
  const [open, setOpen] = useState(false)
  const [terms, setTerms] = useState('')
  const [focus, setFocus] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [out, setOut] = useState(null)
  const [taken, setTaken] = useState({})
  const write = async () => {
    setBusy('write'); setErr(''); setTaken({})
    try {
      const r = await apiFetch('/api/listings/master-write', { method: 'POST', body: JSON.stringify({ asin: master.asin, terms, focus }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `Could not write the copy (${r.status})`)
      setOut(j)
    } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const take = async (f) => {
    setBusy(f); setErr('')
    try { await onSave(f, out.draft[f]); setTaken((t) => ({ ...t, [f]: true })) } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const takeAll = async () => { for (const f of Object.keys(LABEL)) if (out.draft[f] && !taken[f] && !(out.problems || {})[f]) await take(f) }
  if (!open) return <button type="button" onClick={() => setOpen(true)} style={btn(false)}>Write new copy</button>
  return (
    <div style={{ marginTop: 10, padding: 14, background: C.bg, borderRadius: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
        <label style={{ fontSize: 13, fontWeight: 800 }}>Key terms to use<textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={2} placeholder="e.g. toddler cutlery, self-feeding, 12 months+" style={{ ...box, marginTop: 4 }} /></label>
        <label style={{ fontSize: 13, fontWeight: 800 }}>Anything else it should know (optional)<textarea value={focus} onChange={(e) => setFocus(e.target.value)} rows={2} placeholder="e.g. lead with occupational therapist design; shorter bullets" style={{ ...box, marginTop: 4 }} /></label>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
        <button type="button" disabled={!!busy} onClick={write} style={btn(true)}>{busy === 'write' ? 'Writing… (about 30 seconds)' : out ? 'Write again (about $0.08)' : 'Write new copy (about $0.08)'}</button>
        <button type="button" onClick={() => { setOpen(false); setOut(null) }} style={btn(false)}>Close</button>
        <Note style={{ margin: 0 }}>Uses your key terms, the UK Brand Analytics searches for this product, its attributes and the copy in place. Nothing changes until you take a field.</Note>
      </div>
      {err ? <p role="alert" style={{ color: C.bad, fontSize: 13 }}>{err}</p> : null}
      {out ? (
        <div style={{ marginTop: 12 }}>
          {out.notes ? <p style={{ margin: '0 0 6px', fontSize: 13.5 }}><b>What changed:</b> {out.notes}</p> : null}
          <p style={{ margin: '0 0 10px', fontSize: 12.5, color: C.muted }}>{out.keywords.basis === 'none' ? 'No UK Brand Analytics searches for this product.' : `Brand Analytics ${out.keywords.period_from} to ${out.keywords.period_to}: ${out.searches_used.length} of ${out.keywords.offered} searches used${out.searches_used.length ? ` (${out.searches_used.slice(0, 12).join(' · ')}${out.searches_used.length > 12 ? '…' : ''})` : ''}.`} Cost ${out.cost_usd.toFixed(2)}.</p>
          {Object.keys(LABEL).map((f) => {
            const now = (master.copy || {})[f] || ''
            const p = (out.problems || {})[f]
            return (
              <div key={f} style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 10, padding: 10, marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <b style={{ fontSize: 13.5, flex: 1 }}>{LABEL[f]}{p ? <span style={{ color: C.bad, fontWeight: 700 }}> · {p}</span> : null}</b>
                  {taken[f] ? <span style={{ fontSize: 12.5, fontWeight: 800, color: C.ok }}>Saved to the master</span> : out.draft[f] && out.draft[f] !== now ? <button type="button" disabled={!!busy} onClick={() => take(f)} style={{ ...btn(true), minHeight: 30, fontSize: 12.5 }}>{busy === f ? 'Saving…' : 'Use this'}</button> : <span style={{ fontSize: 12.5, color: C.muted }}>Same as now</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginTop: 6, fontSize: 13.5, lineHeight: 1.45 }}>
                  <div><span style={{ fontSize: 11.5, fontWeight: 800, color: C.muted, textTransform: 'uppercase' }}>Now</span><p style={{ margin: '2px 0 0', whiteSpace: 'pre-wrap', color: C.body }}>{now || '–'}</p></div>
                  <div><span style={{ fontSize: 11.5, fontWeight: 800, color: C.indigo, textTransform: 'uppercase' }}>New</span><p style={{ margin: '2px 0 0', whiteSpace: 'pre-wrap' }}>{out.draft[f] || '–'}</p></div>
                </div>
              </div>
            )
          })}
          <button type="button" disabled={!!busy} onClick={takeAll} style={btn(true)}>Use all the new fields</button>
        </div>
      ) : null}
    </div>
  )
}
