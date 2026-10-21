import { useState, useEffect, useMemo, useCallback } from 'react'
import { ARTEFACT_TYPES } from '../lib/artefactTypes'
import { apiFetch } from '../lib/supabase'

const DECISION_STYLES = {
  approved:           { bg: '#e3fcef', color: '#00875a', label: 'Approved' },
  rejected:           { bg: '#ffebe6', color: '#de350b', label: 'Rejected' },
  revision_requested: { bg: '#fff3e0', color: '#b85c00', label: 'Revision requested' },
}

function relativeTime(iso) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.round(diff / 1000)
  if (s < 60)     return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60)     return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24)     return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 14)     return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function artefactPreview(task) {
  if (!task.artefact || typeof task.artefact !== 'object') return null
  const def = task.artefact_type ? ARTEFACT_TYPES[task.artefact_type] : null
  if (def) {
    const first = def.fields.find(f => task.artefact[f.key] != null && task.artefact[f.key] !== '')
    if (first) {
      const v = task.artefact[first.key]
      if (Array.isArray(v))       return `${first.label}: ${v.length} item${v.length === 1 ? '' : 's'}`
      if (typeof v === 'string')  return `${first.label}: ${v.length > 80 ? v.slice(0, 80) + '…' : v}`
      return `${first.label}: ${String(v)}`
    }
  }
  const keys = Object.keys(task.artefact)
  return keys.length ? `${keys.length} field${keys.length === 1 ? '' : 's'}` : null
}

function SubTabs({ tab, setTab, counts }) {
  const items = [
    { key: 'queue',   label: 'Queue',   count: counts.queue },
    { key: 'agents',  label: 'Agents',  count: counts.agents },
    { key: 'history', label: 'History', count: counts.history },
  ]
  return (
    <div className="scroll-x" style={{ display: 'flex', gap: 4, borderBottom: '1px solid #dfe1e6', marginBottom: 16 }}>
      {items.map(it => (
        <button key={it.key} onClick={() => setTab(it.key)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Nunito, sans-serif',
            fontWeight: 700, fontSize: 13, padding: '8px 14px',
            color: tab === it.key ? '#3D157D' : '#6b778c',
            borderBottom: tab === it.key ? '2px solid #3D157D' : '2px solid transparent',
            marginBottom: -1, display: 'flex', alignItems: 'center', gap: 6,
          }}>
          {it.label}
          {it.count > 0 && (
            <span style={{ background: tab === it.key ? '#3D157D' : '#dfe1e6', color: tab === it.key ? '#fff' : '#42526e',
              borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 7px' }}>{it.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

function QueueTab({ pending, projects, onSelect }) {
  const projectMap = useMemo(() => Object.fromEntries(projects.map(p => [p.id, p])), [projects])
  const grouped = useMemo(() => {
    const m = {}
    for (const t of pending) {
      const k = t.agent_id || '(unassigned)'
      ;(m[k] = m[k] || []).push(t)
    }
    // Sort each group by created_at ascending (oldest first — FIFO review queue)
    for (const k of Object.keys(m)) m[k].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    return m
  }, [pending])
  const groups = Object.keys(grouped).sort()

  if (!pending.length) return (
    <div style={{ background: '#fff', border: '1px solid #dfe1e6', borderRadius: 8, padding: 40, textAlign: 'center' }}>
      <p style={{ fontSize: 36, marginBottom: 8 }}>✓</p>
      <p style={{ fontSize: 14, fontWeight: 700, color: '#172b4d', marginBottom: 4 }}>Inbox zero</p>
      <p style={{ fontSize: 12, color: '#6b778c' }}>No approvals are pending. New submissions appear here grouped by agent.</p>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {groups.map(agent => (
        <section key={agent}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#6554c0' }} />
            <span style={{ fontSize: 12, fontWeight: 800, color: '#172b4d', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{agent}</span>
            <span style={{ background: '#ede9fe', color: '#6554c0', borderRadius: 10, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>{grouped[agent].length} pending</span>
          </div>
          <div style={{ background: '#fff', border: '1px solid #dfe1e6', borderRadius: 8, overflow: 'hidden' }}>
            {grouped[agent].map((task, i) => {
              const typeDef = task.artefact_type ? ARTEFACT_TYPES[task.artefact_type] : null
              const preview = artefactPreview(task)
              const proj = task.project_id ? projectMap[task.project_id] : null
              return (
                <div key={task.id} onClick={() => onSelect(task)}
                  style={{ padding: '12px 14px', borderBottom: i < grouped[agent].length - 1 ? '1px solid #f0f1f3' : 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f8f9ff'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      {typeDef ? (
                        <span style={{ background: '#ede9fe', color: '#6554c0', borderRadius: 10, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>{typeDef.label}</span>
                      ) : task.artefact_type ? (
                        <span style={{ background: '#f0f1f3', color: '#6b778c', borderRadius: 10, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>{task.artefact_type}</span>
                      ) : (
                        <span style={{ background: '#fff3e0', color: '#b85c00', borderRadius: 10, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>NO ARTEFACT</span>
                      )}
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#172b4d', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span>
                    </div>
                    {preview && (
                      <p style={{ fontSize: 12, color: '#6b778c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>{preview}</p>
                    )}
                    <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#97a0af' }}>
                      {proj && <span>📂 {proj.name}</span>}
                      <span>⏱ {relativeTime(task.created_at)}</span>
                    </div>
                  </div>
                  <span style={{ color: '#c1c7d0', fontSize: 14, flexShrink: 0 }}>›</span>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

function StatCard({ label, value, color }) {
  return (
    <div style={{ flex: 1, minWidth: 80, background: '#fff', border: '1px solid #dfe1e6', borderRadius: 8, padding: '10px 12px' }}>
      <p style={{ fontSize: 10, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 800, color: color || '#172b4d' }}>{value}</p>
    </div>
  )
}

function AgentsTab({ approvalTasks, auditRows, loadingAudit }) {
  const data = useMemo(() => {
    const map = {}
    for (const t of approvalTasks) {
      const k = t.agent_id || '(unassigned)'
      if (!map[k]) map[k] = { agent_id: k, total: 0, approved: 0, rejected: 0, revision_requested: 0, pending: 0, last_task_at: null }
      map[k].total += 1
      if (t.decision === 'approved')           map[k].approved += 1
      else if (t.decision === 'rejected')      map[k].rejected += 1
      else if (t.decision === 'revision_requested') map[k].revision_requested += 1
      else                                     map[k].pending += 1
      const ts = t.decision_at || t.created_at
      if (ts && (!map[k].last_task_at || new Date(ts) > new Date(map[k].last_task_at))) map[k].last_task_at = ts
    }
    for (const row of auditRows) {
      const k = row.agent_id || '(unassigned)'
      if (!map[k]) map[k] = { agent_id: k, total: 0, approved: 0, rejected: 0, revision_requested: 0, pending: 0, last_task_at: null }
      if (row.created_at && (!map[k].last_activity_at || new Date(row.created_at) > new Date(map[k].last_activity_at))) map[k].last_activity_at = row.created_at
      map[k].audit_count = (map[k].audit_count || 0) + 1
    }
    for (const k of Object.keys(map)) {
      const r = map[k]
      const candidates = [r.last_activity_at, r.last_task_at].filter(Boolean).map(d => new Date(d).getTime())
      r.last_seen = candidates.length ? new Date(Math.max(...candidates)).toISOString() : null
    }
    return Object.values(map).sort((a, b) => {
      const at = a.last_seen ? new Date(a.last_seen).getTime() : 0
      const bt = b.last_seen ? new Date(b.last_seen).getTime() : 0
      return bt - at
    })
  }, [approvalTasks, auditRows])

  if (!data.length) return (
    <div style={{ background: '#fff', border: '1px solid #dfe1e6', borderRadius: 8, padding: 40, textAlign: 'center' }}>
      <p style={{ fontSize: 14, fontWeight: 700, color: '#172b4d', marginBottom: 4 }}>No agent activity yet</p>
      <p style={{ fontSize: 12, color: '#6b778c' }}>
        {loadingAudit ? 'Loading audit log…' : 'Approval tasks and agent API calls will appear here.'}
      </p>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {data.map(r => {
        const isIdle = !r.last_seen || (Date.now() - new Date(r.last_seen).getTime() > 7 * 86400000)
        return (
          <div key={r.agent_id} style={{ background: '#fff', border: '1px solid #dfe1e6', borderRadius: 8, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: isIdle ? '#97a0af' : '#00875a' }} />
              <span style={{ fontSize: 14, fontWeight: 800, color: '#172b4d' }}>{r.agent_id}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b778c' }}>
                last seen <strong style={{ color: '#42526e' }}>{relativeTime(r.last_seen)}</strong>
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <StatCard label="Submitted" value={r.total} />
              <StatCard label="Pending"   value={r.pending}            color={r.pending  > 0 ? '#b85c00' : '#172b4d'} />
              <StatCard label="Approved"  value={r.approved}           color="#00875a" />
              <StatCard label="Rejected"  value={r.rejected}           color="#de350b" />
              <StatCard label="Revisions" value={r.revision_requested} color="#b85c00" />
              {typeof r.audit_count === 'number' && <StatCard label="API calls" value={r.audit_count} />}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function HistoryTab({ decidedTasks, projects, onSelect }) {
  const [agentFilter, setAgentFilter]     = useState('')
  const [decisionFilter, setDecisionFilter] = useState('')
  const [fromDate, setFromDate]           = useState('')
  const [toDate, setToDate]               = useState('')

  const projectMap = useMemo(() => Object.fromEntries(projects.map(p => [p.id, p])), [projects])
  const agents = useMemo(() => {
    const s = new Set()
    for (const t of decidedTasks) if (t.agent_id) s.add(t.agent_id)
    return Array.from(s).sort()
  }, [decidedTasks])

  const filtered = useMemo(() => {
    return decidedTasks.filter(t => {
      if (agentFilter    && t.agent_id !== agentFilter)   return false
      if (decisionFilter && t.decision !== decisionFilter) return false
      if (fromDate && t.decision_at && t.decision_at < fromDate) return false
      if (toDate   && t.decision_at && t.decision_at > toDate + 'T23:59:59.999Z') return false
      return true
    }).sort((a, b) => new Date(b.decision_at || 0) - new Date(a.decision_at || 0))
  }, [decidedTasks, agentFilter, decisionFilter, fromDate, toDate])

  const clearFilters = () => { setAgentFilter(''); setDecisionFilter(''); setFromDate(''); setToDate('') }
  const hasFilters = agentFilter || decisionFilter || fromDate || toDate
  const selectStyle = { padding: '6px 8px', borderRadius: 6, border: '1px solid #dfe1e6', fontSize: 12, fontFamily: 'Nunito, sans-serif', background: '#fff', outline: 'none', color: '#172b4d' }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)} style={selectStyle}>
          <option value="">All agents</option>
          {agents.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={decisionFilter} onChange={e => setDecisionFilter(e.target.value)} style={selectStyle}>
          <option value="">All decisions</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="revision_requested">Revision requested</option>
        </select>
        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={selectStyle} placeholder="From" />
        <input type="date" value={toDate}   onChange={e => setToDate(e.target.value)}   style={selectStyle} placeholder="To" />
        {hasFilters && (
          <button onClick={clearFilters}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b778c', fontFamily: 'Nunito, sans-serif', fontWeight: 700, fontSize: 12, padding: '6px 8px' }}>
            × Clear
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b778c' }}>{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>
      </div>

      {!filtered.length ? (
        <div style={{ background: '#fff', border: '1px solid #dfe1e6', borderRadius: 8, padding: 40, textAlign: 'center' }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: '#172b4d', marginBottom: 4 }}>No decisions match the filters</p>
          <p style={{ fontSize: 12, color: '#6b778c' }}>Adjust or clear filters to see past decisions.</p>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #dfe1e6', borderRadius: 8, overflow: 'hidden' }}>
          {filtered.map((task, i) => {
            const style = DECISION_STYLES[task.decision] || { bg: '#f0f1f3', color: '#42526e', label: task.decision }
            const proj = task.project_id ? projectMap[task.project_id] : null
            return (
              <div key={task.id} onClick={() => onSelect(task)}
                style={{ padding: '12px 14px', borderBottom: i < filtered.length - 1 ? '1px solid #f0f1f3' : 'none', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f8f9ff'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ background: style.bg, color: style.color, borderRadius: 10, padding: '1px 8px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{style.label}</span>
                  {task.artefact_type && <span style={{ background: '#ede9fe', color: '#6554c0', borderRadius: 10, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>{ARTEFACT_TYPES[task.artefact_type]?.label || task.artefact_type}</span>}
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#172b4d', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span>
                </div>
                <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#97a0af', flexWrap: 'wrap' }}>
                  {task.agent_id && <span>🤖 {task.agent_id}</span>}
                  <span>👤 {task.decision_by || '—'}</span>
                  <span>🕒 {task.decision_at ? new Date(task.decision_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                  {proj && <span>📂 {proj.name}</span>}
                </div>
                {task.decision_notes && (
                  <p style={{ fontSize: 12, color: '#42526e', marginTop: 6, whiteSpace: 'pre-wrap', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{task.decision_notes}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

export default function ApprovalsView({ tasks, projects, setSelectedTask }) {
  const [tab, setTab] = useState('queue')
  const [auditRows, setAuditRows] = useState([])
  const [loadingAudit, setLoadingAudit] = useState(false)

  const approvalTasks = useMemo(() => tasks.filter(t => t.task_type === 'approval'), [tasks])
  const pending       = useMemo(() => approvalTasks.filter(t => !t.decision), [approvalTasks])
  const decided       = useMemo(() => approvalTasks.filter(t => !!t.decision), [approvalTasks])

  const loadAudit = useCallback(async () => {
    setLoadingAudit(true)
    // anon cannot read agent_audit_log (see migration 04); hop through /api/audit-log
    // which uses the service_role key server-side.
    try {
      const resp = await apiFetch('/api/audit-log?limit=1000')
      const data = resp.ok ? await resp.json() : []
      setAuditRows(Array.isArray(data) ? data : [])
    } catch {
      setAuditRows([])
    } finally {
      setLoadingAudit(false)
    }
  }, [])
  useEffect(() => { if (tab === 'agents') loadAudit() }, [tab, loadAudit])

  const counts = { queue: pending.length, agents: 0, history: decided.length }

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#172b4d', marginBottom: 4 }}>Approvals</h1>
        <p style={{ fontSize: 12, color: '#6b778c' }}>Review artefacts submitted by AI agents. Decisions are immutable once recorded.</p>
      </div>
      <SubTabs tab={tab} setTab={setTab} counts={counts} />
      {tab === 'queue'   && <QueueTab   pending={pending}        projects={projects} onSelect={setSelectedTask} />}
      {tab === 'agents'  && <AgentsTab  approvalTasks={approvalTasks} auditRows={auditRows} loadingAudit={loadingAudit} />}
      {tab === 'history' && <HistoryTab decidedTasks={decided}   projects={projects} onSelect={setSelectedTask} />}
    </div>
  )
}
