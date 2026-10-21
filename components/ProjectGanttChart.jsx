import { useState } from 'react'
import { STATUSES, statusMap } from '../lib/constants'
import { TEAM } from '../lib/team'
import OwnerAvatar from './OwnerAvatar'
import { useIsMobile } from '../lib/useIsMobile'

// Project-level Gantt with filters and dependency arrows.
// Expects: tasks (filtered to this project already), onSelectTask, projectColor.
export default function ProjectGanttChart({ tasks, onSelectTask }) {
  const isMobile = useIsMobile()
  const [filterAssignee, setFilterAssignee] = useState('')
  const [filterStatus,   setFilterStatus]   = useState('')
  const [showDeps,       setShowDeps]       = useState(true)
  const [depsOnly,       setDepsOnly]       = useState(false)  // show only tasks that have or are a dependency

  // Base set: real tasks (not groups) with dates
  let rows = tasks.filter(t => !t.is_group && t.start_date && t.due_date)

  if (filterAssignee) rows = rows.filter(t => (t.assigned_to || '').toLowerCase() === filterAssignee.toLowerCase())
  if (filterStatus)   rows = rows.filter(t => t.status === filterStatus)
  if (depsOnly) {
    const linkedIds = new Set()
    for (const t of tasks) {
      if (t.depends_on) { linkedIds.add(t.id); linkedIds.add(t.depends_on) }
    }
    rows = rows.filter(t => linkedIds.has(t.id))
  }

  const selStyle = { padding: '5px 10px', border: '1px solid #dfe1e6', borderRadius: 6, fontSize: 12, fontFamily: 'Nunito, sans-serif', background: '#fff', cursor: 'pointer', color: '#42526e' }
  const toggleStyle = (on) => ({ ...selStyle, background: on ? 'var(--indigo)' : '#fff', color: on ? '#fff' : '#42526e', borderColor: on ? 'var(--indigo)' : '#dfe1e6' })

  if (rows.length === 0) {
    return (
      <>
        <FilterBar
          filterAssignee={filterAssignee} setFilterAssignee={setFilterAssignee}
          filterStatus={filterStatus} setFilterStatus={setFilterStatus}
          showDeps={showDeps} setShowDeps={setShowDeps}
          depsOnly={depsOnly} setDepsOnly={setDepsOnly}
          selStyle={selStyle} toggleStyle={toggleStyle} />
        <div style={{ padding: 40, textAlign: 'center', color: '#6b778c' }}>
          No tasks with both start and end dates match the current filters.
        </div>
      </>
    )
  }

  // Layout
  const allDates = rows.flatMap(t => [t.start_date, t.due_date]).map(d => new Date(d))
  const minDate = new Date(Math.min(...allDates))
  const maxDate = new Date(Math.max(...allDates))
  minDate.setDate(minDate.getDate() - 3); maxDate.setDate(maxDate.getDate() + 7)
  const totalDays = Math.max(Math.ceil((maxDate - minDate) / 86400000), 14)
  // Minimum 18px/day so weekly labels always have >= 126px of breathing room —
  // well above the ~46px needed for "20 Apr 2026" style formatting.
  const dayW  = Math.max(18, Math.min(40, 1100 / totalDays))
  const labelW = isMobile ? 130 : 240
  const rowH   = 34
  const barTop = 7
  const barH   = 20
  const today = new Date()
  const todayPos = Math.ceil((today - minDate) / 86400000) * dayW
  // Pick a label cadence that guarantees readable spacing at any zoom.
  const weekPx = 7 * dayW
  const labelEveryN = weekPx >= 90 ? 1 : weekPx >= 55 ? 2 : 4
  const weeks = []; let cur = new Date(minDate), wi = 0
  while (cur <= maxDate) {
    weeks.push({ date: new Date(cur), label: wi % labelEveryN === 0 })
    cur.setDate(cur.getDate() + 7); wi++
  }

  const xStart = (d) => Math.ceil((new Date(d) - minDate) / 86400000) * dayW
  const xEnd   = (d) => Math.ceil((new Date(d) - minDate) / 86400000) * dayW + dayW

  // Index rows by id for quick lookup (dependency wiring)
  const idxById = new Map(rows.map((t, i) => [t.id, i]))
  const chartHeight = rows.length * rowH
  const chartWidth  = totalDays * dayW

  // Dependency arrows — simple L-shaped path from predecessor end to dependent start
  const arrows = []
  if (showDeps) {
    for (const dep of rows) {
      if (!dep.depends_on) continue
      const predIdx = idxById.get(dep.depends_on)
      if (predIdx == null) continue
      const pred = rows[predIdx]
      const depIdx = idxById.get(dep.id)
      const x1 = xEnd(pred.due_date)
      const y1 = predIdx * rowH + barTop + barH / 2
      const x2 = xStart(dep.start_date)
      const y2 = depIdx * rowH + barTop + barH / 2
      const blocking = pred.status !== 'done'
      arrows.push({ id: `${pred.id}->${dep.id}`, x1, y1, x2, y2, blocking })
    }
  }

  return (
    <>
      <FilterBar
        filterAssignee={filterAssignee} setFilterAssignee={setFilterAssignee}
        filterStatus={filterStatus} setFilterStatus={setFilterStatus}
        showDeps={showDeps} setShowDeps={setShowDeps}
        depsOnly={depsOnly} setDepsOnly={setDepsOnly}
        selStyle={selStyle} toggleStyle={toggleStyle} />
      <div style={{ overflowX: 'auto', marginTop: 12, border: '1px solid #dfe1e6', borderRadius: 8 }}>
        <div style={{ minWidth: labelW + chartWidth + 20 }}>
          {/* Header: week labels — gridlines at every week, text labels only
              at cadence that fits the available pixel width */}
          <div style={{ display: 'flex', background: '#f8f9fc', borderBottom: '2px solid #dfe1e6', position: 'sticky', top: 0, zIndex: 5 }}>
            <div style={{ width: labelW, flexShrink: 0, padding: '8px 12px', fontSize: 11, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase', borderRight: '1px solid #dfe1e6' }}>Task</div>
            <div style={{ flex: 1, position: 'relative', height: 36 }}>
              {weeks.map((w, i) => (
                <div key={i} style={{ position: 'absolute', left: Math.ceil((w.date - minDate) / 86400000) * dayW, top: 0, bottom: 0, borderLeft: '1px solid #e5e7eb' }} />
              ))}
              {weeks.filter(w => w.label).map((w, i) => (
                <div key={`t-${i}`} style={{ position: 'absolute', left: Math.ceil((w.date - minDate) / 86400000) * dayW + 4, top: 10, fontSize: 10, fontWeight: 700, color: '#6b778c', whiteSpace: 'nowrap' }}>
                  {w.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </div>
              ))}
            </div>
          </div>

          {/* Body: labels + bars + arrow overlay */}
          <div style={{ position: 'relative', height: chartHeight }}>
            {/* Labels column */}
            <div style={{ position: 'absolute', top: 0, left: 0, width: labelW, bottom: 0, borderRight: '1px solid #f0f1f3' }}>
              {rows.map((task, i) => (
                <div key={task.id} style={{ height: rowH, padding: '7px 12px', fontSize: 12, color: '#172b4d', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid #f0f1f3' }}>
                  <OwnerAvatar name={task.assigned_to} />
                  <span title={task.title} style={{ cursor: onSelectTask ? 'pointer' : 'default' }}
                    onClick={() => onSelectTask && onSelectTask(task)}>
                    {task.title}
                  </span>
                </div>
              ))}
            </div>

            {/* Bars column */}
            <div style={{ position: 'absolute', top: 0, left: labelW, right: 0, bottom: 0, width: chartWidth }}>
              {/* Today marker */}
              {todayPos >= 0 && todayPos <= chartWidth && (
                <div style={{ position: 'absolute', left: todayPos, top: 0, bottom: 0, width: 2, background: '#de350b', zIndex: 3, pointerEvents: 'none' }} />
              )}
              {/* Bars */}
              {rows.map((task, i) => {
                const s = statusMap[task.status] || STATUSES[0]
                const x = xStart(task.start_date)
                const w = Math.max(xEnd(task.due_date) - x, dayW)
                const y = i * rowH + barTop
                return (
                  <div key={task.id}
                    onClick={() => onSelectTask && onSelectTask(task)}
                    style={{ position: 'absolute', left: x, top: y, height: barH, width: w, background: s.color, borderRadius: 4, opacity: 0.85, display: 'flex', alignItems: 'center', paddingLeft: 6, overflow: 'hidden', cursor: onSelectTask ? 'pointer' : 'default', zIndex: 2 }}
                    title={`${task.title} — ${s.label}`}>
                    <span style={{ fontSize: 10, color: '#fff', fontWeight: 700, whiteSpace: 'nowrap' }}>{task.title}</span>
                  </div>
                )
              })}
              {/* Row dividers */}
              {rows.map((_, i) => (
                <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: (i + 1) * rowH - 1, height: 1, background: '#f0f1f3' }} />
              ))}
              {/* Dependency arrows overlay */}
              {showDeps && arrows.length > 0 && (
                <svg style={{ position: 'absolute', top: 0, left: 0, width: chartWidth, height: chartHeight, pointerEvents: 'none', zIndex: 4 }}>
                  <defs>
                    <marker id="arr-ok" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
                      <path d="M0,0 L0,8 L7,4 z" fill="#6b778c" />
                    </marker>
                    <marker id="arr-block" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
                      <path d="M0,0 L0,8 L7,4 z" fill="#de350b" />
                    </marker>
                  </defs>
                  {arrows.map(a => {
                    const midX = Math.max(a.x1 + 8, a.x2 - 8)
                    const path = `M ${a.x1} ${a.y1} L ${midX} ${a.y1} L ${midX} ${a.y2} L ${a.x2 - 2} ${a.y2}`
                    return (
                      <path key={a.id} d={path}
                        stroke={a.blocking ? '#de350b' : '#6b778c'}
                        strokeWidth={a.blocking ? 2 : 1.5}
                        fill="none"
                        strokeDasharray={a.blocking ? '4 3' : '0'}
                        markerEnd={`url(#${a.blocking ? 'arr-block' : 'arr-ok'})`} />
                    )
                  })}
                </svg>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function FilterBar({ filterAssignee, setFilterAssignee, filterStatus, setFilterStatus, showDeps, setShowDeps, depsOnly, setDepsOnly, selStyle, toggleStyle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0 0 0', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#6b778c' }}>Filter:</span>
      <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} style={selStyle}>
        <option value="">All assignees</option>
        {TEAM.map(m => <option key={m.email} value={m.name}>{m.name}</option>)}
      </select>
      <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={selStyle}>
        <option value="">All statuses</option>
        {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      <button onClick={() => setDepsOnly(v => !v)} style={toggleStyle(depsOnly)}>Only linked</button>
      <button onClick={() => setShowDeps(v => !v)} style={toggleStyle(showDeps)}>Show dependency arrows</button>
      {(filterAssignee || filterStatus || depsOnly) && (
        <button onClick={() => { setFilterAssignee(''); setFilterStatus(''); setDepsOnly(false) }}
          style={{ fontSize: 12, fontWeight: 700, color: '#de350b', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px' }}>✕ clear</button>
      )}
    </div>
  )
}
