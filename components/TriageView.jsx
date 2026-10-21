import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { TEAM } from '../lib/team'

// Triage. Claude files captured actions itself (lib/pm/autoTriage.js, every
// few minutes): "Needs a look" only holds what it was unsure about, and
// "Filed by Claude" shows what it did, with Undo.

const SOURCE_STYLE = {
  meeting: { bg: '#ede9fe', color: '#6554c0', label: 'Meeting' },
  email:   { bg: '#e9f2ff', color: '#0052cc', label: 'Email' },
  teams:   { bg: '#e6f7fb', color: '#006680', label: 'Teams' },
  teamsmaestro: { bg: '#e6f7fb', color: '#006680', label: 'Teams' },
  chat:    { bg: '#fdf2e9', color: '#a14d0b', label: 'Claude chat' },
  agent:   { bg: '#fff3e0', color: '#b85c00', label: 'Agent' },
  manual:  { bg: '#f4f5f7', color: '#42526e', label: 'Manual' },
}

const input = { border: '1px solid #dfe1e6', borderRadius: 6, padding: '4px 6px', fontSize: 12, fontFamily: 'Nunito, sans-serif', color: '#172b4d', background: '#fff' }
const button = (primary) => ({ background: primary ? '#3D157D' : '#fff', color: primary ? '#fff' : '#42526e', border: primary ? 'none' : '1px solid #dfe1e6', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' })
const tabStyle = (on) => ({ background: 'none', border: 'none', borderBottom: on ? '2px solid #3D157D' : '2px solid transparent', padding: '6px 2px', marginRight: 18, fontSize: 13, fontWeight: 800, color: on ? '#3D157D' : '#6b778c', cursor: 'pointer', fontFamily: 'Nunito, sans-serif' })

function fmt(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function actionsOf(item) {
  return Array.isArray(item.proposed_actions) && item.proposed_actions.length
    ? item.proposed_actions
    : [{ kind: 'create_task', title: item.title, notes: item.summary }]
}

function decisionFor(item, index) {
  return (Array.isArray(item.auto_decisions) ? item.auto_decisions : []).find(d => d.index === index) || null
}

function Header({ item }) {
  const src = SOURCE_STYLE[item.source] || SOURCE_STYLE.manual
  const payload = item.payload || {}
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ background: src.bg, color: src.color, borderRadius: 3, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{src.label}</span>
        <span style={{ fontWeight: 800, fontSize: 14, color: '#172b4d', minWidth: 0, wordBreak: 'break-word' }}>{item.title}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b778c', fontWeight: 600 }}>{fmt(item.occurred_at || item.created_at)}</span>
      </div>
      {item.summary && <p style={{ fontSize: 13, color: '#42526e', lineHeight: 1.5, margin: '0 0 8px' }}>{item.summary}</p>}
      {Array.isArray(payload.decisions) && payload.decisions.length > 0 && (
        <div style={{ fontSize: 12, color: '#42526e', margin: '0 0 8px' }}><strong>Decisions:</strong> {payload.decisions.join(' · ')}</div>
      )}
      {item.participants && item.participants.length > 0 && (
        <div style={{ fontSize: 11, color: '#6b778c', margin: '0 0 10px' }}>With {item.participants.join(', ')}</div>
      )}
    </>
  )
}

function ReviewCard({ item, projects, onDone }) {
  const proposed = actionsOf(item)
  const filed = proposed.map((_, i) => { const d = decisionFor(item, i); return d && d.op !== 'review' })
  const [selected, setSelected] = useState(() => proposed.map((_, i) => !filed[i]))
  const [edits, setEdits] = useState({})
  const [projectId, setProjectId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const filing = item.auto_status === 'pending' || item.auto_status === 'processing'
  const canRetry = item.status === 'new' && (item.auto_status === 'needs_review' || item.auto_status === 'undone')

  const edit = (i, field, value) => setEdits(e => ({ ...e, [i]: { ...(e[i] || {}), [field]: value } }))
  const open = proposed.map((a, i) => ({ a, i })).filter(({ i }) => !filed[i])
  const needsProject = open.some(({ a, i }) => selected[i] && a.kind !== 'update_task' && !a.project_id && !a.project && !item.project_hint_id)
  const hasCreates = open.some(({ a, i }) => selected[i] && a.kind !== 'update_task')

  const submit = async (decision) => {
    setBusy(true); setError(null)
    try {
      const body = { id: item.id, decision }
      if (decision === 'accept') {
        body.accept_actions = open.map(({ i }) => i).filter(i => selected[i])
        body.edits = { ...edits }
        if (projectId) {
          open.forEach(({ a, i }) => { if (a.kind !== 'update_task') body.edits[i] = { ...(body.edits[i] || {}), project_id: projectId, project: null, group: null } })
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
      <Header item={item} />
      {filing && <div style={{ fontSize: 12, color: '#6554c0', fontWeight: 700, marginBottom: 6 }}>Claude is filing this…</div>}
      {item.auto_reason && !filing && <div style={{ fontSize: 12, color: '#6b778c', marginBottom: 6 }}>Claude: {item.auto_reason}</div>}
      <div style={{ borderTop: '1px solid #f4f5f7', paddingTop: 8 }}>
        {proposed.map((a, i) => {
          const e = edits[i] || {}
          const d = decisionFor(item, i)
          if (filed[i]) {
            return (
              <div key={i} style={{ display: 'flex', gap: 8, padding: '5px 0', fontSize: 12, color: '#00875a' }}>
                <span>✓</span><span style={{ flex: 1 }}>{a.title || a.task_id} — {d.op === 'skip' ? 'skipped' : d.op === 'create' ? 'added as a task' : 'task updated'} by Claude</span>
              </div>
            )
          }
          return (
            <div key={i} style={{ padding: '5px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <input type="checkbox" checked={selected[i]} onChange={ev => setSelected(s => s.map((v, j) => (j === i ? ev.target.checked : v)))} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#6b778c', minWidth: 52 }}>{a.kind === 'update_task' ? 'Update' : 'New task'}</span>
                <span style={{ flex: 1, minWidth: 'min(180px, 70%)', fontSize: 13, color: '#172b4d', wordBreak: 'break-word' }}>
                  {e.title || a.title || a.task_id}
                  {(a.status || a.progress != null) && <span style={{ fontSize: 11, color: '#6b778c', fontWeight: 700 }}> · {a.status || ''}{a.progress != null ? ` ${a.progress}%` : ''}</span>}
                </span>
                <select style={input} value={e.assigned_to ?? a.assigned_to ?? ''} onChange={ev => edit(i, 'assigned_to', ev.target.value || null)}>
                  <option value="">Unassigned</option>
                  {TEAM.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>
                <input type="date" style={input} value={e.due_date ?? a.due_date ?? ''} onChange={ev => edit(i, 'due_date', ev.target.value || null)} />
              </div>
              {d && d.reason && <div style={{ fontSize: 11, color: '#b85c00', margin: '3px 0 0 26px' }}>Claude wasn't sure: {d.reason}</div>}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {hasCreates && (
          <select style={{ ...input, padding: '6px 8px' }} value={projectId} onChange={ev => setProjectId(ev.target.value)}>
            <option value="">{needsProject ? 'Choose project for new tasks…' : 'Project: as proposed'}</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {error && <span style={{ fontSize: 12, color: '#de350b', fontWeight: 700 }}>{error}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {canRetry && <button style={button(false)} disabled={busy} title="E.g. after creating the project it was missing" onClick={() => submit('retry')}>Ask Claude again</button>}
          <button style={button(false)} disabled={busy} onClick={() => submit('dismiss')}>Dismiss</button>
          <button style={button(true)} disabled={busy || !open.some(({ i }) => selected[i]) || (needsProject && !projectId)} onClick={() => submit('accept')}>
            {busy ? 'Saving…' : 'Accept selected'}
          </button>
        </div>
      </div>
    </div>
  )
}

function FiledCard({ item, tasks, projects, onDone }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const taskById = new Map(tasks.map(t => [t.id, t]))
  const projectById = new Map(projects.map(p => [p.id, p.name]))
  const decisions = Array.isArray(item.auto_decisions) ? item.auto_decisions : []
  const proposed = actionsOf(item)
  const canUndo = item.auto_status !== 'undone' && decisions.some(d => d.op === 'create' && d.created && !d.undone)

  const undo = async () => {
    setBusy(true); setError(null)
    try {
      const resp = await apiFetch('/api/triage', { method: 'POST', body: JSON.stringify({ id: item.id, decision: 'undo' }) })
      const out = await resp.json()
      if (!resp.ok) throw new Error(out.error || 'Undo failed')
      onDone()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #dfe1e6', padding: '14px 16px', opacity: item.auto_status === 'undone' ? 0.6 : 1 }}>
      <Header item={item} />
      {item.auto_reason && <div style={{ fontSize: 12, color: '#42526e', marginBottom: 6 }}>Claude: {item.auto_reason}</div>}
      <div style={{ borderTop: '1px solid #f4f5f7', paddingTop: 8 }}>
        {decisions.map(d => {
          const t = d.task_id ? taskById.get(d.task_id) : null
          const a = proposed[d.index] || {}
          const where = t ? projectById.get(t.project_id) : (d.project_id ? projectById.get(d.project_id) : null)
          const what = d.op === 'create' ? (d.undone ? 'Created (undone)' : d.created === false ? 'Already existed' : 'Created')
            : d.op === 'update' ? 'Updated' : d.op === 'skip' ? 'Skipped' : 'Left for you'
          return (
            <div key={d.index} style={{ display: 'flex', gap: 8, padding: '4px 0', fontSize: 12, alignItems: 'baseline' }}>
              <span style={{ fontWeight: 800, minWidth: 90, color: d.op === 'review' ? '#b85c00' : '#00875a' }}>{what}</span>
              <span style={{ flex: 1, color: '#172b4d' }}>
                {(t && t.title) || a.title || '—'}
                {where && <span style={{ color: '#6b778c' }}> · {where}{d.op === 'create' && d.project_fit === 'reasonable' ? ' (best guess)' : ''}</span>}
                {t && t.assigned_to && <span style={{ color: '#6b778c' }}> · {t.assigned_to}</span>}
                {d.reason && d.op !== 'create' && <span style={{ color: '#6b778c' }}> — {d.reason}</span>}
              </span>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span style={{ fontSize: 11, color: '#a0aec0' }}>Filed {fmt(item.auto_at)}{item.auto_status === 'undone' ? ' · undone' : ''}</span>
        {error && <span style={{ fontSize: 12, color: '#de350b', fontWeight: 700 }}>{error}</span>}
        {canUndo && <button style={{ ...button(false), marginLeft: 'auto' }} disabled={busy} onClick={undo}>{busy ? 'Undoing…' : 'Undo'}</button>}
      </div>
    </div>
  )
}

export default function TriageView({ projects, tasks = [], onChanged, setTriageCount }) {
  const [tab, setTab] = useState('review')
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const [retrying, setRetrying] = useState(false)

  const load = useCallback(async () => {
    setItems(null)
    try {
      const resp = await apiFetch(`/api/triage?view=${tab}`)
      const out = await resp.json()
      if (!resp.ok) throw new Error(out.error || 'Could not load the inbox')
      setItems(out.items)
      if (tab === 'review' && setTriageCount) setTriageCount(out.total)
    } catch (e) {
      setError(e.message)
    }
  }, [tab, setTriageCount])

  useEffect(() => { load() }, [load])
  const done = () => { load(); if (onChanged) onChanged() }
  const retryAll = async () => {
    setRetrying(true); setError(null)
    try {
      const resp = await apiFetch('/api/triage', { method: 'POST', body: JSON.stringify({ decision: 'retry', all: true }) })
      const out = await resp.json()
      if (!resp.ok) throw new Error(out.error || 'Could not ask Claude again')
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setRetrying(false)
    }
  }
  const retryable = tab === 'review' && items ? items.filter(i => i.status === 'new' && i.auto_status === 'needs_review').length : 0
  const paused = tab === 'review' && items ? items.find(i => i.auto_status === 'pending' && String(i.auto_error || '').startsWith('Paused:')) : null

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ fontWeight: 800, fontSize: 18, color: 'var(--indigo)' }}>Triage</h2>
        <p style={{ fontSize: 13, color: '#6b778c', fontWeight: 600, marginTop: 2 }}>Meetings, flagged emails, Teams messages, Claude chats and agents. Claude files them into projects; only what it isn't sure about waits here.</p>
      </div>
      <div style={{ borderBottom: '1px solid #dfe1e6', marginBottom: 14, display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={tabStyle(tab === 'review')} onClick={() => setTab('review')}>Needs a look</button>
        <button style={tabStyle(tab === 'filed')} onClick={() => setTab('filed')}>Filed by Claude</button>
        {retryable > 1 && (
          <button style={{ ...button(false), marginLeft: 'auto', marginBottom: 4 }} disabled={retrying} title="E.g. after creating projects that were missing" onClick={retryAll}>
            {retrying ? 'Asking…' : 'Ask Claude again for all'}
          </button>
        )}
      </div>
      {error && <p style={{ color: '#de350b', fontWeight: 700, fontSize: 13 }}>{error}</p>}
      {paused && (
        <div style={{ background: '#fffae6', border: '1px solid #ffe380', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#172b4d' }}>
          <strong>Claude has paused filing.</strong> {paused.auto_error.replace(/^Paused:\s*/, '')} Nothing is lost: queued items are filed automatically once this is fixed.
        </div>
      )}
      {items === null && !error && <p style={{ color: '#6b778c', fontWeight: 600 }}>Loading…</p>}
      {items && items.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#6b778c' }}>
          <p style={{ fontSize: 32, marginBottom: 8 }}>{tab === 'review' ? '📥' : '🗂️'}</p>
          <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{tab === 'review' ? 'Nothing needs a look' : 'Nothing filed yet'}</p>
          <p style={{ fontSize: 13 }}>{tab === 'review' ? 'Claude files new items automatically; anything it is unsure about appears here.' : 'Items Claude files from meetings, emails, Teams and chats appear here, with Undo.'}</p>
        </div>
      )}
      {items && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map(item => (tab === 'review'
            ? <ReviewCard key={item.id} item={item} projects={projects} onDone={done} />
            : <FiledCard key={item.id} item={item} tasks={tasks} projects={projects} onDone={done} />))}
        </div>
      )}
    </>
  )
}
