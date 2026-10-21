import { useEffect, useState } from 'react'
import AppHeader, { HEADER_H } from './AppHeader'
import AppSidebar from './AppSidebar'
import MobileNav, { MOBILE_NAV_H } from './MobileNav'

// The signed-in frame around every view.
//   Desktop: header, resizable sidebar, scrolling main column (room kept for the task panel).
//   Phone:   compact header, the page itself scrolls, bottom tab bar, sidebar as a drawer.
export default function AppShell({ isMobile, header, sidebar, onNavigate, mainRightPad = 0, scrollKey, children }) {
  const [menuOpen, setMenuOpen] = useState(false)

  // A new screen starts at the top on a phone (the page scrolls, not an inner box).
  useEffect(() => { if (isMobile && typeof window !== 'undefined') window.scrollTo(0, 0) }, [isMobile, scrollKey])
  useEffect(() => { if (!isMobile) setMenuOpen(false) }, [isMobile])

  if (!isMobile) {
    return (
      <>
        <AppHeader {...header} />
        <div style={{ display: 'flex', height: `calc(100vh - ${HEADER_H}px)` }}>
          <AppSidebar {...sidebar} />
          <main style={{ flex: 1, overflowY: 'auto', padding: 20, marginRight: mainRightPad }}>
            {children}
          </main>
        </div>
      </>
    )
  }

  return (
    <>
      <AppHeader {...header} isMobile />
      <main style={{ padding: `12px 12px calc(${MOBILE_NAV_H + 20}px + env(safe-area-inset-bottom))`, minWidth: 0 }}>
        {children}
      </main>
      <MobileNav view={sidebar.view} menuOpen={menuOpen}
        onNavigate={(key) => { setMenuOpen(false); onNavigate(key) }}
        onMenu={() => setMenuOpen(o => !o)}
        myFlowCount={sidebar.myFlowCount} triageCount={sidebar.triageCount} unreadCount={sidebar.unreadCount} />
      <AppSidebar {...sidebar} drawer open={menuOpen} onClose={() => setMenuOpen(false)}
        userName={header.userName} onAddProject={header.onAddProjectClick} onLogout={header.handleLogout} />
    </>
  )
}
