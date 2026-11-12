// What is live on Amazon against what we sent, per market, and the case for Amazon when it does not match
// (lib/pm/liveCheck.js; migration 33).
import { useState } from 'react'
import { C, Panel, H2, Note, Chip, Btn, fmtWhen } from './approvals/renderers/reviewKit'
import { liveChecks, contactUrl, imageSlot } from '../lib/pm/liveCheck'

const STATE = { live: ['Live', C.okBg, C.ok], waiting: ['Waiting for Amazon', C.warnBg, C.warn], problem: ['Problem', C.badBg, C.bad] }
const CASE = { draft: ['Draft: not filed yet', C.warnBg, C.warn], filed: ['Filed with Amazon', C.blueBg, C.blue], resolved: ['Resolved', C.okBg, C.ok], closed: ['Closed', C.grey, C.muted] }
const isImg = (u) => /^https:\/\/(m\.media-amazon\.com\/|[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/listing-images\/)/i.test(String(u || ''))
const short = (v) => v == null || v === '' ? '(nothing)' : String(v).length > 160 ? String(v).slice(0, 160) + '…' : String(v)

function Value({ v, image }) {
  if (image && isImg(v)) return <img src={v} alt="" loading="lazy" style={{ width: 72, height: 72, objectFit: 'contain', border: `1px solid ${C.line}`, borderRadius: 6, background: '#fff' }} />
  return <span style={{ fontSize: 13, color: C.body, wordBreak: 'break-word' }}>{short(v)}</span>
}

export function LivePanel({ data, market, isMobile, onBuildCase, onUpdateCase }) {
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const checks = liveChecks({ edits: data.edits, product: data.product, fields: data.fields, events: data.events })
  const cases = data.cases || []
  if (!checks.length && !cases.length) return null
  const n = (s) => checks.filter(c => c.state === s).length
  const problems = n('problem')
  const open = cases.find(c => c.status === 'draft' || c.status === 'filed')
  const run = async (f) => { setErr(''); setBusy(true); try { await f() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  return (
    <Panel pad={isMobile ? '14px' : undefined} style={{ marginTop: isMobile ? 0 : 20 }}>
      <H2>What is live on Amazon {market}</H2>
      <Note style={{ marginTop: 0 }}>Everything sent to Amazon is checked against each new read: live when the page shows it, waiting for up to 3 days while Amazon processes it, a problem after that or when Amazon reports an error.</Note>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '6px 0 10px' }}>
        {['live', 'waiting', 'problem'].map(s => <Chip key={s} bg={STATE[s][1]} fg={STATE[s][2]}>{STATE[s][0]}: {n(s)}</Chip>)}
      </div>
      {checks.sort((a, b) => ['problem', 'waiting', 'live'].indexOf(a.state) - ['problem', 'waiting', 'live'].indexOf(b.state)).map(c => {
        const image = imageSlot((data.edits.find(e => e.id === c.id) || {}).name) != null
        const [label, bg, fg] = STATE[c.state]
        return (
          <div key={c.id} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '150px 1fr 1fr 220px', gap: 10, padding: '10px 0', borderTop: `1px solid ${C.line2}`, alignItems: 'start' }}>
            <b style={{ fontSize: 14 }}>{c.label}</b>
            <div><div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: 'uppercase' }}>We sent {c.sent_at ? fmtWhen(c.sent_at) : ''}</div><Value v={c.sent} image={image} /></div>
            <div><div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: 'uppercase' }}>Amazon shows {c.read_at ? fmtWhen(c.read_at) : ''}</div><Value v={c.page ?? c.ours} image={image} /></div>
            <div><Chip bg={bg} fg={fg}>{label}</Chip><div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{c.why}</div></div>
          </div>
        )
      })}
      {err ? <p role="alert" style={{ color: C.bad, fontSize: 13 }}>{err}</p> : null}
      {problems && !open ? (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', background: C.badBg, borderRadius: 12, padding: '10px 14px', marginTop: 10 }}>
          <span style={{ flex: '1 1 260px', fontSize: 14, fontWeight: 700, color: C.bad }}>{problems} change{problems === 1 ? '' : 's'} not showing on Amazon. Build a case for Seller Support with what was sent and what the page shows.</span>
          <Btn primary disabled={busy} onClick={() => run(onBuildCase)}>Build a case for Amazon</Btn>
        </div>
      ) : null}
      {cases.map(k => <CaseCard key={k.id} k={k} market={market} isMobile={isMobile} onUpdate={(b) => run(() => onUpdateCase({ id: k.id, ...b }))} busy={busy} />)}
    </Panel>
  )
}

function CaseCard({ k, market, onUpdate, busy }) {
  const [caseId, setCaseId] = useState(k.amazon_case_id || '')
  const [copied, setCopied] = useState(false)
  const [label, bg, fg] = CASE[k.status] || CASE.draft
  const copy = async () => { try { await navigator.clipboard.writeText(`${k.subject}\n\n${k.body}`); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* clipboard blocked: the text is selectable */ } }
  return (
    <div style={{ marginTop: 14, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Chip bg={bg} fg={fg}>{label}</Chip>
        <span style={{ fontSize: 12, color: C.muted }}>Built {fmtWhen(k.created_at)}{k.created_by ? ` by ${k.created_by}` : ''}{k.amazon_case_id ? ` · Amazon case ${k.amazon_case_id}` : ''}</span>
      </div>
      <p style={{ margin: '10px 0 4px', fontWeight: 800, fontSize: 14 }}>{k.subject}</p>
      <pre style={{ whiteSpace: 'pre-wrap', font: "13px/1.5 'Nunito', sans-serif", background: C.bg, borderRadius: 8, padding: 12, margin: 0, maxHeight: 360, overflow: 'auto' }}>{k.body}</pre>
      {k.status === 'draft' || k.status === 'filed' ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
          <Btn onClick={copy}>{copied ? 'Copied' : 'Copy the case'}</Btn>
          <a href={contactUrl(market)} target="_blank" rel="noreferrer" style={{ font: "800 14px 'Nunito', sans-serif", color: C.indigo }}>Open Seller Central support ↗</a>
          <input value={caseId} onChange={e => setCaseId(e.target.value)} placeholder="Amazon case number" aria-label="Amazon case number" style={{ minHeight: 38, padding: '0 10px', border: `1px solid ${C.border}`, borderRadius: 8, font: "14px 'Nunito', sans-serif", width: 190 }} />
          {k.status === 'draft' ? <Btn primary disabled={busy || !caseId.trim()} onClick={() => onUpdate({ status: 'filed', amazon_case_id: caseId.trim() })}>Mark as filed</Btn> : <Btn disabled={busy} onClick={() => onUpdate({ amazon_case_id: caseId.trim() })}>Save case number</Btn>}
          {k.status === 'filed' ? <Btn primary disabled={busy} onClick={() => onUpdate({ status: 'resolved' })}>Resolved</Btn> : null}
          <Btn disabled={busy} onClick={() => onUpdate({ status: 'closed' })}>Close</Btn>
        </div>
      ) : null}
    </div>
  )
}
