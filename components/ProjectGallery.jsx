import { useState, useRef } from 'react'
import { getProjectColor } from '../lib/team'
import { exportToExcel, parseImport, applyTaskImport } from '../lib/excelIO'
import OwnerAvatar from './OwnerAvatar'
import { useIsMobile } from '../lib/useIsMobile'

const PRIO_COLORS = { critical: '#de350b', high: '#ff8b00', medium: '#0052cc', low: '#6b778c' }
const PROJECT_STATUSES = ['active', 'on_hold', 'completed', 'archived']
const todayISO = () => new Date().toISOString().split('T')[0]

// Shared stats calculator — one canonical definition of "how does this project look"
function statsFor(project, visibleTasks) {
  const pTasks  = visibleTasks.filter(t => t.project_id === project.id)
  const realP   = pTasks.filter(t => !t.is_group)
  const total   = realP.length
  const done    = realP.filter(t => t.status === 'done').length
  const inProg  = realP.filter(t => ['in_progress','on_track'].includes(t.status)).length
  const overdue = realP.filter(t => t.due_date && t.due_date < todayISO() && t.status !== 'done').length
  // pct = mean of per-task progress so the bar reflects partial work in real time
  const pct     = total ? Math.round(realP.reduce((s, t) => s + (Number(t.progress) || 0), 0) / total) : 0
  return { pTasks, realP, total, done, inProg, overdue, pct }
}

function ViewTab({ id, label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
      fontFamily: 'Nunito, sans-serif',
      border: active ? '1px solid var(--indigo)' : '1px solid #dfe1e6',
      background: active ? 'var(--indigo)' : '#fff',
      color: active ? '#fff' : '#42526e',
      borderRadius: 6,
    }}>{label}</button>
  )
}

// ── CARD VIEW ─────────────────────────────────────────────────────────────
function CardsView({ projects, projectsAll, visibleTasks, setActiveProject }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 16 }}>
      {projects.map(project => {
        const i = projectsAll.findIndex(p => p.id === project.id)
        const { total, done, inProg, overdue, pct } = statsFor(project, visibleTasks)
        const color = getProjectColor(project, i >= 0 ? i : 0)
        const prioColor = PRIO_COLORS[project.priority] || '#6b778c'
        return (
          <div key={project.id} onClick={() => setActiveProject(project.id)}
            style={{ background: '#fff', borderRadius: 12, border: '1px solid #dfe1e6', overflow: 'hidden', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', transition: 'box-shadow 0.15s, transform 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.12)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)'; e.currentTarget.style.transform = 'translateY(0)' }}>
            <div style={{ height: 6, background: color }} />
            <div style={{ padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                <h3 style={{ fontWeight: 800, fontSize: 15, color: '#172b4d', lineHeight: 1.3, flex: 1, marginRight: 8 }}>{project.name}</h3>
                <span style={{ fontSize: 10, fontWeight: 700, color: prioColor, background: prioColor + '18', borderRadius: 10, padding: '2px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}>{(project.priority || 'medium').toUpperCase()}</span>
              </div>
              {project.description && (
                <p style={{ fontSize: 12, color: '#6b778c', lineHeight: 1.5, marginBottom: 14, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{project.description}</p>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                {project.owner && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <OwnerAvatar name={project.owner} />
                    <span style={{ fontSize: 12, color: '#42526e', fontWeight: 600 }}>{project.owner}</span>
                  </div>
                )}
                {project.due_date && (
                  <span style={{ fontSize: 11, color: '#6b778c', background: '#f0f1f3', borderRadius: 6, padding: '2px 8px', marginLeft: 'auto' }}>
                    Due {new Date(project.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                )}
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 11, color: '#6b778c', fontWeight: 600 }}>Progress</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color }}>{pct}%</span>
                </div>
                <div style={{ height: 6, background: '#f0f1f3', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.4s' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {[
                  { label: 'Total',   value: total,   col: '#172b4d', bg: '#f0f1f3' },
                  { label: 'Done',    value: done,    col: '#00875a', bg: '#e3fcef' },
                  { label: 'Active',  value: inProg,  col: '#0052cc', bg: '#e9f2ff' },
                  { label: 'Overdue', value: overdue, col: overdue > 0 ? '#de350b' : '#6b778c', bg: overdue > 0 ? '#ffebe6' : '#f0f1f3' },
                ].map(({ label, value, col, bg }) => (
                  <div key={label} style={{ background: bg, borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                    <p style={{ fontSize: 16, fontWeight: 800, color: col, lineHeight: 1 }}>{value}</p>
                    <p style={{ fontSize: 10, color: '#6b778c', fontWeight: 600, marginTop: 2 }}>{label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── LIST VIEW (UI #9) ─────────────────────────────────────────────────────
function ListView({ projects, projectsAll, visibleTasks, setActiveProject }) {
  const fmt = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
  return (
    <div className="scroll-x" style={{ background: '#fff', borderRadius: 10, border: '1px solid #dfe1e6' }}>
      <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f8f9fc', borderBottom: '2px solid #dfe1e6' }}>
            {['Project', 'Owner', 'Status', 'Priority', 'Start', 'Due', 'Progress', 'Overdue'].map(h =>
              <th key={h} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
            )}
          </tr>
        </thead>
        <tbody>
          {projects.map(project => {
            const i = projectsAll.findIndex(p => p.id === project.id)
            const { total, done, overdue, pct } = statsFor(project, visibleTasks)
            const color = getProjectColor(project, i >= 0 ? i : 0)
            const prioColor = PRIO_COLORS[project.priority] || '#6b778c'
            return (
              <tr key={project.id} onClick={() => setActiveProject(project.id)}
                style={{ borderBottom: '1px solid #f0f1f3', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f8f9ff'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#172b4d' }}>{project.name}</span>
                  </div>
                </td>
                <td style={{ padding: '10px 12px', fontSize: 12, color: '#42526e', fontWeight: 600 }}>{project.owner || '—'}</td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#42526e', background: '#f0f1f3', borderRadius: 4, padding: '2px 8px' }}>{project.status || 'active'}</span>
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: prioColor, background: prioColor + '18', borderRadius: 10, padding: '2px 8px', textTransform: 'uppercase' }}>{project.priority || 'medium'}</span>
                </td>
                <td style={{ padding: '10px 12px', fontSize: 12, color: '#42526e' }}>{fmt(project.start_date)}</td>
                <td style={{ padding: '10px 12px', fontSize: 12, color: '#42526e' }}>{fmt(project.due_date)}</td>
                <td style={{ padding: '10px 12px', minWidth: 160 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 6, background: '#f0f1f3', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 36, textAlign: 'right' }}>{pct}%</span>
                    <span style={{ fontSize: 10, color: '#6b778c', minWidth: 40 }}>{done}/{total}</span>
                  </div>
                </td>
                <td style={{ padding: '10px 12px', fontSize: 12, fontWeight: 700, color: overdue > 0 ? '#de350b' : '#6b778c' }}>{overdue}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── GANTT VIEW (UI #11) ───────────────────────────────────────────────────
function GanttView({ projects, projectsAll, setActiveProject }) {
  const isMobile = useIsMobile()
  const datedProjects = projects.filter(p => p.start_date && p.due_date)
  if (datedProjects.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#6b778c', background: '#fff', border: '1px solid #dfe1e6', borderRadius: 10 }}>
      No projects with both start and end dates to display on the timeline.
    </div>
  }
  const allDates = datedProjects.flatMap(p => [p.start_date, p.due_date]).map(d => new Date(d))
  const minDate = new Date(Math.min(...allDates))
  const maxDate = new Date(Math.max(...allDates))
  minDate.setDate(minDate.getDate() - 7); maxDate.setDate(maxDate.getDate() + 14)
  const totalDays = Math.max(Math.ceil((maxDate - minDate) / 86400000), 30)
  // Minimum 8 px/day so the chart doesn't squash below readability. Horizontal
  // scroll is preferred to an unreadable chart.
  const dayW = Math.max(8, Math.min(24, 2000 / totalDays))
  const labelW = isMobile ? 120 : 220
  const today = new Date()
  const todayPos = Math.ceil((today - minDate) / 86400000) * dayW
  // Label cadence adapts to week spacing: 1/2/4 weeks between text labels.
  const weekPx = 7 * dayW
  const labelEveryN = weekPx >= 90 ? 1 : weekPx >= 55 ? 2 : 4
  const weeks = []; let cur = new Date(minDate), wi = 0
  while (cur <= maxDate) {
    weeks.push({ date: new Date(cur), label: wi % labelEveryN === 0 })
    cur.setDate(cur.getDate() + 7); wi++
  }
  return (
    <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #dfe1e6', borderRadius: 10 }}>
      <div style={{ minWidth: labelW + totalDays * dayW + 20 }}>
        <div style={{ display: 'flex', background: '#f8f9fc', borderBottom: '2px solid #dfe1e6', position: 'sticky', top: 0, zIndex: 5 }}>
          <div style={{ width: labelW, flexShrink: 0, padding: '8px 12px', fontSize: 11, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase', borderRight: '1px solid #dfe1e6' }}>Project</div>
          <div style={{ flex: 1, position: 'relative', height: 34 }}>
            {weeks.map((w, i) => (
              <div key={`g-${i}`} style={{ position: 'absolute', left: Math.ceil((w.date - minDate) / 86400000) * dayW, top: 0, bottom: 0, borderLeft: '1px solid #e5e7eb' }} />
            ))}
            {weeks.filter(w => w.label).map((w, i) => (
              <div key={`t-${i}`} style={{ position: 'absolute', left: Math.ceil((w.date - minDate) / 86400000) * dayW + 4, top: 10, fontSize: 10, fontWeight: 700, color: '#6b778c', whiteSpace: 'nowrap' }}>
                {w.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </div>
            ))}
          </div>
        </div>
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', left: labelW + todayPos, top: 0, bottom: 0, width: 2, background: '#de350b', zIndex: 4, pointerEvents: 'none' }} />
          {datedProjects.map(project => {
            const i = projectsAll.findIndex(p => p.id === project.id)
            const color = getProjectColor(project, i >= 0 ? i : 0)
            const start = Math.ceil((new Date(project.start_date) - minDate) / 86400000) * dayW
            const end = Math.ceil((new Date(project.due_date) - minDate) / 86400000) * dayW + dayW
            const barW = Math.max(end - start, dayW)
            return (
              <div key={project.id} onClick={() => setActiveProject(project.id)}
                style={{ display: 'flex', borderBottom: '1px solid #f0f1f3', minHeight: 34, cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f8f9ff'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{ width: labelW, flexShrink: 0, padding: '7px 12px', borderRight: '1px solid #f0f1f3', fontSize: 12, color: '#172b4d', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</div>
                <div style={{ flex: 1, position: 'relative' }}>
                  <div style={{ position: 'absolute', left: start, top: 6, height: 20, width: barW, background: color, borderRadius: 4, opacity: 0.85, display: 'flex', alignItems: 'center', paddingLeft: 6, overflow: 'hidden' }}>
                    <span style={{ fontSize: 10, color: '#fff', fontWeight: 700, whiteSpace: 'nowrap' }}>{project.name}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── DASHBOARD VIEW (UI #12) ───────────────────────────────────────────────
function DashboardView({ projects, visibleTasks }) {
  const isMobile = useIsMobile()
  const today = todayISO()
  const tasksAll = visibleTasks.filter(t => !t.is_group)
  const totalTasks = tasksAll.length
  const doneTasks  = tasksAll.filter(t => t.status === 'done').length
  const liveTasks  = tasksAll.filter(t => ['in_progress','on_track'].includes(t.status)).length
  const lateTasks  = tasksAll.filter(t => t.due_date && t.due_date < today && t.status !== 'done').length
  const blockedTasks = tasksAll.filter(t => ['blocked','at_risk'].includes(t.status)).length
  const globalPct  = totalTasks ? Math.round(doneTasks / totalTasks * 100) : 0

  const projectRows = projects.map(p => {
    const s = (() => {
      const pTasks = visibleTasks.filter(t => t.project_id === p.id && !t.is_group)
      const tot = pTasks.length
      const d = pTasks.filter(t => t.status === 'done').length
      const ov = pTasks.filter(t => t.due_date && t.due_date < today && t.status !== 'done').length
      const pct = tot ? Math.round(pTasks.reduce((sum, t) => sum + (Number(t.progress) || 0), 0) / tot) : 0
      return { total: tot, done: d, overdue: ov, pct }
    })()
    return { project: p, ...s }
  })

  const Stat = ({ label, value, color, bg, sub }) => (
    <div style={{ background: '#fff', borderRadius: 10, padding: isMobile ? '12px 14px' : '18px 22px', border: '1px solid #dfe1e6', borderTop: `3px solid ${color}`, flex: 1, minWidth: 0 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{label}</p>
      <p style={{ fontSize: isMobile ? 24 : 30, fontWeight: 800, color, marginBottom: 2 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: '#6b778c' }}>{sub}</p>}
    </div>
  )

  return (
    <div>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(5, 1fr)', gap: isMobile ? 8 : 12, marginBottom: 20 }}>
        <Stat label="Total tasks"     value={totalTasks}    color="var(--indigo)" sub={`${projects.length} projects`} />
        <Stat label="Done"            value={doneTasks}     color="#36b37e"       sub={`${globalPct}% complete`} />
        <Stat label="Live"            value={liveTasks}     color="#0052cc"       sub="active" />
        <Stat label="Late"            value={lateTasks}     color="#de350b"       sub="past due" />
        <Stat label="Blocked/at-risk" value={blockedTasks}  color="#ff8b00"       sub="needs attention" />
      </div>

      {/* Overall progress */}
      <div style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', border: '1px solid #dfe1e6', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <p style={{ fontWeight: 800, fontSize: 14, color: '#172b4d' }}>Overall progress across all projects</p>
          <p style={{ fontWeight: 800, fontSize: 14, color: 'var(--indigo)' }}>{globalPct}%</p>
        </div>
        <div style={{ height: 12, background: '#f0f1f3', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ width: `${globalPct}%`, height: '100%', background: 'var(--indigo)', borderRadius: 6, transition: 'width 0.5s' }} />
        </div>
      </div>

      {/* Per-project progress summary */}
      <div className="scroll-x" style={{ background: '#fff', borderRadius: 10, border: '1px solid #dfe1e6' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0f1f3' }}>
          <p style={{ fontWeight: 800, fontSize: 14, color: '#172b4d' }}>Progress by project</p>
        </div>
        <table style={{ width: '100%', minWidth: 520, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f8f9fc', borderBottom: '1px solid #dfe1e6' }}>
              {['Project','Tasks','Done','Overdue','Progress'].map(h =>
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase' }}>{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {projectRows.map(({ project, total, done, overdue, pct }) => {
              const i = projects.findIndex(p => p.id === project.id)
              const color = getProjectColor(project, i >= 0 ? i : 0)
              return (
                <tr key={project.id} style={{ borderBottom: '1px solid #f0f1f3' }}>
                  <td style={{ padding: '9px 12px', fontSize: 13, fontWeight: 600, color: '#172b4d' }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: color, marginRight: 8 }} />
                    {project.name}
                  </td>
                  <td style={{ padding: '9px 12px', fontSize: 13, color: '#42526e' }}>{total}</td>
                  <td style={{ padding: '9px 12px', fontSize: 13, color: '#00875a', fontWeight: 700 }}>{done}</td>
                  <td style={{ padding: '9px 12px', fontSize: 13, color: overdue > 0 ? '#de350b' : '#6b778c', fontWeight: 700 }}>{overdue}</td>
                  <td style={{ padding: '9px 12px', minWidth: 180 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 6, background: '#f0f1f3', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 36, textAlign: 'right' }}>{pct}%</span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── MAIN GALLERY ──────────────────────────────────────────────────────────
export default function ProjectGallery({ projects, visibleTasks, allTasks, setActiveProject, setShowAddProject, onUpdate }) {
  const [view, setView] = useState('cards')
  const [sortBy, setSortBy] = useState('name')           // name | start_date | due_date | status
  const [statusFilter, setStatusFilter] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState(null)
  const fileInputRef = useRef(null)

  const handleExport = async () => {
    try {
      await exportToExcel({ projects, tasks: allTasks || visibleTasks })
    } catch (e) { alert('Export failed: ' + e.message) }
  }
  const handleImportChange = async (ev) => {
    const file = ev.target.files?.[0]
    if (file) { await doImport(file) }
    ev.target.value = ''
  }
  const doImport = async (file) => {
    setImporting(true); setImportMsg(null)
    try {
      const { validRows, skipped, totalRows } = await parseImport(file)
      if (validRows.length === 0) {
        setImportMsg({ kind: 'warn', text: `Parsed ${totalRows} row(s) from ${file.name} — 0 had a valid id column to match. No updates applied.` })
        return
      }
      const ok = window.confirm(`Apply ${validRows.length} task updates from ${file.name}?\nAllowed fields: title, assigned_to, start_date, due_date.\n${skipped} row(s) skipped (missing id).`)
      if (!ok) { setImportMsg({ kind: 'info', text: 'Import cancelled.' }); return }
      const { updated, failed, errors } = await applyTaskImport(validRows)
      setImportMsg({
        kind: failed ? 'warn' : 'ok',
        text: `${updated} task(s) updated, ${failed} failed${failed ? ' — ' + errors.slice(0,3).map(e=>`${e.id.slice(0,8)}: ${e.message}`).join('; ') : ''}.`,
      })
      if (updated > 0 && onUpdate) onUpdate()
    } catch (e) {
      setImportMsg({ kind: 'err', text: 'Import failed: ' + e.message })
    } finally { setImporting(false) }
  }

  // Filter + sort (applies to Cards, List, Gantt; Dashboard uses all projects)
  const filtered = projects.filter(p => !statusFilter || p.status === statusFilter)
  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortBy], bv = b[sortBy]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return String(av).localeCompare(String(bv))
  })

  const selStyle = { padding: '5px 10px', border: '1px solid #dfe1e6', borderRadius: 6, fontSize: 12, fontFamily: 'Nunito, sans-serif', background: '#fff', cursor: 'pointer', color: '#42526e' }

  return (
    <>
      {/* Header: title + new project button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ fontWeight: 800, fontSize: 20, color: 'var(--indigo)' }}>All Projects</h2>
          <p style={{ fontSize: 13, color: '#6b778c', fontWeight: 600, marginTop: 2 }}>
            {filtered.length} of {projects.length} project{projects.length !== 1 ? 's' : ''}
            {statusFilter && ` · ${statusFilter}`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={handleExport} title="Download all projects and tasks as an .xlsx file"
            style={{ background: '#fff', color: '#42526e', border: '1px solid #dfe1e6', borderRadius: 6, padding: '7px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}>📤 Export</button>
          <button onClick={() => fileInputRef.current?.click()} disabled={importing}
            title="Upload an edited export to bulk-update task titles, assignees, start and due dates"
            style={{ background: '#fff', color: '#42526e', border: '1px solid #dfe1e6', borderRadius: 6, padding: '7px 12px', fontWeight: 700, fontSize: 12, cursor: importing ? 'wait' : 'pointer', fontFamily: 'Nunito, sans-serif', opacity: importing ? 0.6 : 1 }}>
            {importing ? 'Importing…' : '📥 Import'}
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleImportChange} style={{ display: 'none' }} />
          <button onClick={() => setShowAddProject(true)}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}>+ New Project</button>
        </div>
      </div>
      {importMsg && (
        <div style={{ marginBottom: 14, padding: '8px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
          background: importMsg.kind === 'ok' ? '#e3fcef' : importMsg.kind === 'err' ? '#ffebe6' : '#fff3e0',
          color: importMsg.kind === 'ok' ? '#00875a' : importMsg.kind === 'err' ? '#de350b' : '#b85c00' }}>
          {importMsg.text}
          <button onClick={() => setImportMsg(null)} style={{ marginLeft: 10, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>×</button>
        </div>
      )}

      {/* Controls: view tabs + sort + filter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <ViewTab id="cards"     label="📇 Cards"     active={view==='cards'}     onClick={() => setView('cards')} />
          <ViewTab id="list"      label="☰ List"       active={view==='list'}      onClick={() => setView('list')} />
          <ViewTab id="gantt"     label="▬ Timeline"   active={view==='gantt'}     onClick={() => setView('gantt')} />
          <ViewTab id="dashboard" label="◉ Dashboard"  active={view==='dashboard'} onClick={() => setView('dashboard')} />
        </div>
        <div style={{ flex: 1 }} />
        {view !== 'dashboard' && (
          <>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#6b778c' }}>Sort:</span>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={selStyle}>
              <option value="name">Name</option>
              <option value="start_date">Start date</option>
              <option value="due_date">Due date</option>
              <option value="status">Status</option>
            </select>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#6b778c' }}>Status:</span>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selStyle}>
              <option value="">All</option>
              {PROJECT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {statusFilter && (
              <button onClick={() => setStatusFilter('')}
                style={{ fontSize: 12, fontWeight: 700, color: '#de350b', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px' }}>✕ clear</button>
            )}
          </>
        )}
      </div>

      {/* Empty state (only applies to cards/list/gantt when there are genuinely 0 matching) */}
      {projects.length === 0 && view !== 'dashboard' ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#6b778c' }}>
          <p style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>No projects yet</p>
          <p style={{ marginBottom: 20 }}>Create your first project to get started</p>
          <button onClick={() => setShowAddProject(true)} style={{ background: 'var(--indigo)', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 24px', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}>+ Create Project</button>
        </div>
      ) : (
        <>
          {view === 'cards'     && <CardsView     projects={sorted} projectsAll={projects} visibleTasks={visibleTasks} setActiveProject={setActiveProject} />}
          {view === 'list'      && <ListView      projects={sorted} projectsAll={projects} visibleTasks={visibleTasks} setActiveProject={setActiveProject} />}
          {view === 'gantt'     && <GanttView     projects={sorted} projectsAll={projects} setActiveProject={setActiveProject} />}
          {view === 'dashboard' && <DashboardView projects={projects}                                visibleTasks={visibleTasks} />}
        </>
      )}
    </>
  )
}
