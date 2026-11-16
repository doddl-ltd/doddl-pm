import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { C, Panel, H2, Lbl, Note } from './approvals/renderers/reviewKit'

// Studio › Amazon listings › Rollout (canvas board 9, Jon 2026-11-16): "I need to see what is created and what needs to be
// pushed to Amazon - only when the image is LIVE on amazon should this be complete." One product at a time: the master,
// then every store x every piece (copy, keywords, attributes, each image slot, A+) from 'not started' to 'live'.
// Data: /api/listings/rollout (lib/pm/rollout.js). The listing agent makes things (lib/pm/listingAgent.js); people approve
// and push; the daily read of Amazon decides 'live'.
const STAGE = {
  live: ['Live', '#30BEAA', '#fff'], sent: ['Sent · waiting', '#9ecfc6', C.indigo], approved: ['Ready to push', '#d6ebe7', C.indigo],
  you: ['Needs you', '#eec682', C.indigo], made: ['Agent making', '#e0daeb', C.indigo], todo: ['Not started', '#EAEAEA', C.indigo],
  problem: ['Amazon problem', '#dd6c92', '#fff'],
}
const ORDER = ['problem', 'you', 'made', 'todo', 'approved', 'sent', 'live']
const btn = (primary) => ({ minHeight: 36, padding: '0 14px', borderRadius: 10, border: `1px solid ${primary ? C.indigo : C.border}`, background: primary ? C.indigo : '#fff', color: primary ? '#fff' : C.indigo, font: "800 13px 'Nunito', sans-serif", cursor: 'pointer' })
const safeImg = (u) => (/^https:\/\/(m\.media-amazon\.com\/|[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/listing-images\/)/i.test(String(u || '')) ? u : null)

function Stage({ k, small }) {
  const [label, bg, fg] = STAGE[k] || STAGE.todo
  return <span style={{ display: 'inline-block', whiteSpace: 'nowrap', borderRadius: 999, padding: small ? '1px 8px' : '3px 10px', fontSize: small ? 11.5 : 12.5, fontWeight: 800, background: bg, color: fg }}>{label}</span>
}
function Square({ k, on, onClick, title }) {
  const [, bg] = STAGE[k] || STAGE.todo
  return <button type="button" title={title} aria-label={title} onClick={onClick} style={{ width: 28, height: 28, borderRadius: 8, background: bg, border: on ? `3px solid ${C.indigo}` : k === 'todo' ? '2px dashed #c0b5d8' : '0', cursor: 'pointer', padding: 0, flex: 'none' }} />
}
function Thumb({ url, label, empty }) {
  const u = safeImg(url)
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: 8 }}>
      {u ? <img src={u} alt={label} loading="lazy" style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'contain', background: C.bg, borderRadius: 8, display: 'block' }} />
        : <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', aspectRatio: '1 / 1', background: C.grey, borderRadius: 8, fontSize: 13, color: C.muted, textAlign: 'center', padding: 8 }}>{empty}</span>}
      <p style={{ margin: '6px 0 0', fontSize: 12.5, fontWeight: 800 }}>{label}</p>
    </div>
  )
}

async function call(path, body) {
  const r = await apiFetch(path, body ? { method: 'POST', body: JSON.stringify(body) } : undefined)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Could not do that (${r.status})`)
  return j
}

function PieceDetail({ asin, row, piece, onDone }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const act = async (op) => {
    setBusy(op); setErr('')
    try {
      if (op === 'requeue') await call('/api/listings/image-translate', { op, id: piece.translation_id })
      else await call('/api/listings/image-translate', { op, id: piece.translation_id, note: op === 'reject' ? window.prompt('Why? (optional)') || '' : '' })
      await onDone()
    } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  if (piece.kind === 'image') {
    return (
      <Panel style={{ marginTop: 16 }}>
        <H2 style={{ margin: 0, fontSize: 17 }}>{row.market} · {piece.label}</H2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginTop: 10, maxWidth: 720 }}>
          <Thumb url={piece.master} label="Master" />
          <Thumb url={piece.made} label={row.language.startsWith('English') ? 'Same as the master' : `The agent's ${row.language} version`} empty={piece.stage === 'made' ? 'Being made' : row.language.startsWith('English') ? 'Not needed' : 'Not made yet'} />
          <Thumb url={piece.live} label={`Live on Amazon ${row.market}`} empty={piece.stage === 'live' ? 'Live' : 'Not live yet'} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
          <Stage k={piece.stage} /><span style={{ fontSize: 13.5, fontWeight: 700 }}>{piece.why}</span>
        </div>
        {piece.translation_id && ['checked', 'problem'].includes(piece.translation) ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button type="button" disabled={!!busy} onClick={() => act('approve')} style={btn(true)}>{busy === 'approve' ? 'Approving…' : 'Approve this image'}</button>
            <button type="button" disabled={!!busy} onClick={() => act('reject')} style={btn(false)}>Reject</button>
            <button type="button" disabled={!!busy} onClick={() => act('requeue')} style={btn(false)}>Make it again</button>
          </div>
        ) : piece.translation_id && ['rejected', 'over_photo'].includes(piece.translation) ? (
          <div style={{ marginTop: 10 }}><button type="button" disabled={!!busy} onClick={() => act('requeue')} style={btn(false)}>Make it again</button></div>
        ) : null}
        {err ? <p role="alert" style={{ color: C.bad, fontSize: 13 }}>{err}</p> : null}
      </Panel>
    )
  }
  const items = piece.items || []
  return (
    <Panel style={{ marginTop: 16 }}>
      <H2 style={{ margin: 0, fontSize: 17 }}>{row.market} · {piece.label}</H2>
      {piece.kind === 'keywords' ? (
        <>
          <p style={{ margin: '8px 0 0', fontSize: 13.5 }}>{piece.info ? piece.info.basis === 'master' ? 'English store: the master\'s search terms as they are.' : piece.info.basis === 'none' ? `No Brand Analytics for Amazon ${row.market}: the agent chose local keywords itself. Check them.` : `From Brand Analytics (${piece.info.period_from || '?'} to ${piece.info.period_to || '?'}, ${piece.info.basis === 'product' ? 'searches that showed this product' : "the store's biggest doddl searches"}): ${piece.info.offered} searches offered, ${(piece.info.used || []).length} used.` : 'Not written yet.'}</p>
          {piece.value ? <p style={{ margin: '8px 0 0', fontSize: 13.5, background: C.bg, borderRadius: 8, padding: 10 }}>{piece.value}</p> : null}
          {piece.info && (piece.info.used || []).length ? <p style={{ margin: '8px 0 0', fontSize: 13, color: C.muted }}>Searches used: {piece.info.used.join(' · ')}</p> : null}
        </>
      ) : null}
      {items.length ? (
        <div style={{ marginTop: 8 }}>{items.map((x) => (
          <div key={x.label} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderTop: `1px solid ${C.line2}`, fontSize: 13.5 }}>
            <span style={{ flex: '0 0 180px', fontWeight: 800 }}>{x.label}</span><Stage k={x.stage} small /><span style={{ color: C.muted }}>{x.why}</span>
          </div>
        ))}</div>
      ) : piece.kind !== 'keywords' ? <p style={{ margin: '8px 0 0', fontSize: 13.5 }}>{piece.why || 'Everything matches the master.'}</p> : null}
      <p style={{ margin: '10px 0 0', fontSize: 13, color: C.muted }}>Translations and the master are edited and approved on the master: use Open the master at the top.</p>
    </Panel>
  )
}

function ProductRollout({ asin, isMobile, onBack, onOpenMaster }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [pick, setPick] = useState(null)
  const load = async () => setData(await call(`/api/listings/rollout?asin=${asin}`))
  useEffect(() => { setData(null); setPick(null); load().catch((e) => setErr(e.message)) }, [asin])
  if (err && !data) return <p role="alert" style={{ color: C.bad }}>{err}</p>
  if (!data) return <Note>Loading…</Note>
  const p = data.product, est = data.estimate, r = p.rollout
  const run = async (body, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(body.op); setErr('')
    try { await call('/api/listings/rollout', body); await load() } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const start = () => {
    const v = window.prompt(`Start the listing agent on ${p.product || asin}?\n\nIt will make ${est.translations} listing translation${est.translations === 1 ? '' : 's'} (with Brand Analytics keywords), ${est.images} translated image${est.images === 1 ? '' : 's'}${est.aplus ? ` and ${est.aplus} A+ translation${est.aplus === 1 ? '' : 's'}` : ''} for ${est.markets.join(', ') || 'no non-English store'}: about $${est.usd.toFixed(2)} of Claude.\nNothing goes to Amazon: you approve each piece and push it.\n\nBudget in USD (the agent stops there):`, String(est.budget))
    if (v == null) return
    run({ op: 'start', asin, budget: Number(v) })
  }
  const kpi = [['Live everywhere', `${p.live_markets} of ${p.markets.length}`, 'stores fully live'], ['Needs you', p.you, 'pieces waiting for a person'], ['Sent, waiting for Amazon', p.sent, "inside Amazon's 72 hours"], ['Amazon problems', p.problems, p.problems ? 'case drafted' : 'none']]
  const sel = pick && p.markets.find((m) => m.market === pick.market)
  const piece = sel ? (pick.kind === 'image' ? { kind: 'image', ...sel.images[pick.i] } : pick.kind === 'copy' ? { kind: 'copy', label: 'Copy', ...sel.copy } : pick.kind === 'keywords' ? { kind: 'keywords', label: 'Keywords', ...sel.keywords } : pick.kind === 'attributes' ? { kind: 'attributes', label: 'Attributes', ...sel.attributes } : { kind: 'aplus', label: 'A+', ...(sel.aplus || {}) }) : null
  const cell = (m, kind, st, i) => {
    if (!st) return <span style={{ color: C.faint }}>–</span>
    const on = pick && pick.market === m.market && pick.kind === kind && (kind !== 'image' || pick.i === i)
    return <button type="button" onClick={() => setPick({ market: m.market, kind, i })} style={{ background: 'none', border: on ? `2px solid ${C.indigo}` : '2px solid transparent', borderRadius: 999, padding: 0, cursor: 'pointer' }}><Stage k={st} small={isMobile} /></button>
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" onClick={onBack} style={{ background: 'none', border: 0, padding: 0, font: "800 14px 'Nunito', sans-serif", color: C.indigo, cursor: 'pointer', minHeight: 44 }}>‹ Every product</button>
        <span style={{ fontSize: 14, color: C.muted }}>{p.master_sku || ''} · ASIN {p.asin}</span>
      </div>
      <h1 style={{ margin: '2px 0 0', fontSize: isMobile ? 21 : 26, fontWeight: 800 }}>{p.product || p.asin}</h1>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: 10, marginTop: 14 }}>
        {kpi.map(([k, n, s]) => <Panel key={k} pad="12px 14px"><Lbl>{k}</Lbl><p style={{ margin: '2px 0 0', fontSize: 24, fontWeight: 800, color: k === 'Amazon problems' && p.problems ? '#dd6c92' : C.ink }}>{n}</p><p style={{ margin: 0, fontSize: 12.5, color: C.muted }}>{s}</p></Panel>)}
      </div>

      <Panel style={{ marginTop: 14, background: '#f2ece5' }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: '1 1 340px' }}>
            <Lbl>Master: {p.master === 'approved' ? 'approved' : 'not approved yet'}</Lbl>
            <p style={{ margin: '4px 0 0', fontSize: 14, lineHeight: 1.5 }}>One set of copy, attributes and <b>{p.images.length} master image{p.images.length === 1 ? '' : 's'}</b>. UK, US, CA and IE take it as it is; for every other store the agent makes a translated version of each image, the copy and local keywords from Brand Analytics.</p>
            <p style={{ margin: '6px 0 0', fontSize: 13.5, fontWeight: 700 }}>
              {r ? `Agent ${r.paused ? 'paused' : 'on'} · started by ${r.started_by} · $${Number(r.spent_usd || 0).toFixed(2)} of $${Number(r.budget_usd || 0).toFixed(2)} spent${r.last_note ? ` · ${r.last_note}` : ''}` : p.master === 'approved' ? `Not started · about $${est.usd.toFixed(2)} to make everything` : 'Approve the master, then start the agent'}
            </p>
            {r && r.last_error ? <p style={{ margin: '4px 0 0', fontSize: 13, color: C.bad }}>Last problem: {r.last_error}</p> : null}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {onOpenMaster ? <button type="button" onClick={() => onOpenMaster(asin)} style={btn(p.master !== 'approved')}>Open the master</button> : null}
              {p.master === 'approved' && (!r || r.paused) ? <button type="button" disabled={!!busy} onClick={start} style={btn(true)}>{r ? 'Restart the agent' : 'Start the agent'}</button> : null}
              {r && !r.paused ? <button type="button" disabled={!!busy} onClick={() => run({ op: 'stop', asin })} style={btn(false)}>Pause the agent</button> : null}
              {r && !r.paused ? <button type="button" disabled={!!busy} onClick={start} style={btn(false)}>Change the budget</button> : null}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {p.images.map((u, i) => <span key={u} title={i ? `Image ${i}` : 'Main image'} style={{ width: 58, height: 58, borderRadius: 12, background: '#fff', overflow: 'hidden', display: 'inline-flex' }}>{safeImg(u) ? <img src={u} alt={i ? `Master image ${i}` : 'Master main image'} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : null}</span>)}
          </div>
        </div>
      </Panel>
      {err ? <p role="alert" style={{ color: C.bad, fontSize: 13 }}>{err}</p> : null}

      <H2 style={{ margin: '18px 0 6px', fontSize: 18 }}>Every store, every piece</H2>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860, fontSize: 13.5 }}>
          <thead><tr>{['Store', 'Copy', 'Keywords', 'Attributes', 'Images (main + others)', 'A+', 'What happens next'].map((h) => <th key={h} style={{ textAlign: 'left', fontSize: 12, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: C.muted, padding: '8px 8px', borderBottom: `1px solid ${C.line}` }}>{h}</th>)}</tr></thead>
          <tbody>{p.markets.map((m) => (
            <tr key={m.market} style={{ borderBottom: `1px solid ${C.line2}` }}>
              <td style={{ padding: '10px 8px' }}><b style={{ fontSize: 15 }}>{m.market}</b><span style={{ display: 'block', fontSize: 12, color: C.muted }}>{m.language}</span></td>
              <td style={{ padding: 8 }}>{cell(m, 'copy', m.copy.stage)}</td>
              <td style={{ padding: 8 }}>{cell(m, 'keywords', m.keywords.stage)}{m.keywords.info && m.keywords.info.basis && m.keywords.info.basis !== 'master' ? <span style={{ display: 'block', fontSize: 11.5, color: C.muted, marginTop: 2 }}>{m.keywords.info.basis === 'none' ? 'no Brand Analytics' : 'Brand Analytics'}</span> : null}</td>
              <td style={{ padding: 8 }}>{cell(m, 'attributes', m.attributes.stage)}</td>
              <td style={{ padding: 8 }}><span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>{m.images.map((im, i) => <Square key={i} k={im.stage} on={pick && pick.market === m.market && pick.kind === 'image' && pick.i === i} title={`${im.label}: ${STAGE[im.stage][0]}`} onClick={() => setPick({ market: m.market, kind: 'image', i })} />)}</span></td>
              <td style={{ padding: 8 }}>{cell(m, 'aplus', m.aplus && m.aplus.stage)}</td>
              <td style={{ padding: 8, fontWeight: 700 }}>
                {m.next}
                {m.to_push ? <span style={{ display: 'block', marginTop: 6 }}><button type="button" disabled={!!busy} onClick={() => run({ op: 'push', asin, markets: [m.market] }, `Push ${m.to_push} approved change${m.to_push === 1 ? '' : 's'} to Amazon ${m.market}?\n\nDoddl HQ checks them and asks for the final approval before anything reaches Amazon.`)} style={{ ...btn(true), minHeight: 30, fontSize: 12.5 }}>Push {m.to_push} to Amazon</button></span> : null}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10 }}>{ORDER.slice().reverse().map((k) => <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 800 }}><Square k={k} title={STAGE[k][0]} onClick={() => {}} />{STAGE[k][0]}</span>)}</div>
      <Note style={{ marginTop: 6 }}>A piece is done only when the daily read of Amazon shows it. Click any stage or square to see it.</Note>
      {piece ? <PieceDetail asin={asin} row={sel} piece={piece} onDone={load} /> : null}
    </div>
  )
}

export default function RolloutView({ isMobile, onOpenMaster }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [asin, setAsin] = useState(null)
  useEffect(() => { if (!asin) call('/api/listings/rollout').then(setData).catch((e) => setErr(e.message)) }, [asin])
  if (asin) return <ProductRollout asin={asin} isMobile={isMobile} onBack={() => setAsin(null)} onOpenMaster={onOpenMaster} />
  return (
    <div>
      <Lbl style={{ margin: '0 0 6px' }}>From the master to every store, done only when Amazon shows it</Lbl>
      <h1 style={{ margin: 0, fontSize: isMobile ? 22 : 30, fontWeight: 800 }}>Amazon rollout</h1>
      {err ? <p role="alert" style={{ color: C.bad }}>{err}</p> : !data ? <Note>Loading…</Note> : (
        <Panel style={{ marginTop: 14 }}>
          {data.products.map((p, i) => (
            <button key={p.asin} type="button" onClick={() => setAsin(p.asin)} style={{ display: 'flex', width: '100%', gap: 12, alignItems: 'center', flexWrap: 'wrap', textAlign: 'left', background: 'none', border: 0, borderTop: i ? `1px solid ${C.line2}` : 0, padding: '12px 4px', cursor: 'pointer', font: "inherit", color: C.ink }}>
              <span style={{ flex: '1 1 260px' }}><b style={{ fontSize: 15 }}>{p.product || p.asin}</b><span style={{ display: 'block', fontSize: 12.5, color: C.muted }}>{p.master_sku || ''} · {p.asin} · master {p.master === 'approved' ? 'approved' : 'not approved'}{p.rollout ? (p.rollout.paused ? ' · agent paused' : ' · agent on') : ''}</span></span>
              <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>{p.markets.map((m) => {
                const k = m.done ? 'live' : ORDER.find((s) => m.pieces[s]) || 'todo'
                return <span key={m.market} title={`${m.market}: ${m.next}`} style={{ fontSize: 11.5, fontWeight: 800, borderRadius: 8, padding: '3px 7px', background: STAGE[k][1], color: STAGE[k][2] }}>{m.market}</span>
              })}</span>
              <span style={{ flex: '0 0 auto', fontSize: 13.5, fontWeight: 800 }}>{p.live_markets} of {p.markets.length} live{p.you ? ` · ${p.you} need${p.you === 1 ? 's' : ''} you` : ''}{p.problems ? ` · ${p.problems} problem${p.problems === 1 ? '' : 's'}` : ''}</span>
            </button>
          ))}
          {data.without_master ? <p style={{ margin: '10px 0 0', fontSize: 13.5, fontWeight: 800, color: C.warn }}>{data.without_master} ASINs on Amazon have no master yet.</p> : null}
        </Panel>
      )}
    </div>
  )
}
