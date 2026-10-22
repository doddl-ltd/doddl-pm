import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { PROJECT_COLORS, TEAM } from '../lib/team'
import { PRIORITIES } from '../lib/constants'
import { PROJECT_STATUSES } from './ProjectSection'
import AccessPicker from './AccessPicker'

export default function AddProjectModal({ onClose, onSaved, colorIndex, userName }) {
  const color = PROJECT_COLORS[colorIndex % PROJECT_COLORS.length]
  const [form, setForm] = useState({ name: '', description: '', priority: 'medium', owner: userName || '', due_date: '', status: 'active', color, is_private: false, members: [] })
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    const payload = {
      ...form,
      owner: form.owner || null,
      due_date: form.due_date || null,
      description: form.description || null,
      members: form.is_private ? form.members : [],
    }
    await supabase.from('projects').insert([payload])
    setSaving(false); onSaved(); onClose()
  }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 'clamp(16px, 5vw, 28px)', width: 460, maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100dvh - 40px)', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--indigo)', margin: 0 }}>New Project</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6b778c' }}>×</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input placeholder="Project name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            style={{ padding: '9px 12px', border: '1px solid #dfe1e6', borderRadius: 6, fontSize: 14, fontWeight: 600, fontFamily: 'Nunito, sans-serif' }} />
          <textarea placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
            rows={2} style={{ padding: '8px 12px', border: '1px solid #dfe1e6', borderRadius: 6, fontSize: 13, fontFamily: 'Nunito, sans-serif', resize: 'vertical' }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}
              style={{ padding: '8px 10px', border: '1px solid #dfe1e6', borderRadius: 6, fontSize: 13, fontFamily: 'Nunito, sans-serif' }}>
              {PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <select value={form.owner} onChange={e => setForm({ ...form, owner: e.target.value })}
              style={{ padding: '8px 10px', border: '1px solid #dfe1e6', borderRadius: 6, fontSize: 13, fontFamily: 'Nunito, sans-serif' }}>
              <option value="">Owner…</option>
              {TEAM.map(m => <option key={m.email} value={m.name}>{m.name}</option>)}
            </select>
            <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })}
              style={{ padding: '8px 10px', border: '1px solid #dfe1e6', borderRadius: 6, fontSize: 13, fontFamily: 'Nunito, sans-serif' }} />
            <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
              style={{ padding: '8px 10px', border: '1px solid #dfe1e6', borderRadius: 6, fontSize: 13, fontFamily: 'Nunito, sans-serif' }}>
              {PROJECT_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <div style={{ gridColumn: '1 / -1', padding: '10px 12px', background: '#f8f9fc', borderRadius: 8 }}>
              <AccessPicker isPrivate={form.is_private} members={form.members} owner={form.owner || userName}
                onChange={({ is_private, members }) => setForm({ ...form, is_private, members })} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#6b778c', display: 'block', marginBottom: 4 }}>Colour</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {PROJECT_COLORS.map(c => (
                  <div key={c} onClick={() => setForm({ ...form, color: c })}
                    style={{ width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer', border: form.color === c ? '3px solid #fff' : '2px solid transparent', boxShadow: form.color === c ? `0 0 0 2px ${c}` : 'none' }} />
                ))}
              </div>
            </div>
          </div>
          <button onClick={save} disabled={saving}
            style={{ background: form.color, color: '#fff', border: 'none', borderRadius: 6, padding: '11px 0', fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}>
            {saving ? 'Saving...' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  )
}
