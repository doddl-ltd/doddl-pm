import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { STATUSES, PRIORITIES } from '../lib/constants'
import StatusBadge from './StatusBadge'
import PriorityBadge from './PriorityBadge'
import ProgressBar from './ProgressBar'
import { useIsMobile } from '../lib/useIsMobile'

const dueLabel = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day:'numeric', month:'short' }) : '—'

// Phone: one card per task (title in full, project, then the editable chips).
function MwTaskCards({ items, sortFn, projects, todayStr, setSelectedTask, load }) {
  return (
    <div>
      {[...items].sort(sortFn).map(task => {
        const proj = projects.find(p => p.id === task.project_id)
        const isOvd = task.due_date && task.due_date < todayStr
        return (
          <div key={task.id} onClick={() => setSelectedTask(task)}
            style={{ padding: '12px 14px', borderBottom: '1px solid #f0f1f3', cursor: 'pointer', background: '#fff' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#172b4d', lineHeight: 1.35, wordBreak: 'break-word' }}>{task.title}</div>
            {proj && <div style={{ marginTop: 5 }}><span style={{ fontSize: 11, background: '#f0f1f3', borderRadius: 3, padding: '2px 8px', fontWeight: 600, color: '#42526e' }}>{proj.name}</span></div>}
            <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 9, flexWrap: 'wrap' }}>
              <StatusBadge value={task.status} onChange={async v => { await supabase.from('tasks').update({ status: v }).eq('id', task.id); load() }} />
              <span style={{ fontSize: 12, fontWeight: isOvd ? 800 : 600, color: isOvd ? '#de350b' : '#42526e', whiteSpace: 'nowrap' }}>{isOvd ? '⚠ ' : ''}{dueLabel(task.due_date)}</span>
              <PriorityBadge value={task.priority} onChange={async v => { await supabase.from('tasks').update({ priority: v }).eq('id', task.id); load() }} />
              <div style={{ flex: 1, minWidth: 96 }}>
                <ProgressBar value={task.progress} onChange={async v => { await supabase.from('tasks').update({ progress: v }).eq('id', task.id); load() }} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MwTaskTable({ items, sortFn, projects, todayStr, setSelectedTask, load }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: '#f8f9fc', borderBottom: '2px solid #dfe1e6' }}>
          {['Task','Project','Status','Due','Priority','Progress'].map(h =>
            <th key={h} style={{ padding: '8px 8px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase' }}>{h}</th>
          )}
        </tr>
      </thead>
      <tbody>
        {[...items].sort(sortFn).map(task => {
          const proj = projects.find(p => p.id === task.project_id)
          const isOvd = task.due_date && task.due_date < todayStr
          return (
            <tr key={task.id} onClick={() => setSelectedTask(task)}
              style={{ borderBottom: '1px solid #f0f1f3', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = '#f8f9ff'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <td style={{ padding: '9px 8px', fontSize: 13, fontWeight: 600, color: '#172b4d', maxWidth: 400 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
                {task.notes && <div style={{ fontSize: 11, color: '#6b778c', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(task.notes).substring(0,80)}</div>}
              </td>
              <td style={{ padding: '9px 8px' }}>
                {proj
                  ? <span style={{ fontSize: 11, background: '#f0f1f3', borderRadius: 3, padding: '2px 8px', fontWeight: 600, color: '#42526e', whiteSpace: 'nowrap' }}>{proj.name.substring(0,25)}{proj.name.length>25?'…':''}</span>
                  : <span style={{ fontSize: 11, color: '#c1c7d0' }}>—</span>}
              </td>
              <td style={{ padding: '9px 8px' }} onClick={e => e.stopPropagation()}>
                <StatusBadge value={task.status} onChange={async v => { await supabase.from('tasks').update({ status: v }).eq('id', task.id); load() }} />
              </td>
              <td style={{ padding: '9px 8px', fontSize: 12, fontWeight: isOvd ? 700 : 500, color: isOvd ? '#de350b' : '#42526e', whiteSpace: 'nowrap' }}>
                {task.due_date ? new Date(task.due_date).toLocaleDateString('en-GB', { day:'numeric', month:'short' }) : '—'}
              </td>
              <td style={{ padding: '9px 8px' }} onClick={e => e.stopPropagation()}>
                <PriorityBadge value={task.priority} onChange={async v => { await supabase.from('tasks').update({ priority: v }).eq('id', task.id); load() }} />
              </td>
              <td style={{ padding: '9px 8px', minWidth: 90 }} onClick={e => e.stopPropagation()}>
                <ProgressBar value={task.progress} onChange={async v => { await supabase.from('tasks').update({ progress: v }).eq('id', task.id); load() }} />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function MwSection({ title, color, accent, items, icon, sortFn, projects, todayStr, setSelectedTask, load, isMobile }) {
  const [open, setOpen] = useState(true)
  if (items.length === 0) return null
  const List = isMobile ? MwTaskCards : MwTaskTable
  return (
    <div style={{ marginBottom: 4 }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: accent, borderLeft: `4px solid ${color}`, borderBottom: '1px solid #dfe1e6', cursor: 'pointer' }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontWeight: 800, fontSize: 13, color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</span>
        <span style={{ background: color, color: '#fff', borderRadius: 10, fontSize: 11, fontWeight: 800, padding: '1px 8px' }}>{items.length}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color, opacity: 0.7 }}>{open ? '▼' : '▶'}</span>
      </div>
      {open && <List items={items} sortFn={sortFn} projects={projects} todayStr={todayStr} setSelectedTask={setSelectedTask} load={load} />}
    </div>
  )
}

// My Work — ALL tasks assigned to the current user, from every source
// (projects, email, teams, teamsmaestro, agent, ad-hoc). Full dashboard.
export default function MyWorkView({ visibleTasks, userName, projects, setSelectedTask, load }) {
  const [filter, setFilter] = useState({ status: '', priority: '', project: '', source: '' })
  const [sortBy, setSortBy] = useState('due')
  const isMobile = useIsMobile()
  const [showFilters, setShowFilters] = useState(false)
  const todayStr = new Date().toISOString().split('T')[0]
  const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7); const weekStr = weekEnd.toISOString().split('T')[0]
  const monthEnd = new Date(); monthEnd.setDate(monthEnd.getDate() + 30); const monthStr = monthEnd.toISOString().split('T')[0]

  const allMy = visibleTasks.filter(t => !t.is_group && t.assigned_to?.toLowerCase() === (userName || '').toLowerCase())
  const myTasks = allMy.filter(t => t.status !== 'done')
    .filter(t => !filter.status   || t.status   === filter.status)
    .filter(t => !filter.priority || t.priority === filter.priority)
    .filter(t => !filter.project  || t.project_id === filter.project)
    .filter(t => !filter.source   || t.source === filter.source)

  const overdue   = myTasks.filter(t => t.due_date && t.due_date < todayStr)
  const dueToday  = myTasks.filter(t => t.due_date === todayStr)
  const thisWeek  = myTasks.filter(t => t.due_date && t.due_date > todayStr && t.due_date <= weekStr)
  const thisMonth = myTasks.filter(t => t.due_date && t.due_date > weekStr  && t.due_date <= monthStr)
  const later     = myTasks.filter(t => t.due_date && t.due_date > monthStr)
  const noDate    = myTasks.filter(t => !t.due_date)

  const totalAll    = allMy.length
  const doneAll     = allMy.filter(t => t.status === 'done').length
  const overdueAll  = allMy.filter(t => t.due_date && t.due_date < todayStr && t.status !== 'done').length
  const criticalAll = allMy.filter(t => t.priority === 'critical' && t.status !== 'done').length
  const inProgAll   = allMy.filter(t => ['in_progress','on_track'].includes(t.status)).length

  const sortFn = (a, b) => {
    if (sortBy === 'due')      return (a.due_date||'9') < (b.due_date||'9') ? -1 : 1
    if (sortBy === 'priority') { const o = {critical:0,high:1,medium:2,low:3}; return (o[a.priority]??2) - (o[b.priority]??2) }
    if (sortBy === 'project')  return (a.project_id||'') < (b.project_id||'') ? -1 : 1
    return 0
  }

  const sel = { padding: '6px 10px', border: '1px solid #dfe1e6', borderRadius: 6, fontSize: 12, fontFamily: 'Nunito, sans-serif', background: '#fff', cursor: 'pointer', color: '#42526e' }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: isMobile ? 14 : 20 }}>
        <div>
          <h2 style={{ fontWeight: 800, fontSize: isMobile ? 18 : 20, color: 'var(--indigo)' }}>
            My Work — <span style={{ background: 'var(--aqua)', color: '#fff', fontSize: 16, fontWeight: 800, padding: '3px 12px', borderRadius: 12 }}>{userName || '?'}</span>
          </h2>
          <p style={{ fontSize: 13, color: '#6b778c', fontWeight: 600, marginTop: 4 }}>{myTasks.length} active · all sources</p>
        </div>
      </div>

      {/* KPI stats — across ALL my tasks including done */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: isMobile ? 6 : 12, marginBottom: isMobile ? 14 : 24 }}>
        {[
          { label: 'Total',    value: totalAll,    color: 'var(--indigo)' },
          { label: 'Done',     value: doneAll,     color: '#36b37e' },
          { label: 'Active',   value: inProgAll,   color: '#0052cc' },
          { label: 'Overdue',  value: overdueAll,  color: '#de350b' },
          { label: 'Critical', value: criticalAll, color: '#ff5630' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: '#fff', border: '1px solid #dfe1e6', borderRadius: 10, padding: isMobile ? '8px 4px' : '16px 18px', borderTop: `3px solid ${color}`, textAlign: isMobile ? 'center' : 'left', minWidth: 0 }}>
            <p style={{ fontSize: isMobile ? 9 : 11, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase', letterSpacing: isMobile ? 0 : '0.05em', marginBottom: isMobile ? 2 : 8, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</p>
            <p style={{ fontSize: isMobile ? 20 : 28, fontWeight: 800, color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filter + sort bar (phone: sort chips + a Filters button that opens the four filters) */}
      {isMobile && (() => {
        const active = [filter.status, filter.priority, filter.project, filter.source].filter(Boolean).length
        return (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button onClick={() => setShowFilters(s => !s)}
                style={{ ...sel, fontWeight: 800, padding: '8px 12px', borderColor: active ? 'var(--indigo)' : '#dfe1e6', color: active ? 'var(--indigo)' : '#42526e' }}>
                {showFilters ? '▴' : '▾'} Filters{active ? ` (${active})` : ''}
              </button>
              <div style={{ flex: 1 }} />
              {[['due','Due'],['priority','Priority'],['project','Project']].map(([k,l]) => (
                <button key={k} onClick={() => setSortBy(k)}
                  style={{ fontSize: 12, fontWeight: 700, padding: '8px 10px', borderRadius: 6, border: `1px solid ${sortBy===k?'var(--indigo)':'#dfe1e6'}`, background: sortBy===k?'var(--indigo)':'#fff', color: sortBy===k?'#fff':'#42526e', cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}>{l}</button>
              ))}
            </div>
            {showFilters && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8, padding: 10, background: '#fff', borderRadius: 8, border: '1px solid #dfe1e6' }}>
                <select value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))} style={{ ...sel, width: '100%' }}>
                  <option value="">All statuses</option>
                  {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <select value={filter.priority} onChange={e => setFilter(f => ({ ...f, priority: e.target.value }))} style={{ ...sel, width: '100%' }}>
                  <option value="">All priorities</option>
                  {PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
                <select value={filter.project} onChange={e => setFilter(f => ({ ...f, project: e.target.value }))} style={{ ...sel, width: '100%' }}>
                  <option value="">All projects</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name.substring(0,30)}</option>)}
                </select>
                <select value={filter.source} onChange={e => setFilter(f => ({ ...f, source: e.target.value }))} style={{ ...sel, width: '100%' }}>
                  <option value="">All sources</option>
                  <option value="manual">Manual</option>
                  <option value="email">Email</option>
                  <option value="teams">Teams</option>
                  <option value="teamsmaestro">TeamsMAestro</option>
                  <option value="agent">Agent</option>
                </select>
                {active > 0 && (
                  <button onClick={() => setFilter({ status:'', priority:'', project:'', source:'' })}
                    style={{ gridColumn: '1 / -1', fontSize: 13, fontWeight: 700, color: '#de350b', background: 'none', border: 'none', cursor: 'pointer', padding: '6px' }}>✕ Clear filters</button>
                )}
              </div>
            )}
          </div>
        )
      })()}
      {!isMobile && <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, padding: '12px 16px', background: '#fff', borderRadius: 8, border: '1px solid #dfe1e6', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#6b778c' }}>Filter:</span>
        <select value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))} style={sel}>
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select value={filter.priority} onChange={e => setFilter(f => ({ ...f, priority: e.target.value }))} style={sel}>
          <option value="">All priorities</option>
          {PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <select value={filter.project} onChange={e => setFilter(f => ({ ...f, project: e.target.value }))} style={sel}>
          <option value="">All projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name.substring(0,30)}</option>)}
        </select>
        <select value={filter.source} onChange={e => setFilter(f => ({ ...f, source: e.target.value }))} style={sel}>
          <option value="">All sources</option>
          <option value="manual">Manual</option>
          <option value="email">Email</option>
          <option value="teams">Teams</option>
          <option value="teamsmaestro">TeamsMAestro</option>
          <option value="agent">Agent</option>
        </select>
        {(filter.status || filter.priority || filter.project || filter.source) && (
          <button onClick={() => setFilter({ status:'', priority:'', project:'', source:'' })}
            style={{ fontSize: 12, fontWeight: 700, color: '#de350b', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px' }}>✕ clear</button>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#6b778c' }}>Sort:</span>
        {[['due','Due date'],['priority','Priority'],['project','Project']].map(([k,l]) => (
          <button key={k} onClick={() => setSortBy(k)}
            style={{ fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: `1px solid ${sortBy===k?'var(--indigo)':'#dfe1e6'}`, background: sortBy===k?'var(--indigo)':'#fff', color: sortBy===k?'#fff':'#42526e', cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}>{l}</button>
        ))}
      </div>}

      {myTasks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#6b778c' }}>
          <p style={{ fontSize: 24, marginBottom: 8 }}>🎉</p>
          <p style={{ fontSize: 16, fontWeight: 700 }}>All clear!</p>
          <p style={{ fontSize: 13, marginTop: 4 }}>No tasks match your filters</p>
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #dfe1e6', overflow: 'hidden' }}>
          <MwSection title="Overdue"     color="#de350b" accent="#fff5f5" items={overdue}   icon="🔴" sortFn={sortFn} projects={projects} todayStr={todayStr} setSelectedTask={setSelectedTask} load={load} isMobile={isMobile} />
          <MwSection title="Due today"   color="#ff8b00" accent="#fffbf0" items={dueToday}  icon="🟡" sortFn={sortFn} projects={projects} todayStr={todayStr} setSelectedTask={setSelectedTask} load={load} isMobile={isMobile} />
          <MwSection title="This week"   color="#0052cc" accent="#f0f5ff" items={thisWeek}  icon="📅" sortFn={sortFn} projects={projects} todayStr={todayStr} setSelectedTask={setSelectedTask} load={load} isMobile={isMobile} />
          <MwSection title="This month"  color="#00875a" accent="#f0faf5" items={thisMonth} icon="📆" sortFn={sortFn} projects={projects} todayStr={todayStr} setSelectedTask={setSelectedTask} load={load} isMobile={isMobile} />
          <MwSection title="Later"       color="#6554c0" accent="#f5f3ff" items={later}     icon="🔮" sortFn={sortFn} projects={projects} todayStr={todayStr} setSelectedTask={setSelectedTask} load={load} isMobile={isMobile} />
          <MwSection title="No due date" color="#6b778c" accent="#f8f9fc" items={noDate}    icon="📌" sortFn={sortFn} projects={projects} todayStr={todayStr} setSelectedTask={setSelectedTask} load={load} isMobile={isMobile} />
        </div>
      )}
    </div>
  )
}
