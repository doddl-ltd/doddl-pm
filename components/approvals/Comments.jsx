// Comments on an approval: list, add, resolve (POST / PATCH /api/approvals/comment).
import { useState } from 'react'
import { C, fmtWhen } from '../../lib/approvalsUi'
import { Panel, H2, Btn, Chip, inputStyle } from './ui'

export function anchorText(a) {
  if (!a || typeof a !== 'object') return null
  if (a.kind === 'time') return `at ${a.t}`
  if (a.kind === 'field') return a.field
  if (a.kind === 'line') return `line ${a.line_id}`
  if (a.kind === 'point') return `${a.placement ? `${a.placement} · ` : ''}point`
  return null
}

export default function Comments({ comments, onComment, onResolve, readOnly }) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const list = comments || []
  const add = async () => {
    const text = body.trim()
    if (!text) return
    setBusy(true); setErr(null)
    try { await onComment(text, null); setBody('') } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Panel>
      <H2>Comments{list.length ? ` (${list.length})` : ''}</H2>
      {!list.length && <p style={{ margin: '0 0 10px', fontSize: 14, color: C.muted }}>No comments yet. Agents read these and reply here.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
        {list.map(c => (
          <div key={c.id} style={{ borderTop: `1px solid ${C.line2}`, paddingTop: 10, opacity: c.resolved ? 0.6 : 1 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
              <b>{String(c.author || '').replace(/^agent:/, '')}</b>
              <span style={{ color: C.muted }}>{fmtWhen(c.created_at)}</span>
              {anchorText(c.anchor) && <Chip tone="muted">{anchorText(c.anchor)}</Chip>}
              {c.resolved && <Chip tone="ok">Resolved</Chip>}
              {onResolve && (
                <button type="button" onClick={() => onResolve(c.id, !c.resolved).catch(e => setErr(e.message))}
                  style={{ marginLeft: 'auto', background: 'none', border: 0, color: C.indigo, font: "800 13px 'Nunito', sans-serif", cursor: 'pointer', minHeight: 32 }}>
                  {c.resolved ? 'Reopen' : 'Resolve'}
                </button>
              )}
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', textDecoration: c.resolved ? 'line-through' : 'none' }}>{c.body}</p>
          </div>
        ))}
      </div>
      {!readOnly && (
        <>
          <label htmlFor="appr-comment" style={{ fontSize: 13, fontWeight: 800, display: 'block', marginBottom: 6 }}>Add a comment</label>
          <textarea id="appr-comment" rows={2} value={body} onChange={e => setBody(e.target.value)} placeholder="Ask the agent a question, or note something for the other approver."
            style={{ ...inputStyle, resize: 'vertical' }} />
          {err && <p style={{ color: '#A12B2B', fontSize: 13, margin: '6px 0 0' }}>{err}</p>}
          <Btn small style={{ marginTop: 8 }} onClick={add} disabled={busy || !body.trim()}>{busy ? 'Adding…' : 'Add comment'}</Btn>
        </>
      )}
    </Panel>
  )
}
