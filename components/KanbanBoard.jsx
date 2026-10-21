import { supabase } from '../lib/supabase'
import { STATUSES, PRIORITIES, priorityMap } from '../lib/constants'
import OwnerAvatar from './OwnerAvatar'
import { useIsMobile } from '../lib/useIsMobile'

export default function KanbanBoard({ tasks, project, onSelect, onUpdate, onPatch, onAddTask }) {
  const isMobile = useIsMobile()
  const cols = STATUSES.map(s => ({ ...s, tasks: tasks.filter(t => t.status === s.key && !t.is_group) }))
  return (
    <div className={isMobile ? 'scroll-x' : undefined} style={{ display: 'flex', gap: isMobile ? 10 : 12, overflowX: 'auto', paddingBottom: 16, paddingTop: 12, scrollSnapType: isMobile ? 'x mandatory' : 'none' }}>
      {cols.map(col => (
        <div key={col.key} style={{ minWidth: isMobile ? '78vw' : 240, maxWidth: isMobile ? '78vw' : 'none', flexShrink: 0, scrollSnapAlign: 'start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#f8f9fc', borderRadius: '6px 6px 0 0', borderTop: `3px solid ${col.color}`, borderLeft: '1px solid #dfe1e6', borderRight: '1px solid #dfe1e6', borderBottom: '1px solid #dfe1e6' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.color }} />
            <span style={{ fontWeight: 700, fontSize: 11, color: '#172b4d', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{col.label}</span>
            <span style={{ marginLeft: 'auto', background: '#e5e7eb', borderRadius: 8, fontSize: 10, fontWeight: 700, padding: '1px 6px', color: '#42526e' }}>{col.tasks.length}</span>
          </div>
          <div style={{ background: '#f8f9fc', border: '1px solid #dfe1e6', borderTop: 'none', borderRadius: '0 0 6px 6px', minHeight: 80, padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {col.tasks.map(task => {
              const prio = priorityMap[task.priority] || PRIORITIES[2]
              const isOverdue = task.due_date && new Date(task.due_date) < new Date()
              return (
                <div key={task.id} onClick={() => onSelect(task)} style={{ background: '#fff', borderRadius: 6, padding: '10px 12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: `1px solid #e5e7eb`, cursor: 'pointer', borderLeft: `3px solid ${col.color}` }}
                  onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'}
                  onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)'}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#172b4d', marginBottom: 8, lineHeight: 1.4 }}>{task.title}</p>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: prio.color }}>● {prio.label}</span>
                    {task.due_date && <span style={{ fontSize: 10, fontWeight: 600, color: isOverdue ? '#de350b' : '#6b778c', background: isOverdue ? '#ffebe6' : '#f0f1f3', borderRadius: 4, padding: '2px 6px' }}>{isOverdue ? '⚠ ' : ''}{new Date(task.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
                  </div>
                  {task.assigned_to && <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}><OwnerAvatar name={task.assigned_to} /><span style={{ fontSize: 11, color: '#42526e' }}>{task.assigned_to}</span></div>}
                  <div style={{ display: 'flex', gap: 3, marginTop: 8, flexWrap: 'wrap' }}>
                    {STATUSES.filter(s => s.key !== col.key).slice(0, 2).map(s => (
                      <button key={s.key} onClick={async e => { e.stopPropagation(); if (onPatch) onPatch(task.id, { status: s.key }); await supabase.from('tasks').update({ status: s.key }).eq('id', task.id); onUpdate() }}
                        style={{ fontSize: isMobile ? 11 : 9, padding: isMobile ? '5px 8px' : '2px 5px', borderRadius: isMobile ? 5 : 3, border: `1px solid ${s.color}`, background: 'transparent', color: s.color, cursor: 'pointer', fontFamily: 'Nunito, sans-serif', fontWeight: 700 }}>→ {s.label}</button>
                    ))}
                  </div>
                </div>
              )
            })}
            <button onClick={() => onAddTask(project.id)} style={{ background: 'none', border: '2px dashed #dfe1e6', borderRadius: 6, padding: '6px', fontSize: 11, color: '#6b778c', cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}>+ Add task</button>
          </div>
        </div>
      ))}
    </div>
  )
}
