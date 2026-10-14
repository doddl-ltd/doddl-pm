import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Evidence links (commits, PRs, artifacts, docs, meetings) and the change
// history for a task. History comes from task_history (migration 16), so
// overwritten notes and status changes are never lost.

const KIND_ICON = { commit: '⎇', pr: '⇄', artifact: '◆', doc: '📄', deploy: '🚀', email: '✉', meeting: '🗓', file: '📁', link: '🔗' }

function describe(h) {
  if (h.op === 'insert') return 'created the task'
  if (h.op === 'delete') return 'deleted the task'
  const fields = Object.keys(h.changed || {})
  const parts = fields.slice(0, 3).map(f => {
    const c = h.changed[f]
    if (['status', 'priority', 'assigned_to', 'progress', 'due_date'].includes(f)) return `${f.replace('_', ' ')} ${c.old ?? '—'} → ${c.new ?? '—'}`
    if (f === 'archived_at') return c.new ? 'archived it' : 'restored it'
    return `edited ${f.replace('_', ' ')}`
  })
  return parts.join(', ') + (fields.length > 3 ? ` +${fields.length - 3} more` : '')
}

export default function TaskEvidence({ taskId }) {
  const [links, setLinks] = useState([])
  const [history, setHistory] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [url, setUrl] = useState('')

  const load = useCallback(async () => {
    const [l, h] = await Promise.all([
      supabase.from('task_links').select('id, url, kind, label, added_by, created_at').eq('task_id', taskId).order('created_at'),
      supabase.from('task_history').select('id, op, actor, changed, created_at').eq('task_id', taskId).order('created_at', { ascending: false }).limit(30),
    ])
    setLinks(l.data || [])
    setHistory(h.data || [])
  }, [taskId])
  useEffect(() => { load() }, [load])

  const addLink = async () => {
    const v = url.trim()
    if (!v) return
    await supabase.from('task_links').insert([{ task_id: taskId, url: v, kind: 'link' }])
    setUrl('')
    load()
  }

  return (
    <div style={{ padding: '12px 20px', borderBottom: '1px solid #f0f1f3' }}>
      <p style={{ fontSize: 10, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Evidence ({links.length})</p>
      {links.map(l => (
        <div key={l.id} style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 12, marginBottom: 4 }}>
          <span style={{ width: 16, textAlign: 'center' }}>{KIND_ICON[l.kind] || '🔗'}</span>
          {/^https?:\/\//.test(l.url)
            ? <a href={l.url} target="_blank" rel="noreferrer" style={{ color: '#0052cc', wordBreak: 'break-all' }}>{l.label || l.url}</a>
            : <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{l.label ? `${l.label} — ${l.url}` : l.url}</code>}
          <span style={{ color: '#a0aec0', marginLeft: 'auto', whiteSpace: 'nowrap' }}>{l.added_by}</span>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addLink() }}
          placeholder="Add a link, commit or file path…"
          style={{ flex: 1, border: '1px solid #dfe1e6', borderRadius: 6, padding: '5px 8px', fontSize: 12, fontFamily: 'Nunito, sans-serif', outline: 'none' }} />
        <button onClick={addLink} style={{ border: '1px solid #dfe1e6', background: '#fff', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#42526e', fontFamily: 'Nunito, sans-serif' }}>Add</button>
      </div>
      <button onClick={() => setShowHistory(s => !s)}
        style={{ marginTop: 10, background: 'none', border: 'none', padding: 0, fontSize: 11, fontWeight: 700, color: '#6b778c', cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}>
        {showHistory ? '▾' : '▸'} History ({history.length})
      </button>
      {showHistory && history.map(h => (
        <div key={h.id} style={{ fontSize: 11, color: '#42526e', margin: '4px 0 0 12px' }}>
          <strong>{h.actor}</strong> {describe(h)}
          <span style={{ color: '#a0aec0' }}> · {new Date(h.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      ))}
    </div>
  )
}
