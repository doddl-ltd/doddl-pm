import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { TEAM, getEmailFromName } from '../lib/team'
import { STATUSES, PRIORITIES } from '../lib/constants'

export default function AddTaskModal({ projects, parentId, projectId, allTasks, onClose, onSaved, currentUser }) {
  const [form, setForm] = useState({ title: '', status: 'not_started', priority: 'medium', project_id: projectId || '', assigned_to: '', start_date: '', due_date: '', progress: 0, notes: '', source: 'manual', depends_on: '', parent_id: parentId || null, tags: [] })
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!form.title.trim()) return
    setSaving(true)
    const userEmail = getEmailFromName(form.assigned_to) || currentUser?.username || ''
    await supabase.from('tasks').insert([{ ...form, project_id: form.project_id || null, depends_on: form.depends_on || null, user_email: userEmail }])
    setSaving(false); onSaved(); onClose()
  }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 'clamp(16px, 5vw, 28px)', width: 520, maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100dvh - 40px)', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--indigo)', margin: 0 }}>{parentId ? 'Add Subtask' : 'New Task'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6b778c' }}>×</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input placeholder="Task title *" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
            style={{ padding: '9px 12px', border: '1px solid #dfe1e6', borderRadius: 6, fontSize: 14, fontWeight: 600, fontFamily: 'Nunito, sans-serif' }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Project</label>
              <select value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value })}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #dfe1e6', borderRadius: 6, fontSize: 13, fontFamily: 'Nunito, sans-serif' }}>
                <option value="">No project</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Assignee</label>
              <select value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #dfe1e6', borderRadius: 6, fontSize: 13, fontFamily: 'Nunito, sans-serif' }}>
                <option value="">Unassigned</option>
                {TEAM.map(m => <option key={m.email} value={m.name}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Status</label>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #dfe1e6', borderRadius: 6, fontSize: 13, fontFamily: 'Nunito, sans-serif' }}>
                {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Priority</label>
              <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #dfe1e6', borderRadius: 6, fontSize: 13, fontFamily: 'Nunito, sans-serif' }}>
                {PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Start Date</label>
              <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #dfe1e6', borderRadius: 6, fontSize: 13, fontFamily: 'Nunito, sans-serif' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Due Date</label>
              <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #dfe1e6', borderRadius: 6, fontSize: 13, fontFamily: 'Nunito, sans-serif' }} />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Notes..."
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #dfe1e6', borderRadius: 6, fontSize: 13, fontFamily: 'Nunito, sans-serif', resize: 'vertical' }} />
          </div>
          <button onClick={save} disabled={saving}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', borderRadius: 6, padding: '11px 0', fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'Nunito, sans-serif', marginTop: 4 }}>
            {saving ? 'Saving...' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  )
}
