import { REPORTS, HQ_LINKS, hubLink } from '../../lib/hq/sections'

// doddlHQ pages that are new (Home, the Reports directory, the HQ links). Everything else is an existing PM view.
const ink = '#3D157D'
const sec = { margin: '0 0 12px', fontSize: 18, fontWeight: 900, color: ink }
const card = { background: '#f2ece5', borderRadius: '24px 24px 24px 6px', padding: '16px 18px', minWidth: 0 }
const Grid = ({ min = 240, gap = 20, children, style }) => <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap, ...style }}>{children}</div>

function Stat({ label, n, line, onClick, tone }) {
  return (
    <button type="button" onClick={onClick} style={{ textAlign: 'left', border: 0, cursor: 'pointer', borderRadius: '24px 24px 24px 6px', padding: '16px 18px', background: tone || '#f2ece5', color: ink, fontFamily: 'inherit' }}>
      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</span>
      <span style={{ display: 'block', fontSize: 40, fontWeight: 900, lineHeight: 1.1, margin: '4px 0 2px' }}>{n}</span>
      <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{line}</span>
    </button>
  )
}

const fmtDue = (d) => {
  if (!d) return 'No date'
  const days = Math.round((new Date(d + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000)
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} late`
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function HomeView({ userName, visibleTasks = [], projects = [], counts = {}, nav, setSelectedTask }) {
  const me = (userName || '').toLowerCase()
  const mine = visibleTasks.filter((t) => !t.is_group && t.status !== 'done' && t.assigned_to?.toLowerCase() === me)
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999')).slice(0, 8)
  const proj = (id) => projects.find((p) => p.id === id)?.name || ''
  const late = mine.filter((t) => t.due_date && fmtDue(t.due_date).includes('late')).length
  return (
    <div style={{ maxWidth: 1180, display: 'flex', flexDirection: 'column', gap: 28 }}>
      <Grid min={200} gap={16}>
        <Stat label="Approvals" n={counts.approvals || 0} line="Waiting on you" tone="#e0daeb" onClick={() => nav('approvals')} />
        <Stat label="My open tasks" n={counts.mine || 0} line={late ? `${late} late` : 'None late'} tone={late ? '#e8a5a9' : '#f2ece5'} onClick={() => nav('mywork')} />
        <Stat label="Triage" n={counts.triage || 0} line="New items to sort" onClick={() => nav('triage')} />
        <Stat label="Notifications" n={counts.unread || 0} line="Unread" onClick={() => nav('inbox')} />
      </Grid>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'flex-start' }}>
        <section style={{ flex: '2 1 480px', minWidth: 0 }}>
          <p style={sec}>My next tasks</p>
          {mine.length ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', color: ink }}>
              <thead><tr>{['Task', 'Project', 'Due'].map((h) => <th key={h} style={{ fontSize: 11.5, fontWeight: 900, letterSpacing: '.06em', textTransform: 'uppercase', textAlign: 'left', padding: '10px 12px 10px 0', borderBottom: `2px solid ${ink}` }}>{h}</th>)}</tr></thead>
              <tbody>
                {mine.map((t) => (
                  <tr key={t.id} onClick={() => setSelectedTask(t)} style={{ cursor: 'pointer' }}>
                    <td style={{ padding: '12px 12px 12px 0', borderBottom: '1.5px solid #EAEAEA', fontWeight: 900, fontSize: 14.5 }}>{t.title}</td>
                    <td style={{ padding: '12px 12px 12px 0', borderBottom: '1.5px solid #EAEAEA', fontSize: 13.5 }}>{proj(t.project_id)}</td>
                    <td style={{ padding: '12px 0', borderBottom: '1.5px solid #EAEAEA', fontSize: 13.5, fontWeight: 800, whiteSpace: 'nowrap' }}>{fmtDue(t.due_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ ...card, margin: 0, fontWeight: 700 }}>Nothing open is assigned to you.</p>}
        </section>
        <section style={{ flex: '1 1 260px', background: ink, color: '#fff', borderRadius: '24px 24px 24px 6px', padding: '18px 20px' }}>
          <p style={{ margin: '0 0 10px', fontSize: 18, fontWeight: 900 }}>Jump to</p>
          {[['Ask for something', () => nav('requests', 'new'), '#eec682'], ['Daily read', hubLink('/hub'), '#9ecfc6'], ['All projects', () => nav('board'), '#e8a5a9'], ['Content calendar', () => nav('calendar'), '#30BEAA']].map(([l, a, c]) => (
            typeof a === 'string'
              ? <a key={l} href={a} target="_blank" rel="noreferrer" style={{ display: 'block', padding: '11px 0', borderTop: '1.5px solid #947FB6', color: '#fff', textDecoration: 'none', fontWeight: 900, fontSize: 15 }}><span style={{ color: c }}>●</span> {l} ›</a>
              : <button key={l} type="button" onClick={a} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '11px 0', border: 0, borderTop: '1.5px solid #947FB6', background: 'none', color: '#fff', fontWeight: 900, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit' }}><span style={{ color: c }}>●</span> {l} ›</button>
          ))}
        </section>
      </div>
    </div>
  )
}

// Reports: the directory for one tab (every Hub report, grouped, with one line each). Reports open in the Hub.
export function ReportsView({ tab = 'dashboard', nav }) {
  const r = REPORTS[tab] || REPORTS.dashboard
  if (tab === 'mine') {
    return (
      <div style={{ maxWidth: 1180, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ ...card, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <p style={{ margin: 0, flex: '1 1 320px', fontSize: 15, fontWeight: 700, lineHeight: 1.5 }}>Reports made for you live in Standing work once their finished version is approved. Ask for a new one, one-off or ongoing, and HQ plans it for you to approve first.</p>
          <button type="button" onClick={() => nav('requests', 'standing')} className="hq-pill" style={{ background: '#fff', color: ink }}>Standing work</button>
          <button type="button" onClick={() => nav('requests', 'new')} className="hq-pill" style={{ background: ink, color: '#fff' }}>Ask for a report</button>
        </div>
      </div>
    )
  }
  return (
    <div style={{ maxWidth: 1180, display: 'flex', flexDirection: 'column', gap: 26 }}>
      <p style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{r.blurb} Each report opens in the Hub.</p>
      {r.groups.map((g) => (
        <section key={g.h}>
          <p style={{ ...sec, display: 'flex', alignItems: 'center', gap: 8 }}><i style={{ width: 12, height: 12, borderRadius: '50%', background: g.dot, display: 'block' }} />{g.h}</p>
          <Grid min={230} gap={14}>
            {g.items.map(([t, path, line, fin]) => (
              <a key={path + t} href={hubLink(path)} target="_blank" rel="noreferrer" style={{ ...card, display: 'block', textDecoration: 'none', color: ink }}>
                <span style={{ display: 'block', fontSize: 16, fontWeight: 900 }}>{t} ›</span>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, marginTop: 4 }}>{line}</span>
                {fin ? <span style={{ display: 'inline-block', marginTop: 8, fontSize: 11.5, fontWeight: 900, background: '#fff', borderRadius: 999, padding: '2px 10px' }}>Finance access</span> : null}
              </a>
            ))}
          </Grid>
        </section>
      ))}
    </div>
  )
}

// HQ: the agent and data pages, which live in the Hub today.
export function HqLinksView({ tab = 'agents' }) {
  const links = HQ_LINKS[tab] || HQ_LINKS.agents
  return (
    <div style={{ maxWidth: 1180, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <p style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{tab === 'agents' ? 'Agents are switched on and off, with a reason, in the Hub’s control room.' : 'Where every number comes from, and whether it is fresh.'} These pages open in the Hub.</p>
      <Grid min={240} gap={14}>
        {links.map(([t, path, line]) => (
          <a key={path} href={hubLink(path)} target="_blank" rel="noreferrer" style={{ ...card, display: 'block', textDecoration: 'none', color: ink }}>
            <span style={{ display: 'block', fontSize: 16, fontWeight: 900 }}>{t} ›</span>
            <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, marginTop: 4 }}>{line}</span>
          </a>
        ))}
      </Grid>
    </div>
  )
}
