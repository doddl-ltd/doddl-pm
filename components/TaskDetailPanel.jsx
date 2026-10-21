import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { TEAM, getDisplayName } from '../lib/team'
import { STATUSES, statusMap } from '../lib/constants'
import StatusBadge from './StatusBadge'
import AssigneeSelect from './AssigneeSelect'
import PriorityBadge from './PriorityBadge'
import ProgressBar from './ProgressBar'
import TagsCell from './TagsCell'
import OwnerAvatar from './OwnerAvatar'
import CommentBody from './CommentBody'
import MentionInput from './MentionInput'
import ApprovalTaskPanel from './ApprovalTaskPanel'
import TaskEvidence from './TaskEvidence'
import { useIsMobile } from '../lib/useIsMobile'
import { HEADER_H } from './AppHeader'

const MIN_W = 300, MAX_W = 800, DEFAULT_W = 400, STORAGE_KEY = 'doddl-pm-detail-panel-width'
export const TASK_PANEL = { MIN: MIN_W, MAX: MAX_W, DEFAULT: DEFAULT_W, STORAGE_KEY }

export default function TaskDetailPanel({ task, user, onClose, onUpdate, onPatch, allTasks = [], panelW, setPanelW }) {
  const [comments, setComments]   = useState([])
  const [newComment, setNewComment] = useState('')
  const [posting, setPosting]     = useState(false)
  const [editTask, setEditTask]   = useState(task)
  const [saving, setSaving]       = useState(false)
  const userName = getDisplayName(user?.username) || user?.name || 'Unknown'
  const isMobile = useIsMobile()

  // Phone: the panel is a full-screen sheet over the scrolling page, so hold the page still.
  useEffect(() => {
    if (!isMobile) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [isMobile])

  // UI #6 — resize drag (width state is owned by the parent so the main content
  // can reserve the matching marginRight).
  const drag = useRef(null)
  useEffect(() => {
    const onMove = (e) => {
      if (!drag.current) return
      const next = Math.max(MIN_W, Math.min(MAX_W, window.innerWidth - e.clientX))
      setPanelW(next)
    }
    const onUp = () => {
      if (!drag.current) return
      drag.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      try { window.sessionStorage.setItem(STORAGE_KEY, String(panelW)) } catch { /* ignore */ }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [panelW, setPanelW])
  const startPanelDrag = (e) => {
    e.preventDefault()
    drag.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  // UI #9 — click-to-edit task title
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(task.title || '')
  const titleInputRef = useRef(null)

  // Keep editTask in sync when task prop changes
  useEffect(() => {
    setEditTask(task)
    setTitleDraft(task.title || '')
    setEditingTitle(false)
  }, [task.id])
  useEffect(() => { if (editingTitle) titleInputRef.current?.focus() }, [editingTitle])

  const commitTitle = async () => {
    const next = titleDraft.trim()
    setEditingTitle(false)
    if (!next || next === editTask.title) return
    await save('title', next)
  }
  const cancelTitle = () => {
    setTitleDraft(editTask.title || '')
    setEditingTitle(false)
  }

  const loadComments = useCallback(async () => {
    const { data } = await supabase.from('comments').select('*').eq('task_id', task.id).order('created_at', { ascending: true })
    setComments(data || [])
  }, [task.id])
  useEffect(() => { loadComments() }, [loadComments])

  const save = async (field, value) => {
    setSaving(true)
    const patch = { [field]: value }
    // UI #11 — progress→status cascade (mirrors ProjectTableRow.handleProgress)
    if (field === 'progress') {
      const pct = Math.max(0, Math.min(100, Number(value) || 0))
      patch.progress = pct
      const auto = pct === 0 ? 'not_started' : pct === 100 ? 'done' : 'in_progress'
      const vanilla = new Set(['not_started', 'in_progress', 'done'])
      if (vanilla.has(editTask.status) && auto !== editTask.status) {
        patch.status = auto
      }
    }
    // And the reverse: marking status='done' auto-bumps progress to 100
    if (field === 'status' && value === 'done' && (editTask.progress ?? 0) !== 100) {
      patch.progress = 100
    }
    setEditTask(t => ({ ...t, ...patch }))
    if (onPatch) onPatch(task.id, patch)   // optimistic propagation to parent tasks array
    await supabase.from('tasks').update(patch).eq('id', task.id)
    setSaving(false)
    onUpdate()
  }

  const postComment = async () => {
    if (!newComment.trim()) return
    setPosting(true)
    const mentionMatches = newComment.match(/@(\w+)/g) || []
    const mentions = mentionMatches.map(m => m.slice(1)).filter(n => TEAM.some(t => t.name.toLowerCase() === n.toLowerCase()))
    const { data: commentData } = await supabase.from('comments').insert([{ task_id: task.id, author: userName, body: newComment, mentions }]).select().single()
    const notifs = []
    for (const name of mentions) {
      if (name.toLowerCase() !== userName.toLowerCase())
        notifs.push({ user_name: name, type: 'mention', comment_id: commentData?.id, task_id: task.id, task_title: task.title, from_user: userName, body: newComment, read: false })
    }
    if (task.assigned_to && task.assigned_to.toLowerCase() !== userName.toLowerCase() && !mentions.map(m => m.toLowerCase()).includes(task.assigned_to.toLowerCase()))
      notifs.push({ user_name: task.assigned_to, type: 'comment_on_owned', comment_id: commentData?.id, task_id: task.id, task_title: task.title, from_user: userName, body: newComment, read: false })
    if (notifs.length > 0) await supabase.from('notifications').insert(notifs)
    setNewComment(''); setPosting(false); loadComments()
  }

  const effort = editTask.start_date && editTask.due_date
    ? Math.max(1, Math.ceil((new Date(editTask.due_date) - new Date(editTask.start_date)) / 86400000))
    : null

  const s = statusMap[editTask.status] || STATUSES[0]

  const FieldLabel = ({ label }) => (
    <p style={{ fontSize: 10, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</p>
  )

  return (
    <div style={isMobile
      ? { position: 'fixed', inset: 0, background: '#fff', zIndex: 600, display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)' }
      : { position: 'fixed', right: 0, top: HEADER_H, bottom: 0, width: panelW, background: '#fff', borderLeft: '1px solid #dfe1e6', zIndex: 500, display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 20px rgba(0,0,0,0.08)' }}>
      {/* Left-edge drag handle (UI #6) */}
      {!isMobile && <div onMouseDown={startPanelDrag} title="Drag to resize panel"
        style={{ position: 'absolute', top: 0, left: -3, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 501 }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(61,21,125,0.15)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'} />}
      {/* Header */}
      <div style={{ padding: isMobile ? '12px 14px' : '14px 20px', borderBottom: '1px solid #dfe1e6', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: '#fafbfc' }}>
        <div style={{ flex: 1, marginRight: 12 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase', marginBottom: 6 }}>
            {editTask.task_type && editTask.task_type !== 'standard'
              ? <span style={{ background: '#ede9fe', color: '#6554c0', borderRadius: 10, padding: '1px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em' }}>{editTask.task_type.replace(/_/g, ' ')}</span>
              : 'TASK'}
            {saving && <span style={{ color: 'var(--aqua)', marginLeft: 8 }}>· Saving...</span>}
          </p>
          {/* UI #9 — click title to edit. Enter saves, Escape reverts. */}
          {editingTitle ? (
            <textarea ref={titleInputRef} value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitTitle() }
                if (e.key === 'Escape') { e.preventDefault(); cancelTitle() }
              }}
              rows={2} style={{ width: '100%', border: '1px solid var(--aqua)', borderRadius: 4, padding: '4px 6px', outline: 'none', fontSize: 15, fontWeight: 800, color: '#172b4d', lineHeight: 1.4, resize: 'none', background: '#fff', fontFamily: 'Nunito, sans-serif' }} />
          ) : (
            <div onClick={() => setEditingTitle(true)} title="Click to edit title"
              style={{ width: '100%', fontSize: 15, fontWeight: 800, color: '#172b4d', lineHeight: 1.4, cursor: 'text', minHeight: 24, wordBreak: 'break-word' }}>
              {editTask.title || <span style={{ color: '#c1c7d0' }}>(untitled — click to name)</span>}
            </div>
          )}
          <div style={{ marginTop: 6 }}>
            <StatusBadge value={editTask.status} onChange={v => save('status', v)} />
          </div>
        </div>
        <button onClick={onClose} aria-label="Close task"
          style={isMobile
            ? { background: '#f0f1f3', border: 'none', borderRadius: 18, width: 36, height: 36, fontSize: 24, lineHeight: '34px', cursor: 'pointer', color: '#42526e', flexShrink: 0 }
            : { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6b778c', flexShrink: 0 }}>×</button>
      </div>

      {/* Editable fields */}
      <div style={{ overflowY: 'auto', flex: 1, WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
        {editTask.task_type === 'approval' && (
          <ApprovalTaskPanel task={editTask} userName={userName} onUpdate={onUpdate} />
        )}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0f1f3', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <FieldLabel label="Assignee" />
            <AssigneeSelect value={editTask.assigned_to} onChange={v => save('assigned_to', v)} />
          </div>
          <div>
            <FieldLabel label="Priority" />
            <PriorityBadge value={editTask.priority} onChange={v => save('priority', v)} />
          </div>
          <div>
            <FieldLabel label="Start Date" />
            <input type="date" value={editTask.start_date || ''} onChange={e => save('start_date', e.target.value)}
              style={{ border: '1px solid #dfe1e6', borderRadius: 4, padding: '4px 8px', fontSize: 12, fontFamily: 'Nunito, sans-serif', width: '100%', color: '#172b4d' }} />
          </div>
          <div>
            <FieldLabel label="Due Date" />
            <input type="date" value={editTask.due_date || ''} onChange={e => save('due_date', e.target.value)}
              style={{ border: '1px solid #dfe1e6', borderRadius: 4, padding: '4px 8px', fontSize: 12, fontFamily: 'Nunito, sans-serif', width: '100%', color: '#172b4d' }} />
          </div>
          <div>
            <FieldLabel label="Effort" />
            <p style={{ fontSize: 13, fontWeight: 700, color: '#172b4d' }}>{effort ? `${effort} day${effort !== 1 ? 's' : ''}` : <span style={{ color: '#a0aec0' }}>Set start + due</span>}</p>
          </div>
          <div>
            <FieldLabel label="Progress" />
            <ProgressBar value={editTask.progress} onChange={v => save('progress', v)} />
          </div>
        </div>

        {/* Dependencies (feature #13) */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #f0f1f3' }}>
          <FieldLabel label="Depends on" />
          {(() => {
            const candidates = allTasks.filter(t => t.id !== editTask.id && t.project_id === editTask.project_id && !t.is_group)
            const current = editTask.depends_on ? allTasks.find(t => t.id === editTask.depends_on) : null
            const blocked = current && current.status !== 'done'
            return (
              <>
                <select value={editTask.depends_on || ''} onChange={e => save('depends_on', e.target.value || null)}
                  style={{ width: '100%', border: '1px solid #dfe1e6', borderRadius: 6, padding: '6px 10px', fontSize: 13, fontFamily: 'Nunito, sans-serif', background: '#fff', color: '#172b4d' }}>
                  <option value="">— No dependency —</option>
                  {candidates.map(t => (
                    <option key={t.id} value={t.id}>
                      {(t.status === 'done' ? '✓ ' : '◯ ') + (t.title || '(untitled)').slice(0, 70)}
                    </option>
                  ))}
                </select>
                {current && (
                  <p style={{ fontSize: 11, marginTop: 6, color: blocked ? '#de350b' : '#00875a', fontWeight: 700 }}>
                    {blocked
                      ? `⚠ Blocked — "${(current.title || '').slice(0, 40)}" is not done yet (status: ${current.status})`
                      : `✓ Dependency satisfied — "${(current.title || '').slice(0, 40)}" is done`}
                  </p>
                )}
                {!candidates.length && !current && (
                  <p style={{ fontSize: 11, marginTop: 6, color: '#a0aec0' }}>No other tasks in this project to depend on yet.</p>
                )}
              </>
            )
          })()}
        </div>

        {/* How to do it: the task's description. Claude, agents and auto-triage write a task's
            steps and context here, so it is shown above Notes and can be edited like it. */}
        {(editTask.description || '') !== '' && (
          <div style={{ padding: '12px 20px', borderBottom: '1px solid #f0f1f3' }}>
            <FieldLabel label="How to do it" />
            <textarea value={editTask.description || ''} onChange={e => setEditTask(t => ({ ...t, description: e.target.value }))}
              onBlur={e => save('description', e.target.value)}
              rows={Math.min(18, Math.max(4, String(editTask.description || '').split('\n').length + 1))}
              style={{ width: '100%', border: '1px solid #dfe1e6', borderRadius: 6, padding: '8px 10px', fontSize: 13, fontFamily: 'Nunito, sans-serif', resize: 'vertical', outline: 'none', color: '#172b4d', lineHeight: 1.5, background: '#fafbfc' }} />
          </div>
        )}

        {/* Notes */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #f0f1f3' }}>
          <FieldLabel label="Notes" />
          <textarea value={editTask.notes || ''} onChange={e => setEditTask(t => ({ ...t, notes: e.target.value }))}
            onBlur={e => save('notes', e.target.value)}
            placeholder="Add notes..." rows={4}
            style={{ width: '100%', border: '1px solid #dfe1e6', borderRadius: 6, padding: '8px 10px', fontSize: 13, fontFamily: 'Nunito, sans-serif', resize: 'vertical', outline: 'none', color: '#172b4d', lineHeight: 1.5 }} />
        </div>

        {/* Tags */}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid #f0f1f3' }}>
          <FieldLabel label="Tags" />
          <TagsCell value={editTask.tags} onChange={v => save('tags', v)} />
        </div>

        {/* Evidence links + change history */}
        <TaskEvidence taskId={task.id} />

        {/* Comments */}
        <div style={{ padding: '12px 20px' }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 12 }}>Comments ({comments.length})</p>
          {comments.length === 0 && <p style={{ fontSize: 13, color: '#a0aec0', fontWeight: 600, marginBottom: 12 }}>No comments yet. Type @ to mention someone.</p>}
          {comments.map(c => (
            <div key={c.id} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <OwnerAvatar name={c.author} />
                <div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#172b4d' }}>{c.author}</span>
                  <span style={{ fontSize: 11, color: '#a0aec0', marginLeft: 8 }}>{new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                {c.mentions?.length > 0 && <div style={{ display: 'flex', gap: 3, marginLeft: 'auto' }}>
                  {c.mentions.map(m => <span key={m} style={{ fontSize: 9, background: '#e9f2ff', color: '#0052cc', borderRadius: 3, padding: '1px 4px', fontWeight: 700 }}>@{m}</span>)}
                </div>}
              </div>
              <div style={{ marginLeft: 36, background: '#f8f9fc', borderRadius: 8, padding: '8px 12px' }}>
                <CommentBody body={c.body} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Comment input */}
      <div style={{ padding: isMobile ? '10px 14px calc(10px + env(safe-area-inset-bottom))' : '12px 20px', borderTop: '1px solid #dfe1e6', background: '#fafbfc' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <OwnerAvatar name={userName} />
          <MentionInput value={newComment} onChange={setNewComment} onPost={postComment} posting={posting} userName={userName} />
        </div>
      </div>
    </div>
  )
}
