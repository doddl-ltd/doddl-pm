import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { GROUP_TINTS } from '../lib/team'
import { PROJ_COL_WIDTHS as W_DEFAULT, TASK_COL_MAX } from '../lib/constants'
import ProjectTableRow from './ProjectTableRow'
import { useIsMobile } from '../lib/useIsMobile'

// Renders one task_groups row as a collapsible section:
//   • header shows the group name and live task count
//   • body lists every task whose group_id matches (parent_id IS NULL, so
//     sub-tasks nested under a parent task aren't duplicated here)
//   • + Add task button inserts a new task with group_id = this group's id
//   • × Delete calls onDeleteGroup — member tasks survive (FK ON DELETE SET NULL)
//     and drop into the project's ungrouped bucket.
export default function ProjectGroup({ group, allTasks, projectColor, onUpdate, onPatch, onDelete, onDeleteGroup, onAddSubtask, onSelect, onAddTask, projectId, groupIndex, selectedIds, onToggleSelect, widths }) {
  const W = widths || W_DEFAULT
  const isMobile = useIsMobile()
  const [collapsed, setCollapsed] = useState(false)
  const [addingTask, setAddingTask] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  // Members of this group — exclude subtasks (rendered under their parent task).
  const children = allTasks.filter(t => t.group_id === group.id && !t.parent_id)
  const tint = GROUP_TINTS[groupIndex % GROUP_TINTS.length]

  const addTask = async () => {
    if (!newTaskTitle.trim()) return
    await supabase.from('tasks').insert([{
      title: newTaskTitle.trim(),
      project_id: projectId,
      group_id: group.id,
      status: 'not_started',
      priority: 'medium',
      progress: 0,
      source: 'manual',
    }])
    setNewTaskTitle(''); setAddingTask(false); onUpdate()
  }

  const handleDelete = () => {
    const ok = window.confirm(
      `Delete group "${group.name}"?\n\n${children.length} task${children.length === 1 ? '' : 's'} will remain but become ungrouped.`
    )
    if (!ok) return
    if (onDeleteGroup) onDeleteGroup(group.id)
  }

  return (
    <div style={{ marginBottom: 0 }}>
      {/* Group header — click anywhere to collapse/expand */}
      <div style={{ display: 'flex', alignItems: 'center', background: tint.bg, borderLeft: `4px solid ${tint.border}`, borderBottom: '1px solid #dfe1e6', borderTop: '2px solid #e5e7eb', cursor: 'pointer' }}
        onClick={() => setCollapsed(c => !c)}>
        <div style={{ width: W.select, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: tint.text, fontWeight: 800 }}>{collapsed ? '▶' : '▼'}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0, maxWidth: isMobile ? 'none' : TASK_COL_MAX, padding: isMobile ? '11px 0' : '8px 0', display: 'flex', alignItems: 'center', gap: 10, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
          <span style={{ fontWeight: 800, fontSize: isMobile ? 14 : 13, color: tint.text, wordBreak: 'break-word' }}>{group.name}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: tint.text, background: '#fff', borderRadius: 10, padding: '1px 8px', whiteSpace: 'nowrap' }}>
            {children.length} task{children.length === 1 ? '' : 's'}
          </span>
        </div>
        {/* Spacer cols — widths match ProjectTableRow so header + rows stay aligned (desktop table only) */}
        {!isMobile && <>
          <div style={{ width: W.owner,    flexShrink: 0 }} />
          <div style={{ width: W.status,   flexShrink: 0 }} />
          <div style={{ width: W.timeline, flexShrink: 0 }} />
          <div style={{ width: W.effort,   flexShrink: 0 }} />
          <div style={{ width: W.priority, flexShrink: 0 }} />
        </>}
        <div style={{ width: isMobile ? 'auto' : W.progress, flexShrink: 0, display: 'flex', justifyContent: 'flex-end', paddingRight: isMobile ? 12 : 10, paddingLeft: isMobile ? 8 : 0 }}>
          <span onClick={e => { e.stopPropagation(); handleDelete() }} title="Delete group"
            style={{ color: '#c1c7d0', cursor: 'pointer', fontSize: isMobile ? 20 : 16, lineHeight: 1 }}
            onMouseEnter={e => e.currentTarget.style.color = '#de350b'}
            onMouseLeave={e => e.currentTarget.style.color = '#c1c7d0'}>×</span>
        </div>
      </div>
      {/* Child tasks — rendered at depth=1 so they indent under the header */}
      {!collapsed && children.map(task => (
        <ProjectTableRow key={task.id} task={task} projectColor={tint.border}
          onUpdate={onUpdate} onPatch={onPatch} onDelete={onDelete} onSelect={onSelect} depth={1}
          selected={!!selectedIds?.has(task.id)} onToggleSelect={onToggleSelect} widths={W} />
      ))}
      {/* Inline + Add task inside this group */}
      {!collapsed && (
        addingTask ? (
          <div style={{ display: 'flex', alignItems: 'center', borderLeft: `4px solid ${tint.border}`, borderBottom: '1px solid #f0f1f3', padding: isMobile ? '8px 10px' : '4px 8px 4px 32px', gap: 8, background: '#fff' }}>
            <input autoFocus value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addTask(); if (e.key === 'Escape') setAddingTask(false) }}
              placeholder="Task title..." style={{ flex: 1, minWidth: 0, border: `1px solid ${tint.border}`, borderRadius: 4, padding: isMobile ? '7px 8px' : '4px 8px', fontSize: 13, fontFamily: 'Nunito, sans-serif', outline: 'none' }} />
            <button onClick={addTask} style={{ background: tint.border, color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'Nunito, sans-serif', fontWeight: 700 }}>Add</button>
            <button onClick={() => setAddingTask(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#6b778c' }}>Cancel</button>
          </div>
        ) : (
          <div style={{ borderLeft: `4px solid ${tint.border}`, borderBottom: '1px solid #f0f1f3', background: '#fff' }}>
            <button onClick={() => setAddingTask(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: isMobile ? 13 : 12, color: tint.text, padding: isMobile ? '10px 12px' : '6px 8px 6px 32px', fontFamily: 'Nunito, sans-serif', fontWeight: 700, opacity: 0.7 }}
              onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = 0.7}>+ Add task</button>
          </div>
        )
      )}
    </div>
  )
}
