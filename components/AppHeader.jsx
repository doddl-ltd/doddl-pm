import { useState } from 'react'

export const HEADER_H = 52

function Logo({ compact }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.5px' }}>doddl</span>
      <span style={{ color: 'var(--aqua)', fontWeight: 800, fontSize: 20 }}>.</span>
      {!compact && <span style={{ fontWeight: 600, fontSize: 13, opacity: 0.65, marginLeft: 8 }}>Project Management</span>}
      {compact && <span style={{ fontWeight: 700, fontSize: 13, opacity: 0.7, marginLeft: 4 }}>PM</span>}
    </div>
  )
}

const headerStyle = {
  background: 'var(--indigo)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 2px 8px rgba(61,21,125,0.3)',
}

// Phone header: logo, a search button that opens a full-width search field, and + Task.
// New project, sign out and the project list live in the Menu tab (AppSidebar as a drawer).
function MobileHeader({ search, setSearch, onAddTaskClick }) {
  const [searching, setSearching] = useState(!!search)
  const close = () => { setSearch(''); setSearching(false) }
  return (
    <header style={{ ...headerStyle, padding: 'env(safe-area-inset-top) 12px 0', height: `calc(${HEADER_H}px + env(safe-area-inset-top))`, gap: 10 }}>
      {searching ? (
        <>
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tasks..." type="search"
            style={{ flex: 1, minWidth: 0, padding: '8px 14px', borderRadius: 20, border: 'none', background: 'rgba(255,255,255,0.18)', color: '#fff', fontSize: 16, outline: 'none' }} />
          <button onClick={close} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', padding: '8px 4px' }}>Cancel</button>
        </>
      ) : (
        <>
          <Logo compact />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setSearching(true)} aria-label="Search tasks"
              style={{ width: 38, height: 38, borderRadius: 19, border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: 17, cursor: 'pointer' }}>⌕</button>
            <button onClick={onAddTaskClick} aria-label="New task"
              style={{ height: 38, borderRadius: 19, border: 'none', background: 'var(--aqua)', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer', padding: '0 14px' }}>+ Task</button>
          </div>
        </>
      )}
    </header>
  )
}

export default function AppHeader({ search, setSearch, userName, handleLogout, onAddTaskClick, onAddProjectClick, isMobile }) {
  if (isMobile) return <MobileHeader search={search} setSearch={setSearch} onAddTaskClick={onAddTaskClick} />
  return (
    <header style={{ ...headerStyle, padding: '0 20px', height: HEADER_H }}>
      <Logo />
      <div style={{ flex: 1, maxWidth: 320, margin: '0 24px' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tasks..."
          style={{ width: '100%', padding: '6px 12px', borderRadius: 20, border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: 13 }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onAddTaskClick}
          style={{ background: 'var(--aqua)', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>+ Task</button>
        <button onClick={onAddProjectClick}
          style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 6, padding: '6px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>+ Project</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ background: '#30BEAA', color: '#fff', fontWeight: 800, fontSize: 12, padding: '4px 12px', borderRadius: 11 }}>
            {userName || '?'}
          </span>
          <button onClick={handleLogout} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', fontSize: 11, borderRadius: 4, padding: '3px 8px', cursor: 'pointer', opacity: 0.7 }}>Sign out</button>
        </div>
      </div>
    </header>
  )
}
