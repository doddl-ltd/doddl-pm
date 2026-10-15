import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { TEAM } from '../lib/team'

// Triage: captured emails, Teams messages, meeting notes (doddl-transcribe)
// and agent proposals. Nothing becomes a task until someone accepts it here
// (or asks Claude to, via the MCP triage tool).

const SOURCE_STYLE = {
  meeting: { bg: '#ede9fe', color: '#6554c0', label: 'Meeting' },
  email:   { bg: '#e9f2ff', color: '#0052cc', label: 'Email' },
  teams:   { bg: '#e6f7fb', color: '#006680', label: 'Teams' },
  teamsmaestro: { bg: '#e6f7fb', color: '#006680', label: 'Teams' },
  agent:   { bg: '#fff3e0', color: '#b85c00', label: 'Agent' },
  manual:  { bg: '#f4f5f7', color: '#42526e', label: 'Manual' },
}

const input = { border: '1px solid #dfe1e6', borderRadius: 6, padding: '4px 6px', fontSize: 12, fontFamily: 'Nunito, sans-serif', color: '#172b4d', background: '#fff' }
const button = (primary) => ({ background: primary ? '#3D157D' : '#fff', color: primary ? '#fff' : '#42526e', border: primary ? 'none' : '1px solid #dfe1e6', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' })

function fmt(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function TriageCard({ item, projects, onDone }) {
  const proposed = Array.isArray(item.proposed_actions) && item.proposed_actions.length
    ? item.proposed_actions
    : [{ kind: 'create_task', title: item.title, notes: item.summary }]
  const [selected, setSelected] = useState(() => proposed.map(() => true))
  const [edits, setEdits] = useState({})
  const [projectId, setProjectId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const src = SOURCE_STYLE[item.source] || SOURCE_STYLE.manual
  const payload = item.payload || {}

  const edit = (i, field, value) => setEdits(e => ({ ...e, [i]: { ...(e[i] || {}), [field]: value } }))
  // Actions may name a project; the selector overrides it (and is required when none is named).
  const needsProject = proposed.some((a, i) => selected[i] && a.kind !== 'update_task' && !a.project_id && !a.project)
  const hasCreates = proposed.some((a, i) => selected[i] && a.kind !== 'update_task')
  const proposedProjects = Array.from(new Set(proposed.filter(a => a.kind !== 'update_task' && a.project).map(a => a.project)))

  const submit = async (decision) => {
    setBusy(true); setError(null)
    try {
      const body = { id: item.id, decision }
      if (decision === 'accept') {
        body.accept_actions = proposed.map((_, i) => i).filter(i => selected[i])
        body.edits = { ...edits }
        if (projectId) {
          // An explicit choice beats the project named in the proposal.
          proposed.forEach((a, i) => { if (a.kind !== 'update_task') body.edits[i] = { ...(body.edits[i] || {}), project_id: projectId, project: null, group: null } })
          body.project_id = projectId
        }
      }
      const resp = await apiFetch('/api/triage', { method: 'POST', body: JSON.stringify(body) })
      const out = await resp.json()
      if (!resp.ok) throw new Error(out.error || 'Triage failed')
      onDone()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #dfe1e6', padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ background: src.bg, color: src.color, borderRadius: 3, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{src.label}</span>
        <span style={{ fontWeight: 800, fontSize: 14, color: '#172b4d' }}>{item.title}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b778c', fontWeight: 600 }}>{fmt(item.occurred_at || item.created_at)}</span>
      </div>
      {item.summary && <p style={{ fontSize: 13, color: '#42526e', lineHeight: 1.5, margin: '0 0 8px' }}>{item.summary}</p>}
      {Array.isArray(payload.decisions) && payload.decisions.length > 0 && (
        <div style={{ fontSize: 12, color: '#42526e', margin: '0 0 8px' }}>
          <strong>Decisions:</strong> {payload.decisions.join(' · ')}
        </div>
      )}
      {item.participants && item.participants.length > 0 && (
        <div style={{ fontSize: 11, color: '#6b778c', margin: '0 0 10px' }}>With {item.participants.join(', ')}</div>
      )}

      <div style={{ borderTop: '1px solid #f4f5f7', paddingTop: 8 }}>
        {proposed.map((a, i) => {
          const e = edits[i] || {}
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', flexWrap: 'wrap' }}>
              <input type="checkbox" checked={selected[i]} onChange={ev => setSelected(s => s.map((v, j) => (j === i ? ev.target.checked : v)))} />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#6b778c', minWidth: 52 }}>{a.kind === 'update_task' ? 'Update' : 'New task'}</span>
              <span style={{ flex: 1, minWidth: 180, fontSize: 13, color: '#172b4d' }}>
                {e.title || a.title || a.task_id}
                {(a.status || a.progress != null) && <span style={{ fontSize: 11, color: '#6b778c', fontWeight: 700 }}> · {a.status || ''}{a.progress != null ? ` ${a.progress}%` : ''}</span>}
              </span>
              <select style={input} value={e.assigned_to ?? a.assigned_to ?? ''} onChange={ev => edit(i, 'assigned_to', ev.target.value || null)}>
                <option value="">Unassigned</option>
                {TEAM.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
              <input type="date" style={input} value={e.due_date ?? a.due_date ?? ''} onChange={ev => edit(i, 'due_date', ev.target.value || null)} />
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {hasCreates && (
          <select style={{ ...input, padding: '6px 8px' }} value={projectId} onChange={ev => setProjectId(ev.target.value)}>
            <option value="">{needsProject ? 'Choose project for new tasks…' : `Project: ${proposedProjects.join(', ')} (as proposed)`}</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {error && <span style={{ fontSize: 12, color: '#de350b', fontWeight: 700 }}>{error}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button style={button(false)} disabled={busy} onClick={() => submit('dismiss')}>Dismiss</button>
          <button style={button(true)} disabled={busy || !selected.some(Boolean) || (needsProject && !projectId)} onClick={() => submit('accept')}>
            {busy ? 'Saving…' : 'Accept selected'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TriageView({ projects, onChanged, setTriageCount }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const resp = await apiFetch('/api/triage?status=new,partial')
      const out = await resp.json()
      if (!resp.ok) throw new Error(out.error || 'Could not load the inbox')
      setItems(out.items)
      if (setTriageCount) setTriageCount(out.total)
    } catch (e) {
      setError(e.message)
    }
  }, [setTriageCount])

  useEffect(() => { load() }, [load])

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontWeight: 800, fontSize: 18, color: 'var(--indigo)' }}>Triage</h2>
        <p style={{ fontSize: 13, color: '#6b778c', fontWeight: 600, marginTop: 2 }}>Captured emails, meetings and agent proposals. Accept to turn them into tasks.</p>
      </div>
      {error && <p style={{ color: '#de350b', fontWeight: 700, fontSize: 13 }}>{error}</p>}
      {items === null && !error && <p style={{ color: '#6b778c', fontWeight: 600 }}>Loading…</p>}
      {items && items.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#6b778c' }}>
          <p style={{ fontSize: 32, marginBottom: 8 }}>📥</p>
          <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Nothing to triage</p>
          <p style={{ fontSize: 13 }}>Meeting notes, captured emails and agent proposals appear here</p>
        </div>
      )}
      {items && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map(item => (
            <TriageCard key={item.id} item={item} projects={projects} onDone={() => { load(); if (onChanged) onChanged() }} />
          ))}
        </div>
      )}
    </>
  )
}
