import { useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { ARTEFACT_TYPES } from '../lib/artefactTypes'

const DECISION_STYLES = {
  approved:            { bg: '#e3fcef', color: '#00875a', label: 'Approved' },
  approved_with_edits: { bg: '#e3fcef', color: '#00875a', label: 'Approved with edits' },
  partially_approved:  { bg: '#e3fcef', color: '#00875a', label: 'Partly approved' },
  expired:             { bg: '#f0f1f3', color: '#42526e', label: 'Expired' },
  rejected:            { bg: '#ffebe6', color: '#de350b', label: 'Rejected' },
  revision_requested:  { bg: '#fff3e0', color: '#b85c00', label: 'Revision requested' },
}

function FieldRow({ field, value }) {
  if (value == null || value === '') return null
  let body = null
  if (field.render === 'link' && typeof value === 'string') {
    body = <a href={value} target="_blank" rel="noreferrer" style={{ color: '#0052cc', wordBreak: 'break-all' }}>{value}</a>
  } else if (field.render === 'code' && typeof value === 'string') {
    body = <code style={{ background: '#f0f1f3', borderRadius: 3, padding: '1px 6px', fontSize: 12 }}>{value}</code>
  } else if (field.render === 'badge' && typeof value === 'string') {
    const riskColor = value === 'high' ? '#de350b' : value === 'medium' ? '#ff8b00' : '#00875a'
    body = <span style={{ background: riskColor + '18', color: riskColor, borderRadius: 10, padding: '2px 8px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>{value}</span>
  } else if (field.render === 'list' && Array.isArray(value)) {
    body = <ul style={{ margin: 0, paddingLeft: 18 }}>{value.map((item, i) => <li key={i} style={{ fontSize: 13, color: '#172b4d', marginBottom: 2 }}>{String(item)}</li>)}</ul>
  } else {
    body = <span style={{ fontSize: 13, color: '#172b4d' }}>{String(value)}</span>
  }
  return (
    <div style={{ marginBottom: 10 }}>
      <p style={{ fontSize: 10, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{field.label}</p>
      {body}
    </div>
  )
}

export default function ApprovalTaskPanel({ task, userName, onUpdate }) {
  const [notes, setNotes]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)

  const typeDef = task.artefact_type ? ARTEFACT_TYPES[task.artefact_type] : null
  const hasDecision = !!task.decision
  const decisionStyle = hasDecision ? (DECISION_STYLES[task.decision] || { bg: '#f0f1f3', color: '#42526e', label: task.decision }) : null

  const submitDecision = async (decision) => {
    if ((decision === 'rejected' || decision === 'revision_requested') && !notes.trim()) {
      setError('Notes are required when rejecting or requesting revisions.')
      return
    }
    setSaving(true); setError(null)
    // Approvals v2: every decision goes through /api/approvals/decide (votes, two approvers, the lock);
    // the /api/db proxy refuses decisions on tasks with an approvers list.
    let err = null
    try {
      const r = await apiFetch('/api/approvals/decide', { method: 'POST', body: JSON.stringify({ task_id: task.id, outcome: decision, notes: notes.trim() || undefined }) })
      if (!r.ok) err = ((await r.json().catch(() => null)) || {}).error || `Request failed (${r.status})`
    } catch (e) { err = e.message }
    setSaving(false)
    if (err) { setError(err); return }
    setNotes('')
    onUpdate()
  }

  return (
    <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0f1f3', background: '#fafbfc' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Approval artefact</span>
        {typeDef && <span style={{ background: '#ede9fe', color: '#6554c0', borderRadius: 10, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>{typeDef.label}</span>}
        {task.agent_id && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b778c' }}>from <strong style={{ color: '#42526e' }}>{task.agent_id}</strong></span>}
      </div>

      {!task.artefact_type || !task.artefact ? (
        <p style={{ fontSize: 13, color: '#a0aec0', fontWeight: 600, padding: '8px 0' }}>
          Awaiting artefact attachment from agent. Approval actions unlock once the artefact is posted.
        </p>
      ) : (
        <>
          {typeDef?.description && <p style={{ fontSize: 12, color: '#6b778c', marginBottom: 10 }}>{typeDef.description}</p>}

          <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #dfe1e6', padding: 12, marginBottom: 12 }}>
            {typeDef
              ? typeDef.fields.map(f => <FieldRow key={f.key} field={f} value={task.artefact[f.key]} />)
              : Object.entries(task.artefact).map(([k, v]) => (
                  <FieldRow key={k} field={{ key: k, label: k, render: 'text' }} value={v} />
                ))
            }
            {task.staging_url && (
              <FieldRow field={{ key: 'staging_url', label: 'Staging URL', render: 'link' }} value={task.staging_url} />
            )}
          </div>

          {hasDecision ? (
            <div style={{ background: decisionStyle.bg, borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ color: decisionStyle.color, fontWeight: 800, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{decisionStyle.label}</span>
                <span style={{ fontSize: 11, color: '#6b778c', marginLeft: 'auto' }}>
                  by <strong style={{ color: '#42526e' }}>{task.decision_by || '—'}</strong>
                  {task.decision_at && <> · {new Date(task.decision_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</>}
                </span>
              </div>
              {task.decision_notes && <p style={{ fontSize: 13, color: '#172b4d', whiteSpace: 'pre-wrap' }}>{task.decision_notes}</p>}
            </div>
          ) : (
            <>
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Notes (required when rejecting or requesting revisions)…" rows={2}
                style={{ width: '100%', border: '1px solid #dfe1e6', borderRadius: 6, padding: '8px 10px', fontSize: 13, fontFamily: 'Nunito, sans-serif', resize: 'vertical', outline: 'none', marginBottom: 8, boxSizing: 'border-box' }} />
              {error && <p style={{ fontSize: 12, color: '#de350b', marginBottom: 8 }}>{error}</p>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => submitDecision('approved')} disabled={saving}
                  style={{ flex: 1, background: '#00875a', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Nunito, sans-serif', opacity: saving ? 0.5 : 1 }}>Approve</button>
                <button onClick={() => submitDecision('revision_requested')} disabled={saving}
                  style={{ flex: 1, background: '#fff', color: '#b85c00', border: '1px solid #ff8b00', borderRadius: 6, padding: '8px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Nunito, sans-serif', opacity: saving ? 0.5 : 1 }}>Request revision</button>
                <button onClick={() => submitDecision('rejected')} disabled={saving}
                  style={{ flex: 1, background: '#fff', color: '#de350b', border: '1px solid #de350b', borderRadius: 6, padding: '8px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Nunito, sans-serif', opacity: saving ? 0.5 : 1 }}>Reject</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
