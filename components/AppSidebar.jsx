import { useState, useEffect, useRef } from 'react'
import { getProjectColor } from '../lib/team'

const MIN_W = 160, MAX_W = 420, DEFAULT_W = 210, STORAGE_KEY = 'doddl-pm-sidebar-width'

function NavBtn({ view, setView, activeKey, label, count, big }) {
  return (
    <button onClick={() => setView(activeKey)} style={{
      display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
      padding: big ? '11px 14px' : '7px 12px', borderRadius: big ? 8 : 6, border: 'none', cursor: 'pointer',
      fontFamily: 'Nunito, sans-serif', fontWeight: big ? 700 : 600, fontSize: big ? 15 : 13, marginBottom: 2,
      background: view === activeKey ? '#e9f2ff' : 'transparent', color: view === activeKey ? '#0052cc' : '#42526e',
    }}>
      {label}
      {count > 0 && <span style={{ background: '#de350b', color: '#fff', borderRadius: 10, fontSize: big ? 11 : 10, fontWeight: 700, padding: '1px 6px' }}>{count}</span>}
    </button>
  )
}

// [{ id, name, projects: [{ p, i }] }] — programmes in order, then projects with no programme.
// `i` is the project's index in the full list so colours stay the same as before.
function groupByProgramme(projects, programmes) {
  const groups = programmes.map(pr => ({ id: pr.id, name: pr.name, projects: [] }))
  const byId = new Map(groups.map(g => [g.id, g]))
  const other = { id: 'other', name: groups.length ? 'Other projects' : null, projects: [] }
  projects.forEach((p, i) => (byId.get(p.programme_id) || other).projects.push({ p, i }))
  return [...groups.filter(g => g.projects.length), ...(other.projects.length ? [other] : [])]
}

function SidebarContent({ view, setView, projects, programmes, activeProject, setActiveProject, myFlowCount, unreadCount, approvalsCount, triageCount, big }) {
  const projBtn = (active) => ({
    width: '100%', textAlign: 'left', padding: big ? '10px 14px' : '6px 12px', borderRadius: big ? 8 : 6, border: 'none', cursor: 'pointer',
    fontFamily: 'Nunito, sans-serif', fontWeight: 600, fontSize: big ? 14 : 12, marginBottom: 2,
    background: active ? '#e9f2ff' : 'transparent', color: active ? '#0052cc' : '#42526e',
  })
  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <NavBtn big={big} view={view} setView={setView} activeKey="mywork"     label="👤 My Work"       count={myFlowCount} />
        <NavBtn big={big} view={view} setView={setView} activeKey="myprojects" label="📌 My Projects"   count={0} />
        <NavBtn big={big} view={view} setView={setView} activeKey="board"      label="📋 All Projects"  count={0} />
        <NavBtn big={big} view={view} setView={setView} activeKey="triage"     label="📥 Triage"        count={triageCount} />
        <NavBtn big={big} view={view} setView={setView} activeKey="approvals"  label="✅ Approvals"     count={approvalsCount} />
        <NavBtn big={big} view={view} setView={setView} activeKey="inbox"      label="🔔 Notifications" count={unreadCount} />
      </div>
      <p style={{ fontSize: 10, fontWeight: 700, color: '#a0aec0', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 12px', marginBottom: 6 }}>Projects</p>
      <button onClick={() => setActiveProject(null)} style={projBtn(view === 'board' && !activeProject)}>All projects</button>
      {/* Projects grouped by programme (programmes mirror claude.ai Projects / agents; Claude keeps them in step) */}
      {groupByProgramme(projects, programmes).map(group => (
        <div key={group.id} style={{ marginBottom: 6 }}>
          {group.name && <p style={{ fontSize: big ? 11 : 10, fontWeight: 800, color: '#6b778c', padding: '6px 12px 2px', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.name}</p>}
          {group.projects.map(({ p, i }) => (
            <button key={p.id} onClick={() => setActiveProject(p.id)} style={{ ...projBtn(activeProject === p.id), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: getProjectColor(p, i), flexShrink: 0 }} />{p.is_private ? '🔒 ' : ''}{p.name}
            </button>
          ))}
        </div>
      ))}
    </>
  )
}

// Phone: the sidebar as a slide-in drawer (opened from the Menu tab). Picking anything
// closes it; it also holds New project and Sign out, which the phone header leaves out.
function SidebarDrawer({ open, onClose, userName, onAddProject, onLogout, ...rest }) {
  const close = (fn) => (...args) => { fn(...args); onClose() }
  return (
    <>
      <div onClick={onClose} aria-hidden="true"
        style={{ position: 'fixed', inset: 0, zIndex: 450, background: 'rgba(23,43,77,0.45)', opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none', transition: 'opacity 160ms ease' }} />
      <aside aria-hidden={!open} style={{
        position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 460, width: 'min(86vw, 320px)', background: '#fff',
        transform: open ? 'translateX(0)' : 'translateX(-104%)', visibility: open ? 'visible' : 'hidden',
        transition: open ? 'transform 200ms ease' : 'transform 200ms ease, visibility 0s linear 200ms',
        boxShadow: open ? '4px 0 24px rgba(0,0,0,0.18)' : 'none', display: 'flex', flexDirection: 'column',
        paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 14px 12px', borderBottom: '1px solid #f0f1f3' }}>
          <span style={{ background: '#30BEAA', color: '#fff', fontWeight: 800, fontSize: 13, padding: '5px 12px', borderRadius: 12 }}>{userName || '?'}</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} aria-label="Close menu" style={{ background: 'none', border: 'none', fontSize: 26, lineHeight: 1, color: '#6b778c', cursor: 'pointer', padding: '0 4px' }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 8px', WebkitOverflowScrolling: 'touch' }}>
          <SidebarContent {...rest} big setView={close(rest.setView)} setActiveProject={close(rest.setActiveProject)} />
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '10px 12px 12px', borderTop: '1px solid #f0f1f3' }}>
          <button onClick={close(onAddProject)} style={{ flex: 1, background: 'var(--indigo)', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 0', fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}>+ New project</button>
          <button onClick={onLogout} style={{ background: '#fff', color: '#42526e', border: '1px solid #dfe1e6', borderRadius: 8, padding: '11px 14px', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}>Sign out</button>
        </div>
      </aside>
    </>
  )
}

export default function AppSidebar(props) {
  if (props.drawer) return <SidebarDrawer {...props} />
  return <DesktopSidebar {...props} />
}

function DesktopSidebar(props) {
  const [width, setWidth] = useState(DEFAULT_W)
  const dragging = useRef(false)

  // Restore persisted width
  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const n = Number(raw)
    if (Number.isFinite(n) && n >= MIN_W && n <= MAX_W) setWidth(n)
  }, [])

  // Drag-to-resize on the right edge
  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return
      const w = Math.min(MAX_W, Math.max(MIN_W, e.clientX))
      setWidth(w)
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, String(width))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [width])

  const startDrag = (e) => {
    e.preventDefault()
    dragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <aside style={{ width, background: '#fff', borderRight: '1px solid #dfe1e6', padding: '16px 8px', overflowY: 'auto', flexShrink: 0, position: 'relative' }}>
      <SidebarContent {...props} />
      {/* Drag handle (UI #7) */}
      <div onMouseDown={startDrag} title="Drag to resize"
        style={{ position: 'absolute', top: 0, right: -3, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 50 }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(61,21,125,0.15)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'} />
    </aside>
  )
}
