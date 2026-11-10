// The approval card frame (boards Card, CardPhone): header chips, title, the body (a type renderer from
// renderers/index.js, or the generic body), the decision bar posting to /api/approvals/decide, comments.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { C, REJECT_REASONS, REJECT_LABEL, canVote, dueChip, fmtWhen, lineTally, outcomeChip, same, typeLabel, whoText } from '../../lib/approvalsUi'
import { getRenderer } from './renderers'
import GenericBody, { GenericPreview, HistorySection, buildEdits, editableFields } from './GenericBody'
import Comments from './Comments'
import { Chip, Due, Panel, H2, Btn, Field, Radio, Notice, Quiet, BackLink, inputStyle, callJson, font } from './ui'
import { MOBILE_NAV_H } from '../MobileNav'

const defaultFetcher = (path, init) => callJson(apiFetch, path, init)
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v)

function approverText(task, me) {
  const slots = Array.isArray(task.approvers) ? task.approvers.filter(Boolean) : []
  if (task.escalated_to && same(task.escalated_to, me) && slots[0]) return `you (${me}), as backup for ${slots[0]}`
  if (!slots.length) return task.assigned_to ? (same(task.assigned_to, me) ? `you (${me})` : task.assigned_to) : 'anyone signed in'
  return slots.map(n => (same(n, me) ? `you (${me})` : n)).join(' and ')
}

function resultMessage(res, me, task) {
  if (!res) return null
  if (!res.decided) return { tone: 'info', head: 'Your answer is recorded.', text: `Waiting on ${whoText(res.waiting_on, me)} before anything runs.` }
  const d = res.decision
  // B2B go-live: the "edits" are the chosen trade mailboxes, not copy changes (docs/b2b-campaigns/OUTREACH-MAIL.md).
  if (task && task.artefact_type === 'b2b_golive' && ['approved', 'approved_with_edits'].includes(d)) return { tone: 'ok', head: `Live. Approved by ${me}, ${fmtWhen(new Date().toISOString())}`, text: 'doddl PM starts sending from the mailboxes you ticked in the next send window, at their warm-up pace. Replies come to the named person; the campaign’s Report tab shows how it goes.' }
  if (d === 'approved') return { tone: 'ok', head: `Approved by ${me}, ${fmtWhen(new Date().toISOString())}`, text: 'doddl HQ picks this up within 5 minutes and runs it once, exactly as shown. The result is noted here and in Teams.' }
  if (d === 'approved_with_edits') return { tone: 'ok', head: 'Approved with your edits.', text: 'Your edits go back through the Brand checker (voice, claims, feeding safety) before anything runs. The result shows here and in Teams.' }
  if (d === 'partially_approved') {
    const t = lineTally(res.lines || task.line_decisions)
    return { tone: 'ok', head: `Approved ${t.yes} of ${t.yes + t.no}.`, text: 'Each ticked line runs once, on its own; if one fails, the others still run. The rest went back to the agent with your comment.' }
  }
  if (d === 'revision_requested') return { tone: 'grey', head: 'Sent back. Nothing has run.', text: 'The agent revises and sends a new card. This one closes as “sent back”.' }
  if (d === 'rejected') return { tone: 'grey', head: 'Rejected. Nothing has run.', text: 'The reason feeds the weekly learning list.' }
  return { tone: 'grey', head: 'Decision recorded.', text: '' }
}

function DecidedPanel({ task, me }) {
  const o = outcomeChip(task.decision)
  const t = lineTally(task.line_decisions)
  return (
    <>
      <Notice tone={o?.tone === 'bad' ? 'bad' : o?.tone === 'warn' ? 'warn' : o?.tone === 'ok' ? 'ok' : 'grey'} style={{ fontSize: 15, fontWeight: 800 }}>
        {o?.label}{t.yes + t.no > 0 && task.decision === 'partially_approved' ? ` · ${t.yes} of ${t.yes + t.no} lines` : ''}
        {task.decision === 'expired' ? ' · no answer in 72 hours' : task.decision_by ? ` by ${task.decision_by}` : ''}{task.decision_at ? `, ${fmtWhen(task.decision_at)}` : ''}
      </Notice>
      {task.reject_reason && <p style={{ margin: '10px 0 0', fontSize: 14 }}><b>Reason:</b> {REJECT_LABEL[task.reject_reason] || task.reject_reason}</p>}
      {task.decision_notes && <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>“{task.decision_notes}”</p>}
      {task.decision === 'expired' && <p style={{ margin: '10px 0 0', fontSize: 14, color: C.muted }}>doddl HQ re-checks before asking again.</p>}
      {(task.votes || []).length > 1 && (
        <div style={{ marginTop: 10, fontSize: 13, color: C.muted }}>
          {task.votes.map(v => <div key={v.voter}>{v.voter}: {outcomeChip(v.vote)?.label.toLowerCase()} · {fmtWhen(v.at)}</div>)}
        </div>
      )}
    </>
  )
}

export default function ApprovalCard({ taskId, initialTask, userName, isMobile, onBack, onDecided, onNext, position, fetcher = defaultFetcher }) {
  const [task, setTask] = useState(initialTask || null)
  const [loading, setLoading] = useState(!initialTask)
  const [loadErr, setLoadErr] = useState(null)
  const [lines, setLines] = useState({})
  const [edits, setEdits] = useState({})
  const [mode, setMode] = useState('default')
  const [notes, setNotes] = useState('')
  const [editValues, setEditValues] = useState({})
  const [reason, setReason] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [result, setResult] = useState(null)

  const load = useCallback(async () => {
    if (!taskId) return
    try { setLoadErr(null); setTask(await fetcher(`/api/approvals?task_id=${encodeURIComponent(taskId)}`)) }
    catch (e) { setLoadErr(e.message) }
    finally { setLoading(false) }
  }, [taskId, fetcher])
  useEffect(() => { if (!initialTask) load() }, [initialTask, load])
  useEffect(() => { setLines({}); setEdits({}); setMode('default'); setNotes(''); setResult(null); setErr(null); setReason(null) }, [taskId])

  const me = userName
  const artefact = task && isObj(task.artefact) ? task.artefact : null
  const Renderer = task ? getRenderer(task.artefact_type) : null
  const editable = useMemo(() => (task && !Renderer ? editableFields(task) : []), [task, Renderer])
  const mayVote = task ? canVote(task, me) && !result : false
  const readOnly = !mayVote
  const tally = lineTally(lines)
  const hasLines = tally.yes + tally.no > 0
  const hasEdits = Object.keys(edits || {}).length > 0

  const onComment = useCallback(async (body, anchor) => {
    const c = await fetcher('/api/approvals/comment', { method: 'POST', body: JSON.stringify({ task_id: task.id, body, anchor: anchor || undefined }) })
    setTask(t => ({ ...t, comments: [...(t.comments || []), c] }))
    return c
  }, [fetcher, task])
  const onResolve = useCallback(async (id, resolved) => {
    const c = await fetcher('/api/approvals/comment', { method: 'PATCH', body: JSON.stringify({ id, resolved }) })
    setTask(t => ({ ...t, comments: (t.comments || []).map(x => (x.id === id ? { ...x, ...c } : x)) }))
  }, [fetcher])

  const submit = useCallback(async (outcome, extra = {}) => {
    setBusy(true); setErr(null)
    const body = { task_id: task.id, outcome, notes: notes.trim() || undefined, lines: hasLines ? lines : undefined, edits: hasEdits ? edits : undefined, ...extra }
    try {
      const res = await fetcher('/api/approvals/decide', { method: 'POST', body: JSON.stringify(body) })
      setResult({ ...res, lines: body.lines })
      setMode('default')
      onDecided && onDecided(res)
      load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }, [task, notes, lines, edits, hasLines, hasEdits, fetcher, onDecided, load])

  const approve = () => {
    if (hasLines && !tally.yes) { setErr('Nothing is ticked. Tick at least one line, or send it back.'); return }
    submit('approved')
  }
  const approveEdited = () => {
    const ed = buildEdits(task, editValues)
    if (!Object.keys(ed).length) { setErr('Change something first, or just approve it as it is.'); return }
    submit('approved_with_edits', { edits: ed })
  }
  const sendBack = () => {
    if (!notes.trim()) { setErr('Say what should change, so the agent knows what to do.'); return }
    submit('revision_requested')
  }
  const reject = () => {
    const r = REJECT_REASONS.find(x => x.value === reason)
    if (!r) { setErr('Pick a reason.'); return }
    if (r.value === 'other' && !notes.trim()) { setErr('Add a note saying why.'); return }
    const n = r.value === 'money' ? `Not worth the money.${notes.trim() ? ` ${notes.trim()}` : ''}` : notes.trim() || undefined
    submit('rejected', { reject_reason: r.send || r.value, notes: n, lines: undefined })
  }
  const go = (m) => () => { setErr(null); setMode(m); if (m === 'edit') setEditValues(Object.fromEntries(editable.map(f => [f.id, f.value]))) }

  if (loading) return <Quiet>Loading the approval…</Quiet>
  if (!task) return (
    <div style={{ fontFamily: font }}>
      <BackLink onClick={onBack} />
      <Quiet>{loadErr === 'Please sign in again' ? loadErr : `This approval could not be opened${loadErr ? `: ${loadErr}` : ''}.`}</Quiet>
    </div>
  )

  const slots = Array.isArray(task.approvers) ? task.approvers.filter(Boolean) : []
  const rule = task.rule || null
  const chip = dueChip(task)
  const where = (artefact && typeof artefact.where === 'string' && artefact.where) || typeLabel(task.artefact_type)
  const msg = resultMessage(result, me, task)
  const iVoted = (task.votes || []).find(v => same(v.voter, me))
  const customLabel = Renderer && typeof Renderer.approveLabel === 'function' ? Renderer.approveLabel(tally, lines) : null
  const approveLabel = customLabel || (hasLines ? (tally.no ? `Approve ${tally.yes}, send back ${tally.no}` : `Approve all ${tally.yes}`) : hasEdits ? 'Approve with your edits' : 'Approve')

  // Right after a decision the card shows what was just sent until the reload carries it.
  const shownTask = result && !task.decision ? { ...task, decision: result.decided ? result.decision : null, line_decisions: result.lines || task.line_decisions } : task
  const rendererProps = { task: shownTask, artefact, isMobile, readOnly, lines, setLines, edits, setEdits, comments: task.comments || [], onComment, onApprove: mayVote ? approve : undefined, deciding: busy }

  // ── the decision panel ──
  let decision
  if (msg) {
    decision = (
      <>
        <Notice tone={msg.tone} style={{ fontSize: 15, fontWeight: 800 }}>{msg.head}</Notice>
        {msg.text && <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.5 }}>{msg.text}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {onNext && <Btn kind="primary" onClick={onNext}>Next approval ›</Btn>}
          <Btn onClick={onBack}>Back to approvals</Btn>
        </div>
      </>
    )
  } else if (task.decision) {
    decision = <DecidedPanel task={task} me={me} />
  } else if (!mayVote) {
    decision = (
      <>
        <H2>Waiting on {whoText(task.waiting_on, me)}</H2>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: C.muted }}>
          {iVoted ? `You answered: ${outcomeChip(iVoted.vote)?.label.toLowerCase()}. Nothing runs until every approver has said yes.` : `Only ${whoText(slots.length ? [...slots, task.escalated_to].filter(Boolean) : [task.assigned_to], me)} can decide this one. You can still comment.`}
        </p>
      </>
    )
  } else if (mode === 'edit') {
    decision = (
      <>
        <H2>Approve with edits</H2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {editable.map(f => (
            <Field key={f.id} label={f.label} htmlFor={`ed-${f.id}`}>
              <textarea id={`ed-${f.id}`} rows={f.rows} value={editValues[f.id] ?? ''} onChange={e => setEditValues(v => ({ ...v, [f.id]: e.target.value }))} style={{ ...inputStyle, resize: 'vertical' }} />
            </Field>
          ))}
        </div>
        <Notice style={{ marginTop: 12, fontSize: 13 }}>Your edits go back through the Brand checker (voice, claims, feeding safety) before anything runs. If they pass, it runs as edited. If not, you will see why here.</Notice>
        <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <Btn kind="primary" onClick={approveEdited} disabled={busy}>{busy ? 'Saving…' : isMobile ? 'Approve edited' : 'Approve my edited version'}</Btn>
          <Btn onClick={go('default')}>Cancel</Btn>
        </div>
      </>
    )
  } else if (mode === 'sendback') {
    decision = (
      <>
        <H2>Send back to {task.agent_id || 'the agent'}</H2>
        <Field label="What should change?" htmlFor="sb">
          <textarea id="sb" rows={isMobile ? 3 : 4} value={notes} onChange={e => setNotes(e.target.value)} placeholder="For example: keep the old bullet 4, it reads better." style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>
        <p style={{ margin: '10px 0 0', fontSize: 13, color: C.muted }}>The agent revises and sends a new card. This one closes as “sent back”.</p>
        <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <Btn kind="primary" onClick={sendBack} disabled={busy}>{busy ? 'Sending…' : 'Send back'}</Btn>
          <Btn onClick={go('default')}>Cancel</Btn>
        </div>
      </>
    )
  } else if (mode === 'reject') {
    decision = (
      <>
        <H2>Reject: why?</H2>
        <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
          <legend style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted, marginBottom: 4 }}>Pick one reason</legend>
          {REJECT_REASONS.filter(r => r.value !== 'money' || !rule || rule.spend_applies).map(r => (
            <Radio key={r.value} name={`rr-${task.id}`} value={r.value} checked={reason === r.value} onChange={setReason}>{r.label}</Radio>
          ))}
        </fieldset>
        <Field label={reason === 'other' ? 'Note (required)' : 'Note'} htmlFor="rn">
          <textarea id="rn" rows={2} value={notes} onChange={e => setNotes(e.target.value)} style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>
        <p style={{ margin: '10px 0 0', fontSize: 13, color: C.muted }}>Nothing runs. The reason feeds the weekly learning list.</p>
        <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <Btn kind="danger" onClick={reject} disabled={busy}>{busy ? 'Saving…' : 'Reject'}</Btn>
          <Btn onClick={go('default')}>Cancel</Btn>
        </div>
      </>
    )
  } else {
    decision = (
      <>
        {!isMobile && <H2>Your decision</H2>}
        {slots.length > 1 && (
          <p style={{ margin: '0 0 10px', fontSize: 13, color: C.muted }}>
            Two approvers: {whoText(slots, me)}. {task.votes?.length ? `${task.votes.map(v => v.voter).join(', ')} has answered.` : 'Both must approve before anything runs.'}
          </p>
        )}
        {hasLines && tally.no > 0 && (
          <Field label="Comment for anything you untick (goes back to the agent)" htmlFor="cm">
            <textarea id="cm" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="For example: leave the brand defence budget until after Black Friday." style={{ ...inputStyle, resize: 'vertical', marginBottom: 10 }} />
          </Field>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: isMobile ? 8 : 10 }}>
          <Btn kind="primary" onClick={approve} disabled={busy} style={!(!Renderer && editable.length > 0) ? { gridColumn: 'span 2' } : undefined}>{busy ? 'Saving…' : approveLabel}</Btn>
          {!Renderer && editable.length > 0 && <Btn onClick={go('edit')}>{isMobile ? 'With edits' : 'Approve with edits'}</Btn>}
          <Btn onClick={go('sendback')}>{isMobile ? 'Send back' : 'Send back with comment'}</Btn>
          <Btn kind="danger" onClick={go('reject')}>Reject</Btn>
        </div>
        {!isMobile && <p style={{ margin: '12px 0 0', fontSize: 13, color: C.muted, lineHeight: 1.5 }}>Approve runs it once, exactly as shown. Send back keeps the work and asks the agent for a new version.</p>}
      </>
    )
  }
  const errLine = err && <p role="alert" style={{ color: '#A12B2B', fontSize: 13, fontWeight: 700, margin: '10px 0 0' }}>{err}</p>

  const header = (
    <>
      {isMobile ? (
        <div style={{ background: C.ink, color: '#fff', margin: '-12px -12px 0', padding: '4px 16px', display: 'flex', alignItems: 'center' }}>
          <button type="button" onClick={onBack} style={{ background: 'none', border: 0, color: '#fff', font: `800 15px ${font}`, minHeight: 44, cursor: 'pointer', padding: 0 }}>‹ Approvals</button>
          {position && position.index >= 0 && <span style={{ marginLeft: 'auto', fontSize: 13, color: '#DCD6EC', fontWeight: 700 }}>{position.index + 1} of {position.total}</span>}
        </div>
      ) : <BackLink onClick={onBack} />}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 6 : 8, alignItems: 'center', marginTop: isMobile ? 16 : 0 }}>
        <Chip>{rule?.label || typeLabel(task.artefact_type)}</Chip>
        {isMobile && rule?.batch_mode === 'single' && <Chip tone="muted">Always single</Chip>}
        {!isMobile && task.agent_id && <Chip tone="muted">From {task.agent_id}</Chip>}
        {!isMobile && <Chip tone="muted">Approver: {approverText(task, me)}</Chip>}
        {!task.decision && <Due small={isMobile} chip={chip} />}
        {task.decision && <Due small={isMobile} chip={outcomeChip(task.decision)} />}
      </div>
      <h1 style={{ margin: isMobile ? '12px 0 0' : '12px 0 4px', fontSize: isMobile ? 22 : 28, lineHeight: 1.25, fontWeight: 800, letterSpacing: '-0.01em', maxWidth: 900 }}>{task.title}</h1>
      <p style={{ margin: isMobile ? '8px 0 0' : 0, color: C.muted, fontSize: isMobile ? 13 : 14 }}>
        {isMobile && task.agent_id ? `From ${task.agent_id} · ` : ''}{where} · raised {fmtWhen(task.created_at)}
      </p>
      {task.escalated_to && !task.decision && slots[0] && (
        <Notice tone="bad" style={{ marginTop: 12, fontWeight: 700, maxWidth: 900 }}>
          {slots[0]} has not answered in 48 hours, so this has come to {same(task.escalated_to, me) ? 'you' : task.escalated_to} as the backup approver. {slots[0]} can still answer until one of you decides.
        </Notice>
      )}
    </>
  )

  const comments = <Comments comments={task.comments} onComment={onComment} onResolve={onResolve} />

  if (isMobile) {
    return (
      <div style={{ fontFamily: font, color: C.ink, background: C.bg, margin: '0 -12px', padding: '0 12px' }}>
        {header}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          {Renderer ? <Renderer {...rendererProps} /> : (
            <>
              <GenericPreview task={task} isMobile />
              <GenericBody task={task} artefact={artefact} isMobile edits={mode === 'edit' ? buildEdits(task, editValues) : null} />
            </>
          )}
          <HistorySection task={task} />
          {comments}
        </div>
        <div style={{ position: 'sticky', bottom: `calc(${MOBILE_NAV_H}px + env(safe-area-inset-bottom))`, zIndex: 5, margin: '16px -12px 0', background: '#fff', borderTop: `1px solid ${C.line}`, padding: '12px 16px 16px', boxShadow: '0 -4px 16px rgba(25,14,62,.06)' }}>
          {decision}{errLine}
        </div>
      </div>
    )
  }

  const decisionPanel = <Panel style={{ border: `2px solid ${C.indigo}` }}>{decision}{errLine}</Panel>
  return (
    <div style={{ fontFamily: font, color: C.ink, maxWidth: 1240 }}>
      {header}
      {Renderer ? (
        <>
          <div style={{ marginTop: 22 }}><Renderer {...rendererProps} /></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginTop: 16, alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>{comments}<HistorySection task={task} /></div>
            <div style={{ flex: '1 1 440px', minWidth: 0 }}>{decisionPanel}</div>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginTop: 22, alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <GenericBody task={task} artefact={artefact} edits={mode === 'edit' ? buildEdits(task, editValues) : null} />
            <HistorySection task={task} />
          </div>
          <div style={{ flex: '1 1 440px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <GenericPreview task={task} />
            {decisionPanel}
            {comments}
          </div>
        </div>
      )}
    </div>
  )
}
