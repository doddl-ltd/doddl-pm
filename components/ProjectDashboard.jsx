import { TEAM } from '../lib/team'
import OwnerAvatar from './OwnerAvatar'
import { useIsMobile } from '../lib/useIsMobile'

export default function ProjectDashboard({ project, tasks, color }) {
  const isMobile = useIsMobile()
  const total = tasks.length
  const done = tasks.filter(t => t.status === 'done').length
  const inProgress = tasks.filter(t => t.status === 'in_progress' || t.status === 'on_track').length
  const blocked = tasks.filter(t => t.status === 'blocked' || t.status === 'at_risk').length
  const notStarted = tasks.filter(t => t.status === 'not_started').length
  const overdue = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done').length
  // Progress = mean of per-task progress, not done-count, so the bar reflects partial work.
  const pct = total ? Math.round(tasks.reduce((s, t) => s + (Number(t.progress) || 0), 0) / total) : 0
  const byAssignee = TEAM.map(m => ({ name: m.name, count: tasks.filter(t => t.assigned_to === m.name).length })).filter(m => m.count > 0)

  const Stat = ({ label, value, color: c, sub }) => (
    <div style={{ background: '#fff', borderRadius: 10, padding: isMobile ? '12px 14px' : '20px 24px', border: '1px solid #dfe1e6', flex: 1, minWidth: isMobile ? 'calc(50% - 6px)' : 0 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: '#6b778c', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{label}</p>
      <p style={{ fontSize: isMobile ? 24 : 32, fontWeight: 800, color: c || '#172b4d', marginBottom: 4 }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: '#6b778c' }}>{sub}</p>}
    </div>
  )

  return (
    <div style={{ padding: '0 0 24px 0' }}>
      {/* KPI row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
        <Stat label="Total Tasks" value={total} sub={`${pct}% complete`} />
        <Stat label="Done" value={done} color="#36b37e" sub="completed" />
        <Stat label="In Progress" value={inProgress} color="#0052cc" sub="active" />
        <Stat label="Blocked / At Risk" value={blocked} color="#de350b" sub="needs attention" />
        <Stat label="Overdue" value={overdue} color={overdue > 0 ? '#de350b' : '#6b778c'} sub="past due date" />
      </div>
      {/* Progress bar */}
      <div style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', border: '1px solid #dfe1e6', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <p style={{ fontWeight: 800, fontSize: 14, color: '#172b4d' }}>Overall Progress</p>
          <p style={{ fontWeight: 800, fontSize: 14, color: color }}>{pct}%</p>
        </div>
        <div style={{ height: 12, background: '#f0f1f3', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 6, transition: 'width 0.5s' }} />
        </div>
        <div style={{ display: 'flex', gap: isMobile ? '6px 14px' : 16, marginTop: 12, flexWrap: 'wrap' }}>
          {[['Not Started', notStarted, '#c1c7d0'], ['In Progress', inProgress, '#0052cc'], ['Done', done, '#36b37e'], ['Blocked', blocked, '#de350b']].map(([l, v, c]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: c }} />
              <span style={{ fontSize: 12, color: '#6b778c', fontWeight: 600 }}>{l}: {v}</span>
            </div>
          ))}
        </div>
      </div>
      {/* By assignee */}
      {byAssignee.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', border: '1px solid #dfe1e6' }}>
          <p style={{ fontWeight: 800, fontSize: 14, color: '#172b4d', marginBottom: 16 }}>Workload by Person</p>
          {byAssignee.map(({ name, count }) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <OwnerAvatar name={name} />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#172b4d', width: 80 }}>{name}</span>
              <div style={{ flex: 1, height: 8, background: '#f0f1f3', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${(count / total) * 100}%`, height: '100%', background: color, borderRadius: 4 }} />
              </div>
              <span style={{ fontSize: 12, color: '#6b778c', fontWeight: 600, width: 40, textAlign: 'right' }}>{count} task{count !== 1 ? 's' : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
