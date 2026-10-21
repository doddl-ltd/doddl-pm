// Phone bottom tab bar: the four places people go most, plus Menu (projects,
// approvals, new project, sign out). Sits above the iPhone home indicator.
export const MOBILE_NAV_H = 58

function Tab({ icon, label, active, count, onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', padding: '6px 2px 4px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, position: 'relative',
      color: active ? 'var(--indigo)' : '#6b778c', fontFamily: 'Nunito, sans-serif',
    }}>
      <span style={{ fontSize: 20, lineHeight: 1, filter: active ? 'none' : 'grayscale(0.6)', opacity: active ? 1 : 0.85 }}>{icon}</span>
      <span style={{ fontSize: 10.5, fontWeight: active ? 800 : 700, whiteSpace: 'nowrap' }}>{label}</span>
      {count > 0 && (
        <span style={{ position: 'absolute', top: 2, left: '50%', marginLeft: 6, background: '#de350b', color: '#fff', borderRadius: 9, fontSize: 10, fontWeight: 800, padding: '0 5px', minWidth: 17, height: 17, lineHeight: '17px', textAlign: 'center' }}>
          {count > 99 ? '99+' : count}
        </span>
      )}
      {active && <span style={{ position: 'absolute', top: 0, left: '30%', right: '30%', height: 3, borderRadius: '0 0 3px 3px', background: 'var(--indigo)' }} />}
    </button>
  )
}

export default function MobileNav({ view, onNavigate, onMenu, menuOpen, myFlowCount, triageCount, unreadCount }) {
  const on = (key) => !menuOpen && view === key
  return (
    <nav style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 400, background: '#fff', borderTop: '1px solid #dfe1e6',
      boxShadow: '0 -2px 10px rgba(23,43,77,0.06)', display: 'flex',
      height: `calc(${MOBILE_NAV_H}px + env(safe-area-inset-bottom))`, paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      <Tab icon="👤" label="My Work"  active={on('mywork')} count={myFlowCount} onClick={() => onNavigate('mywork')} />
      <Tab icon="📋" label="Projects" active={on('board')}  onClick={() => onNavigate('board')} />
      <Tab icon="📥" label="Triage"   active={on('triage')} count={triageCount} onClick={() => onNavigate('triage')} />
      <Tab icon="🔔" label="Alerts"   active={on('inbox')}  count={unreadCount} onClick={() => onNavigate('inbox')} />
      <Tab icon="☰"  label="Menu"     active={menuOpen || ['myprojects', 'approvals'].includes(view)} onClick={onMenu} />
    </nav>
  )
}
