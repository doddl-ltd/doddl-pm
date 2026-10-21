import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getProjectColor, TEAM } from '../lib/team'
import { PROJ_COL_WIDTHS as W_DEFAULT, TASK_COL_MAX } from '../lib/constants'
import ProjectGroup from './ProjectGroup'
import ProjectTableRow from './ProjectTableRow'
import ProjectDashboard from './ProjectDashboard'
import KanbanBoard from './KanbanBoard'
import ProjectGanttChart from './ProjectGanttChart'
import { useIsMobile } from '../lib/useIsMobile'

const WIDTHS_STORAGE_KEY = 'doddl-pm-project-col-widths'
const MIN_W = { select: 28, owner: 60, status: 70, timeline: 110, effort: 40, priority: 60, progress: 80 }
const MAX_W = { select: 28, owner: 200, status: 200, timeline: 340, effort: 100, priority: 160, progress: 300 }

// Project-level statuses (DB check constraint: active/on_hold/completed/archived).
// UI surfaces the three the user works with day-to-day; archived is managed elsewhere.
export const PROJECT_STATUSES = [
  { key: 'active',    label: 'Active' },
  { key: 'on_hold',   label: 'On Hold' },
  { key: 'completed', label: 'Complete' },
]
const projectStatusLabel = (k) => PROJECT_STATUSES.find(s => s.key === k)?.label || (k ? k.replace('_', ' ') : '')

export default function ProjectSection({ project, tasks, allTasks, taskGroups, onUpdate, onPatch, onDelete, onDeleteGroup, onAddTask, onAddSubtask, onSelect, colorIndex, projects, user }) {
  const [projectTab, setProjectTab] = useState('table')
  const isMobile = useIsMobile()
  const [addingGroup, setAddingGroup] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [groupingSel, setGroupingSel] = useState(false)
  const [selGroupName, setSelGroupName] = useState('')
  // UI #5 — user-draggable column widths, persisted to localStorage
  const [W, setW] = useState(W_DEFAULT)
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(WIDTHS_STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw)
        setW(cur => ({ ...cur, ...saved }))
      }
    } catch { /* ignore */ }
  }, [])
  const drag = useRef(null)   // { col, startX, startW }
  useEffect(() => {
    const onMove = (e) => {
      if (!drag.current) return
      const { col, startX, startW } = drag.current
      const delta = e.clientX - startX
      const next = Math.min(MAX_W[col], Math.max(MIN_W[col], startW + delta))
      setW(cur => ({ ...cur, [col]: next }))
    }
    const onUp = () => {
      if (!drag.current) return
      drag.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      // Persist once at drag-end (avoids writing every pixel during drag)
      setW(cur => {
        try { window.localStorage.setItem(WIDTHS_STORAGE_KEY, JSON.stringify(cur)) } catch { /* ignore */ }
        return cur
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])
  const startDragCol = (col) => (e) => {
    e.preventDefault(); e.stopPropagation()
    drag.current = { col, startX: e.clientX, startW: W[col] }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }
  const color = getProjectColor(project, colorIndex)

  // Header edit mode — pencil icon in the header reveals inputs for
  // name/owner/due/status/description and a Save/Cancel pair. Save writes
  // directly to `projects` via the live UI path (Hard Rule 2) and calls
  // onUpdate() so parent state reloads.
  const [editingHeader, setEditingHeader] = useState(false)
  const [headerHover, setHeaderHover]     = useState(false)
  const [savingHeader, setSavingHeader]   = useState(false)
  const [editForm, setEditForm]           = useState({
    name: project.name || '',
    owner: project.owner || '',
    due_date: project.due_date ? project.due_date.slice(0, 10) : '',
    status: project.status || 'active',
    description: project.description || '',
  })
  // Re-seed the edit form whenever a fresh project prop arrives (e.g. after
  // another save) or when we enter edit mode, so inputs show the latest values.
  useEffect(() => {
    if (!editingHeader) {
      setEditForm({
        name: project.name || '',
        owner: project.owner || '',
        due_date: project.due_date ? project.due_date.slice(0, 10) : '',
        status: project.status || 'active',
        description: project.description || '',
      })
    }
  }, [project.id, project.name, project.owner, project.due_date, project.status, project.description, editingHeader])

  const startEdit  = () => setEditingHeader(true)
  const cancelEdit = () => {
    setEditForm({
      name: project.name || '',
      owner: project.owner || '',
      due_date: project.due_date ? project.due_date.slice(0, 10) : '',
      status: project.status || 'active',
      description: project.description || '',
    })
    setEditingHeader(false)
  }
  const saveEdit = async () => {
    if (!editForm.name.trim()) return
    setSavingHeader(true)
    const patch = {
      name: editForm.name.trim(),
      owner: editForm.owner || null,
      due_date: editForm.due_date || null,
      status: editForm.status || 'active',
      description: editForm.description || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('projects').update(patch).eq('id', project.id)
    setSavingHeader(false)
    if (error) { console.error('project update failed', error); alert('Could not save project: ' + error.message); return }
    setEditingHeader(false)
    onUpdate()
  }

  const onToggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const clearSel = () => setSelectedIds(new Set())
  // Groups come from the task_groups table (populated by seeds / migrations and
  // by saveGroup/groupSelected below). Filtered + sorted here so child components
  // get a ready-to-render list.
  const groups = (taskGroups || []).filter(g => g.project_id === project.id)
    .sort((a, b) => (a.position || 0) - (b.position || 0))

  const groupSelected = async () => {
    const name = selGroupName.trim() || `Group of ${selectedIds.size}`
    const maxPos = groups.reduce((m, g) => Math.max(m, g.position || 0), 0)
    const { data: newGroup, error } = await supabase.from('task_groups').insert([{
      name, project_id: project.id, position: maxPos + 1,
    }]).select().single()
    if (error || !newGroup) { console.error('group create failed', error); return }
    const ids = Array.from(selectedIds)
    await supabase.from('tasks').update({ group_id: newGroup.id }).in('id', ids)
    setSelGroupName(''); setGroupingSel(false); clearSel(); onUpdate()
  }
  const realTasks = tasks.filter(t => !t.is_group)
  const totalTasks = realTasks.length
  const doneTasks = realTasks.filter(t => t.status === 'done').length
  // Project-level progress = mean of per-task progress, so the bar moves on
  // every progress change (not just status=done transitions). patchTask in
  // pages/index.js updates task.progress optimistically, so this rerenders
  // in the same React tick as the slider change.
  const pct = totalTasks
    ? Math.round(realTasks.reduce((sum, t) => sum + (Number(t.progress) || 0), 0) / totalTasks)
    : 0

  // Tasks with no group_id land in the ungrouped bucket (rendered after all
  // groups). Legacy `is_group` / `parent_id` tasks are ignored — that mechanism
  // is superseded by task_groups.
  const ungroupedTasks = tasks.filter(t => !t.is_group && !t.parent_id && !t.group_id)

  const saveGroup = async () => {
    if (!groupName.trim()) return
    const maxPos = groups.reduce((m, g) => Math.max(m, g.position || 0), 0)
    await supabase.from('task_groups').insert([{
      name: groupName.trim(), project_id: project.id, position: maxPos + 1,
    }])
    setGroupName(''); setAddingGroup(false); onUpdate()
  }

  const TAB = ({ id, label, icon }) => (
    <button onClick={() => setProjectTab(id)} style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: isMobile ? '11px 10px' : '8px 14px', border: 'none', background: 'none', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
      fontFamily: 'Nunito, sans-serif', fontWeight: 600, fontSize: 13, borderBottom: projectTab === id ? `3px solid ${color}` : '3px solid transparent',
      color: projectTab === id ? color : '#6b778c', marginBottom: -1
    }}>{icon} {label}</button>
  )

  return (
    <div style={{ marginBottom: isMobile ? 16 : 40, background: '#fff', borderRadius: 12, border: '1px solid #dfe1e6', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      {/* Project header — solid doddl brand colour. Hover reveals a pencil to
          switch into an inline edit mode; Save persists to Supabase, Cancel
          reverts to the last saved values. */}
      <div
        onMouseEnter={() => setHeaderHover(true)}
        onMouseLeave={() => setHeaderHover(false)}
        style={{ position: 'relative', padding: isMobile ? '12px 14px' : '14px 20px', background: color, display: 'flex', alignItems: editingHeader ? 'flex-start' : 'center', gap: isMobile ? 10 : 12, flexWrap: isMobile ? 'wrap' : 'nowrap' }}
      >
        {editingHeader ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              autoFocus
              value={editForm.name}
              onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Project name"
              style={{ padding: '7px 10px', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 6, background: 'rgba(255,255,255,0.95)', color: '#172b4d', fontWeight: 800, fontSize: 16, fontFamily: 'Nunito, sans-serif', outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select
                value={editForm.owner}
                onChange={e => setEditForm(f => ({ ...f, owner: e.target.value }))}
                style={{ padding: '6px 8px', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 6, background: 'rgba(255,255,255,0.95)', color: '#172b4d', fontWeight: 700, fontSize: 12, fontFamily: 'Nunito, sans-serif', outline: 'none' }}
              >
                <option value="">Owner…</option>
                {TEAM.map(m => <option key={m.email} value={m.name}>{m.name}</option>)}
              </select>
              <input
                type="date"
                value={editForm.due_date}
                onChange={e => setEditForm(f => ({ ...f, due_date: e.target.value }))}
                style={{ padding: '6px 8px', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 6, background: 'rgba(255,255,255,0.95)', color: '#172b4d', fontWeight: 600, fontSize: 12, fontFamily: 'Nunito, sans-serif', outline: 'none' }}
              />
              <select
                value={editForm.status}
                onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}
                style={{ padding: '6px 8px', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 6, background: 'rgba(255,255,255,0.95)', color: '#172b4d', fontWeight: 700, fontSize: 12, fontFamily: 'Nunito, sans-serif', outline: 'none' }}
              >
                {PROJECT_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <textarea
              value={editForm.description}
              onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Description"
              rows={2}
              style={{ padding: '7px 10px', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 6, background: 'rgba(255,255,255,0.95)', color: '#172b4d', fontSize: 13, fontFamily: 'Nunito, sans-serif', resize: 'vertical', outline: 'none' }}
            />
          </div>
        ) : (
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 800, fontSize: 16, color: '#fff' }}>{project.name}</span>
              {project.owner && (
                <span style={{ display: 'inline-flex', alignItems: 'center', background: 'rgba(255,255,255,0.25)', color: '#fff', fontWeight: 700, fontSize: 11, padding: '3px 10px', borderRadius: 11 }}>
                  {project.owner}
                </span>
              )}
              {project.status && (
                <span style={{ display: 'inline-flex', alignItems: 'center', background: 'rgba(255,255,255,0.2)', color: '#fff', fontWeight: 700, fontSize: 11, padding: '3px 10px', borderRadius: 11, textTransform: 'capitalize' }}>
                  {projectStatusLabel(project.status)}
                </span>
              )}
              {project.due_date && <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.2)', borderRadius: 10, padding: '2px 10px', color: '#fff', fontWeight: 600 }}>Due {new Date(project.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
            </div>
            {project.description && <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 3 }}>{project.description}</p>}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, width: isMobile ? '100%' : 'auto' }}>
          {editingHeader ? (
            <>
              <button onClick={saveEdit} disabled={savingHeader || !editForm.name.trim()} title="Save changes"
                style={{ background: '#fff', color, border: 'none', borderRadius: 4, padding: '5px 14px', cursor: savingHeader ? 'wait' : 'pointer', fontSize: 12, fontFamily: 'Nunito, sans-serif', fontWeight: 800, opacity: (savingHeader || !editForm.name.trim()) ? 0.7 : 1 }}>
                {savingHeader ? 'Saving…' : 'Save'}
              </button>
              <button onClick={cancelEdit} disabled={savingHeader} title="Cancel"
                style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.4)', color: '#fff', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 12, fontFamily: 'Nunito, sans-serif', fontWeight: 700 }}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <div style={{ width: isMobile ? 'auto' : 100, flex: isMobile ? 1 : 'none', height: 5, background: 'rgba(255,255,255,0.25)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: '#fff', borderRadius: 3 }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>{pct}%</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)' }}>{doneTasks}/{totalTasks}</span>
              <button onClick={startEdit} title="Edit project"
                aria-label="Edit project"
                style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: 4, padding: isMobile ? '6px 10px' : '3px 8px', cursor: 'pointer', fontSize: 13, fontFamily: 'Nunito, sans-serif', fontWeight: 700, opacity: headerHover || isMobile ? 1 : 0, transition: 'opacity 120ms ease' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}>
                ✎ Edit
              </button>
              <button onClick={() => {
                if (window.confirm(`Delete project "${project.name}" and all its tasks? This cannot be undone.`)) {
                  supabase.from('tasks').delete().eq('project_id', project.id)
                    .then(() => supabase.from('projects').delete().eq('id', project.id))
                    .then(() => onUpdate())
                }
              }} title="Delete project"
                style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: 4, padding: isMobile ? '6px 10px' : '3px 8px', cursor: 'pointer', fontSize: 12, fontFamily: 'Nunito, sans-serif', fontWeight: 700 }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(222,53,11,0.6)'}
                onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,0.15)'}>🗑 Delete</button>
            </>
          )}
        </div>
      </div>

      {/* Tabs — Monday.com style */}
      <div className={isMobile ? 'scroll-x' : undefined} style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #dfe1e6', padding: isMobile ? '0 6px' : '0 20px', background: '#fff', gap: isMobile ? 0 : 4 }}>
        <TAB id="table" label={isMobile ? 'Tasks' : 'Main Table'} icon="☰" />
        <TAB id="kanban" label="Kanban" icon="⊞" />
        <TAB id="gantt" label="Timeline" icon="▬" />
        <TAB id="dashboard" label="Dashboard" icon="◉" />
        <div style={{ flex: 1, minWidth: isMobile ? 8 : 0 }} />
        <button onClick={() => onAddTask(project.id)} style={{ background: color, color: '#fff', border: 'none', borderRadius: 6, padding: isMobile ? '7px 12px' : '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Nunito, sans-serif', whiteSpace: 'nowrap', flexShrink: 0, marginRight: isMobile ? 6 : 0 }}>+ Add task</button>
      </div>

      {/* Tab content */}
      <div style={{ padding: projectTab === 'table' ? 0 : isMobile ? '0 10px' : '0 16px' }}>

        {/* TABLE VIEW */}
        {projectTab === 'table' && (
          <>
            {/* Selection action bar (UI #8) */}
            {selectedIds.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', background: '#f0f4ff', borderBottom: '1px solid #dfe1e6' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--indigo)' }}>{selectedIds.size} selected</span>
                {groupingSel ? (
                  <>
                    <input autoFocus value={selGroupName} onChange={e => setSelGroupName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') groupSelected(); if (e.key === 'Escape') { setGroupingSel(false); setSelGroupName('') } }}
                      placeholder="Group name (optional)..." style={{ border: `1px solid ${color}`, borderRadius: 4, padding: '4px 10px', fontSize: 12, fontFamily: 'Nunito, sans-serif', outline: 'none' }} />
                    <button onClick={groupSelected} style={{ background: color, color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'Nunito, sans-serif', fontWeight: 700 }}>Create group</button>
                    <button onClick={() => { setGroupingSel(false); setSelGroupName('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#6b778c' }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setGroupingSel(true)} style={{ background: color, color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'Nunito, sans-serif', fontWeight: 700 }}>Group selected</button>
                    <button onClick={clearSel} style={{ background: 'none', border: '1px solid #dfe1e6', borderRadius: 4, padding: '3px 10px', fontSize: 12, cursor: 'pointer', color: '#6b778c', fontFamily: 'Nunito, sans-serif' }}>Clear</button>
                  </>
                )}
              </div>
            )}

            {/* Column headers — sits above the rows with identical flex structure so every
                header lines up over its column. Key alignment constraints:
                  • borderLeft matches the row's 4px projectColor stripe (transparent here)
                  • paddingLeft: 0 on the outer (was 32, which shifted everything right)
                  • Task header uses padding-left 0 to align with row's title text (which
                    starts at indent=0 for top-level rows)
                  • per-column horizontal padding matches ProjectTableRow's cells */}
            {!isMobile && <div style={{ display: 'flex', alignItems: 'center', background: '#f8f9fc', borderBottom: '2px solid #dfe1e6', borderLeft: '4px solid transparent' }}>
              <div style={{ width: W.select, flexShrink: 0 }} />
              <div style={{ flex: 1, maxWidth: TASK_COL_MAX, padding: '7px 8px 7px 0', fontSize: 11, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Task</div>
              {[
                { col: 'owner',    label: 'Owner' },
                { col: 'status',   label: 'Status' },
                { col: 'timeline', label: 'Timeline' },
                { col: 'effort',   label: 'Effort' },
                { col: 'priority', label: 'Priority' },
                { col: 'progress', label: 'Progress' },
              ].map(({ col, label }) => (
                <div key={col} style={{ width: W[col], padding: '7px 6px', fontSize: 11, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase', position: 'relative', flexShrink: 0 }}>
                  {label}
                  <div onMouseDown={startDragCol(col)} title="Drag to resize"
                    style={{ position: 'absolute', top: 0, right: -3, bottom: 0, width: 6, cursor: 'col-resize' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(61,21,125,0.15)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'} />
                </div>
              ))}
            </div>}

            {/* Groups with their tasks */}
            {groups.map((group, gi) => (
              <ProjectGroup key={group.id} group={group} allTasks={allTasks} projectColor={color}
                groupIndex={gi} onUpdate={onUpdate} onPatch={onPatch} onDelete={onDelete} onDeleteGroup={onDeleteGroup}
                onAddSubtask={onAddSubtask}
                onSelect={onSelect} onAddTask={onAddTask} projectId={project.id}
                selectedIds={selectedIds} onToggleSelect={onToggleSelect} widths={W} />
            ))}

            {/* Ungrouped tasks */}
            {ungroupedTasks.length > 0 && (
              <div>
                {ungroupedTasks.map(task => (
                  <ProjectTableRow key={task.id} task={task} projectColor={color}
                    onUpdate={onUpdate} onPatch={onPatch} onDelete={onDelete} onSelect={onSelect}
                    selected={selectedIds.has(task.id)} onToggleSelect={onToggleSelect} widths={W} />
                ))}
              </div>
            )}

            {/* Add group/task footer */}
            <div style={{ padding: '8px 16px 12px', display: 'flex', gap: 8, borderTop: '1px solid #f0f1f3' }}>
              {addingGroup ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input autoFocus value={groupName} onChange={e => setGroupName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveGroup(); if (e.key === 'Escape') setAddingGroup(false) }}
                    placeholder="Group name..." style={{ border: `1px solid ${color}`, borderRadius: 4, padding: '4px 10px', fontSize: 12, fontFamily: 'Nunito, sans-serif', outline: 'none' }} />
                  <button onClick={saveGroup} style={{ background: color, color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'Nunito, sans-serif', fontWeight: 700 }}>Add</button>
                  <button onClick={() => setAddingGroup(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#6b778c' }}>Cancel</button>
                </div>
              ) : (
                <>
                  <button onClick={() => onAddTask(project.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#6b778c', fontFamily: 'Nunito, sans-serif', fontWeight: 600, padding: '4px 8px', borderRadius: 4 }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f0f1f3'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>+ Add task</button>
                  <button onClick={() => setAddingGroup(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#6b778c', fontFamily: 'Nunito, sans-serif', fontWeight: 600, padding: '4px 8px', borderRadius: 4 }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f0f1f3'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>+ Add group</button>
                </>
              )}
            </div>
          </>
        )}

        {projectTab === 'kanban' && <KanbanBoard tasks={tasks} project={project} onSelect={onSelect} onUpdate={onUpdate} onPatch={onPatch} onAddTask={onAddTask} />}
        {projectTab === 'gantt' && <ProjectGanttChart tasks={tasks} onSelectTask={onSelect} />}
        {projectTab === 'dashboard' && <ProjectDashboard project={project} tasks={tasks} color={color} />}
      </div>
    </div>
  )
}
