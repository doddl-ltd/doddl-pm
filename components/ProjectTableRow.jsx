import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { PROJ_COL_WIDTHS as W_DEFAULT, TASK_COL_MAX } from '../lib/constants'
import StatusBadge from './StatusBadge'
import AssigneeSelect from './AssigneeSelect'
import PriorityBadge from './PriorityBadge'
import ProgressBar from './ProgressBar'
import TimelineCell from './TimelineCell'
import { useIsMobile } from '../lib/useIsMobile'

export default function ProjectTableRow({ task, projectColor, onUpdate, onPatch, onDelete, onSelect, depth = 0, selected, onToggleSelect, widths }) {
  const W = widths || W_DEFAULT
  const isMobile = useIsMobile()
  // Safe wrapper — onPatch is optional; if parent didn't wire it, just no-op.
  const patchParent = (p) => { if (onPatch) onPatch(task.id, p) }
  // Saves write to DB then trigger parent refresh. The taskIdRef guard (below)
  // prevents the refresh from wiping mid-interaction local state.
  const save = async (field, value) => {
    const { error } = await supabase.from('tasks').update({ [field]: value }).eq('id', task.id)
    if (!error) onUpdate()
  }
  const indent = depth * 20

  // Full local state — row is self-contained, never wiped by parent reload
  const [localStatus,   setLocalStatus]   = useState(task.status     || 'not_started')
  const [localAssignee, setLocalAssignee] = useState(task.assigned_to|| '')
  const [localPriority, setLocalPriority] = useState(task.priority   || 'medium')
  const [localProgress, setLocalProgress] = useState(task.progress   || 0)
  const [localStart,    setLocalStart]    = useState(task.start_date || '')
  const [localEnd,      setLocalEnd]      = useState(task.due_date   || '')

  // UI #8 — inline title edit
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(task.title || '')
  const [hovering, setHovering] = useState(false)
  const titleInputRef = useRef(null)

  const taskIdRef = useRef(task.id)
  useEffect(() => {
    if (task.id !== taskIdRef.current) {
      taskIdRef.current = task.id
      setLocalStatus(task.status || 'not_started')
      setLocalAssignee(task.assigned_to || '')
      setLocalPriority(task.priority || 'medium')
      setLocalProgress(task.progress || 0)
      setLocalStart(task.start_date || '')
      setLocalEnd(task.due_date || '')
      setEditingTitle(false)
      setTitleDraft(task.title || '')
    }
  }, [task.id])

  // Re-sync the date cells when props update for the SAME task (e.g. load()
  // refresh after a DB backfill). Without this the timeline keeps stale
  // '' values and renders red "Start*" even after the row's start_date lands.
  useEffect(() => { setLocalStart(task.start_date || '') }, [task.start_date])
  useEffect(() => { setLocalEnd(task.due_date   || '') }, [task.due_date])
  // Keep progress in sync too, so the project-level avg bar reflects external updates.
  useEffect(() => { setLocalProgress(task.progress ?? 0) }, [task.progress])

  useEffect(() => { if (editingTitle) titleInputRef.current?.focus() }, [editingTitle])

  const startEditTitle = (e) => {
    e?.stopPropagation()
    setTitleDraft(task.title || '')
    setEditingTitle(true)
  }
  const commitTitle = async () => {
    const next = titleDraft.trim()
    setEditingTitle(false)
    if (!next || next === task.title) return
    const { error } = await supabase.from('tasks').update({ title: next }).eq('id', task.id)
    if (!error) onUpdate()
  }
  const cancelTitle = () => {
    setTitleDraft(task.title || '')
    setEditingTitle(false)
  }

  const effort = localStart && localEnd
    ? Math.max(1, Math.ceil((new Date(localEnd) - new Date(localStart)) / 86400000))
    : null

  const handleStatus = async (v) => {
    setLocalStatus(v)
    const updates = { status: v }
    if (v === 'done') { updates.progress = 100; setLocalProgress(100) }
    patchParent(updates)   // optimistic — so header pct, gallery % etc update instantly
    const { error } = await supabase.from('tasks').update(updates).eq('id', task.id)
    if (!error) onUpdate()
  }

  // UI #11 — progress % drives status:
  //   0%         → not_started
  //   1..99%     → in_progress
  //   100%       → done
  // Exception: if already at an explicit "state" value (on_track / at_risk /
  // blocked), we keep that — only flip from vanilla not_started / in_progress /
  // done to the auto-derived value, so a user's explicit state isn't clobbered.
  const handleProgress = async (v) => {
    const pct = Math.max(0, Math.min(100, Number(v) || 0))
    setLocalProgress(pct)
    const updates = { progress: pct }
    const auto = pct === 0 ? 'not_started' : pct === 100 ? 'done' : 'in_progress'
    const vanilla = new Set(['not_started', 'in_progress', 'done'])
    if (vanilla.has(localStatus) && auto !== localStatus) {
      updates.status = auto
      setLocalStatus(auto)
    }
    patchParent(updates)   // optimistic
    const { error } = await supabase.from('tasks').update(updates).eq('id', task.id)
    if (!error) onUpdate()
  }

  const saveTimeline = async (start, end) => {
    setLocalStart(start); setLocalEnd(end)
    const { error } = await supabase.from('tasks').update({ start_date: start, due_date: end }).eq('id', task.id)
    if (!error) onUpdate()
  }

  // Phone: the row as a card. Title in full (tap opens the task), then the same editable
  // cells the table has, wrapped onto two lines. Rename and delete are always visible
  // (there is no hover), and delete asks first because it is easy to tap by mistake.
  if (isMobile) {
    return (
      <div style={{ borderLeft: `4px solid ${projectColor}`, borderBottom: '1px solid #f0f1f3', padding: `10px 12px 11px ${12 + (depth ? 6 : 0)}px`, background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          {editingTitle ? (
            <input ref={titleInputRef} value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitTitle() }
                if (e.key === 'Escape') { e.preventDefault(); cancelTitle() }
              }}
              style={{ flex: 1, minWidth: 0, border: '1px solid var(--aqua)', borderRadius: 6, padding: '6px 8px', fontWeight: 600, fontFamily: 'Nunito, sans-serif', outline: 'none', color: '#172b4d' }} />
          ) : (
            <span onClick={() => onSelect && onSelect(task)}
              style={{ flex: 1, minWidth: 0, fontWeight: depth === 0 ? 700 : 600, fontSize: 14, lineHeight: 1.35, color: '#172b4d', cursor: 'pointer', wordBreak: 'break-word', paddingTop: 2 }}>
              {task.title || <span style={{ color: '#c1c7d0' }}>(untitled)</span>}
            </span>
          )}
          {!editingTitle && (
            <button onClick={startEditTitle} aria-label="Rename task"
              style={{ background: 'none', border: 'none', color: '#97a0af', fontSize: 15, padding: '2px 4px', cursor: 'pointer', flexShrink: 0 }}>✎</button>
          )}
          <button onClick={() => { if (window.confirm(`Delete "${task.title || 'this task'}"?`)) onDelete(task.id) }} aria-label="Delete task"
            style={{ background: 'none', border: 'none', color: '#97a0af', fontSize: 20, lineHeight: 1, padding: '0 2px', cursor: 'pointer', flexShrink: 0 }}>×</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 9 }}>
          <AssigneeSelect value={localAssignee} onChange={v => { setLocalAssignee(v); save('assigned_to', v) }} avatarOnly />
          <StatusBadge value={localStatus} onChange={handleStatus} />
          <PriorityBadge value={localPriority} onChange={v => { setLocalPriority(v); save('priority', v) }} />
          {effort ? <span style={{ fontSize: 11, fontWeight: 700, color: '#0052cc', background: '#e9f2ff', borderRadius: 10, padding: '2px 7px' }}>{effort}d</span> : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10 }}>
          <div style={{ flex: 3, minWidth: 0 }}>
            <TimelineCell startDate={localStart} dueDate={localEnd} color={projectColor} onSave={saveTimeline} />
          </div>
          <div style={{ flex: 2, minWidth: 0 }}>
            <ProgressBar value={localProgress} onChange={handleProgress} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', borderLeft: `4px solid ${projectColor}`, borderBottom: '1px solid #f0f1f3', minHeight: 40, background: selected ? '#f0f4ff' : 'transparent' }}
      onMouseEnter={e => { setHovering(true); if (!selected) e.currentTarget.style.background = '#f8f9ff' }}
      onMouseLeave={e => { setHovering(false); if (!selected) e.currentTarget.style.background = 'transparent' }}>
      {/* Checkbox */}
      <div style={{ width: W.select, paddingLeft: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <input type="checkbox" checked={!!selected} onChange={() => onToggleSelect && onToggleSelect(task.id)}
          onClick={e => e.stopPropagation()}
          style={{ cursor: 'pointer', width: 14, height: 14 }} />
      </div>
      {/* Task name — click opens detail; dbl-click OR pencil icon inline-edits */}
      <div style={{ flex: 1, maxWidth: TASK_COL_MAX, paddingLeft: indent, paddingRight: 8, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {editingTitle ? (
          <input ref={titleInputRef} value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitTitle() }
              if (e.key === 'Escape') { e.preventDefault(); cancelTitle() }
            }}
            onClick={e => e.stopPropagation()}
            style={{ flex: 1, border: '1px solid var(--aqua)', borderRadius: 4, padding: '2px 6px', fontSize: 13, fontWeight: depth === 0 ? 600 : 400, fontFamily: 'Nunito, sans-serif', outline: 'none', color: '#172b4d' }} />
        ) : (
          <span onClick={() => onSelect && onSelect(task)}
            onDoubleClick={startEditTitle}
            title="Click to open detail · double-click to rename"
            style={{ fontWeight: depth === 0 ? 600 : 400, fontSize: 13, color: '#172b4d', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>
            {task.title}
          </span>
        )}
        {!editingTitle && (
          <span onClick={startEditTitle} title="Rename inline"
            style={{ color: '#c1c7d0', cursor: 'pointer', fontSize: 12, flexShrink: 0, opacity: hovering ? 1 : 0, transition: 'opacity 0.12s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#6b778c'}
            onMouseLeave={e => e.currentTarget.style.color = '#c1c7d0'}>✎</span>
        )}
        <span onClick={() => onDelete(task.id)} title="Delete task"
          style={{ color: '#c1c7d0', cursor: 'pointer', fontSize: 14, flexShrink: 0 }}
          onMouseEnter={e => e.currentTarget.style.color='#de350b'} onMouseLeave={e => e.currentTarget.style.color='#c1c7d0'}>×</span>
      </div>
      {/* Owner — horizontal padding 6px to match header */}
      <div style={{ width: W.owner, padding: '4px 6px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <AssigneeSelect value={localAssignee} onChange={v => { setLocalAssignee(v); save('assigned_to', v) }} avatarOnly />
      </div>
      {/* Status */}
      <div style={{ width: W.status, padding: '4px 6px', flexShrink: 0 }}>
        <StatusBadge value={localStatus} onChange={handleStatus} />
      </div>
      {/* Timeline — combined date range picker + bar. 6px padding to match header */}
      <div style={{ width: W.timeline, padding: '4px 6px', flexShrink: 0 }}>
        <TimelineCell
          startDate={localStart} dueDate={localEnd} color={projectColor}
          onSave={saveTimeline} />
      </div>
      {/* Effort — auto from dates */}
      <div style={{ width: W.effort, padding: '4px 6px', textAlign: 'center', flexShrink: 0 }}>
        {effort
          ? <span style={{ fontSize: 11, fontWeight: 700, color: '#0052cc', background: '#e9f2ff', borderRadius: 10, padding: '2px 7px' }}>{effort}d</span>
          : <span style={{ fontSize: 11, color: '#c1c7d0' }}>—</span>}
      </div>
      {/* Priority */}
      <div style={{ width: W.priority, padding: '4px 6px', flexShrink: 0 }}>
        <PriorityBadge value={localPriority} onChange={v => { setLocalPriority(v); save('priority', v) }} />
      </div>
      {/* Progress */}
      <div style={{ width: W.progress, padding: '4px 6px', flexShrink: 0 }}>
        <ProgressBar value={localProgress} onChange={handleProgress} />
      </div>
    </div>
  )
}
