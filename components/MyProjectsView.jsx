import { getProjectColor } from '../lib/team'
import OwnerAvatar from './OwnerAvatar'

const todayISO = () => new Date().toISOString().split('T')[0]

// My Projects — every project where the current user has at least one task
// assigned to them (via task.assigned_to matching userName). Click a card to
// navigate into the project detail view.
export default function MyProjectsView({ projects, visibleTasks, userName, setActiveProject }) {
  const uname = (userName || '').toLowerCase()
  // Collect the set of project IDs where any task has assigned_to = userName
  const myProjectIds = new Set(
    visibleTasks
      .filter(t => !t.is_group && t.project_id && t.assigned_to && t.assigned_to.toLowerCase() === uname)
      .map(t => t.project_id)
  )
  const mine = projects.filter(p => myProjectIds.has(p.id))

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontWeight: 800, fontSize: 18, color: 'var(--indigo)' }}>My Projects</h2>
          <p style={{ fontSize: 13, color: '#6b778c', fontWeight: 600, marginTop: 2 }}>Projects where you have at least one task assigned</p>
        </div>
        <div style={{ marginLeft: 'auto', background: '#f0f4ff', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 700, color: 'var(--indigo)' }}>
          {mine.length} project{mine.length !== 1 ? 's' : ''}
        </div>
      </div>

      {mine.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#6b778c' }}>
          <p style={{ fontSize: 32, marginBottom: 8 }}>📋</p>
          <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>No projects with tasks assigned to you</p>
          <p style={{ fontSize: 13 }}>When a task in a project is assigned to you, that project appears here</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 16 }}>
          {mine.map((project) => {
            const i = projects.findIndex(p => p.id === project.id)
            const pTasks   = visibleTasks.filter(t => t.project_id === project.id && !t.is_group)
            const myTasks  = pTasks.filter(t => t.assigned_to && t.assigned_to.toLowerCase() === uname)
            const total    = pTasks.length
            const done     = pTasks.filter(t => t.status === 'done').length
            const myTotal  = myTasks.length
            const myDone   = myTasks.filter(t => t.status === 'done').length
            const myOvd    = myTasks.filter(t => t.due_date && t.due_date < todayISO() && t.status !== 'done').length
            // pct = mean of per-task progress (partial work reflected), consistent with
            // ProjectSection / ProjectGallery / ProjectDashboard.
            const pct      = total   ? Math.round(pTasks.reduce((s, t) => s + (Number(t.progress) || 0), 0) / total)    : 0
            const myPct    = myTotal ? Math.round(myTasks.reduce((s, t) => s + (Number(t.progress) || 0), 0) / myTotal) : 0
            const color    = getProjectColor(project, i >= 0 ? i : 0)
            const prioMap  = { critical: '#de350b', high: '#ff8b00', medium: '#0052cc', low: '#6b778c' }
            const prioColor = prioMap[project.priority] || '#6b778c'
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    {project.owner && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <OwnerAvatar name={project.owner} />
                        <span style={{ fontSize: 11, color: '#6b778c', fontWeight: 600 }}>owner</span>
                      </div>
                    )}
                    {project.due_date && (
                      <span style={{ fontSize: 11, color: '#6b778c', background: '#f0f1f3', borderRadius: 6, padding: '2px 8px', marginLeft: 'auto' }}>
                        Due {new Date(project.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    )}
                  </div>
                  {/* Project-wide progress */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontSize: 11, color: '#6b778c', fontWeight: 600 }}>Project progress</span>
                      <span style={{ fontSize: 11, fontWeight: 800, color }}>{pct}%</span>
                    </div>
                    <div style={{ height: 6, background: '#f0f1f3', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.4s' }} />
                    </div>
                  </div>
                  {/* Your progress */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontSize: 11, color: '#6b778c', fontWeight: 600 }}>Your progress ({myDone}/{myTotal})</span>
                      <span style={{ fontSize: 11, fontWeight: 800, color: '#00875a' }}>{myPct}%</span>
                    </div>
                    <div style={{ height: 6, background: '#f0f1f3', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${myPct}%`, height: '100%', background: '#36b37e', borderRadius: 3, transition: 'width 0.4s' }} />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                    {[
                      { label: 'My tasks', value: myTotal, col: 'var(--indigo)', bg: '#f3eeff' },
                      { label: 'Done',     value: myDone,  col: '#00875a',       bg: '#e3fcef' },
                      { label: 'Overdue',  value: myOvd,   col: myOvd > 0 ? '#de350b' : '#6b778c', bg: myOvd > 0 ? '#ffebe6' : '#f0f1f3' },
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
      )}
    </>
  )
}
