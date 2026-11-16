import { useEffect, useState } from 'react'
import { SECTIONS, sectionOf, activeTab, REPORTS, HQ_LINKS, hubLink } from '../../lib/hq/sections'
import { SPLAT_VIEWBOX, SPLAT_PATH } from '../../lib/hq/splat'

// doddlHQ frame: purple section rail, the section's coloured header (with the doddl splat), folder tabs whose
// menus open on hover (website style), then the page. Phone: compact coloured header with scrolling tabs and a
// bottom bar. Design: https://claude.ai/artifact/Jk8JvgaJwiLGVwoQA1Xk6A (Jon 2026-11-16).
export const RAIL_W = 96

const CSS = `
.hq{--ink:#3D157D;color:var(--ink);font-family:'Nunito',sans-serif}
.hq a{color:inherit}
.hq-rail{position:fixed;left:0;top:0;bottom:0;width:${RAIL_W}px;background:#3D157D;display:flex;flex-direction:column;align-items:center;gap:2px;padding:16px 10px;z-index:200;overflow-y:auto}
.hq-ri{display:flex;flex-direction:column;align-items:center;gap:4px;padding:7px 0;width:76px;border-radius:18px;color:#fff;font-size:11px;font-weight:800;position:relative;background:none;border:0;cursor:pointer;font-family:inherit}
.hq-ri:hover .hq-ic{background:rgba(255,255,255,.12)}
.hq-ic{width:44px;height:44px;border-radius:14px;display:flex;align-items:center;justify-content:center;position:relative;transition:background .15s}
.hq-pip{position:absolute;right:3px;bottom:3px;width:9px;height:9px;border-radius:50%;border:2px solid #3D157D}
.hq-n{position:absolute;top:2px;right:8px;font-size:10.5px;font-weight:900;background:#dd6c92;color:#fff;border-radius:999px;padding:0 6px;min-width:18px;text-align:center;z-index:2;line-height:17px}
.hq-head{position:relative;z-index:50;padding:16px 40px 0}
.hq-tabs{position:relative;display:flex;align-items:flex-end;gap:6px;flex-wrap:wrap}
.hq-ft{display:inline-flex;align-items:center;gap:8px;min-height:46px;padding:0 22px;border-radius:16px 16px 0 0;font:800 15px 'Nunito',sans-serif;color:#3D157D;background:rgba(255,255,255,.55);border:0;cursor:pointer;transition:background .15s}
.hq-ft svg{transition:transform .15s;opacity:.65}
.hq-ti:hover .hq-ft,.hq-ti:focus-within .hq-ft{background:rgba(255,255,255,.92)}
.hq-ti.on .hq-ft{background:#fff;min-height:54px;font-weight:900;font-size:16px;box-shadow:inset 0 5px 0 var(--acc)}
.hq-ti:hover .hq-ft svg{transform:rotate(180deg);opacity:1}
.hq-mega{display:none;position:absolute;left:0;right:0;top:100%;z-index:60;background:#fff;color:#3D157D;border-radius:0 0 28px 28px;padding:22px 24px;box-shadow:0 26px 44px rgba(61,21,125,.2);cursor:default}
.hq-ti:hover .hq-mega,.hq-ti:focus-within .hq-mega{display:block}
.hq-mg{display:flex;align-items:center;gap:7px;margin:0 0 8px;font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}
.hq-mg i{width:10px;height:10px;border-radius:50%;display:block;border:1.5px solid #3D157D}
.hq-ml{display:block;width:100%;text-align:left;padding:7px 10px;margin:0 -10px;border-radius:12px;text-decoration:none;color:#3D157D;background:none;border:0;cursor:pointer;font-family:inherit}
.hq-ml:hover{background:#f2ece5}
.hq-ml b{display:block;font-size:14.5px;font-weight:900}
.hq-ml span{display:block;font-size:12.5px;font-weight:600;line-height:1.35}
.hq-feat{background:#3D157D;color:#fff;border-radius:22px 22px 22px 6px;padding:16px 16px 18px}
.hq-ask{display:flex;align-items:center;justify-content:center;width:100%;min-height:42px;margin-top:12px;border-radius:999px;background:#eec682;color:#3D157D;font:900 14px 'Nunito',sans-serif;border:0;cursor:pointer}
.hq-pill{display:inline-flex;align-items:center;min-height:40px;padding:0 18px;border-radius:999px;font:900 14px 'Nunito',sans-serif;border:2px solid #3D157D;cursor:pointer;white-space:nowrap}
.hq-mtabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:0 -12px;padding:0 12px}
.hq-mtabs::-webkit-scrollbar{display:none}
`

const chev = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
const Icon = ({ d, size = 22 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>

function Splat({ fill, mobile }) {
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <svg viewBox={SPLAT_VIEWBOX} style={{ position: 'absolute', right: mobile ? -70 : -50, top: mobile ? -60 : -110, width: mobile ? 220 : 400, transform: 'rotate(-16deg)' }}>
        <path d={SPLAT_PATH} fill={fill} />
      </svg>
    </div>
  )
}

function Logo() {
  return (
    <div style={{ width: 46, height: 46, borderRadius: '15px 15px 15px 5px', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', marginBottom: 14, flex: 'none' }}>
      <span style={{ color: '#3D157D', fontSize: 29, fontWeight: 900, marginTop: -4 }}>d</span>
      <span style={{ position: 'absolute', right: 6, top: 6, width: 8, height: 8, borderRadius: '50%', background: '#30BEAA' }} />
    </div>
  )
}

const MenuCol = ({ g, children }) => (
  <div style={{ minWidth: 0 }}>
    <p className="hq-mg"><i style={{ background: g.dot }} />{g.h}</p>
    {children}
  </div>
)

// The hover menu under a tab.
function Mega({ tab, nav, projects, programmes, openProject }) {
  if (tab.menu === 'reports') {
    const r = REPORTS[tab.sub]
    return (
      <div className="hq-mega" role="menu">
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${r.groups.length}, minmax(0, 1fr)) 240px`, gap: 22 }}>
          {r.groups.map((g) => (
            <MenuCol key={g.h} g={g}>
              {g.items.map(([t, path, line, fin]) => (
                <a key={path + t} className="hq-ml" href={hubLink(path)} role="menuitem"><b>{t}</b><span>{line}{fin ? ' · finance access' : ''}</span></a>
              ))}
            </MenuCol>
          ))}
          <div className="hq-feat">
            <p style={{ margin: 0, fontWeight: 900 }}>{r.label}</p>
            <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.45, color: '#e0daeb' }}>{r.blurb}</p>
            <button type="button" className="hq-ask" onClick={() => nav('requests', 'new')}>Ask for a new report</button>
          </div>
        </div>
      </div>
    )
  }
  if (tab.menu === 'hq') {
    const links = HQ_LINKS[tab.sub] || []
    return (
      <div className="hq-mega" role="menu">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '4px 22px' }}>
          {links.map(([t, path, line]) => <a key={path} className="hq-ml" href={hubLink(path)} role="menuitem"><b>{t}</b><span>{line}</span></a>)}
        </div>
      </div>
    )
  }
  if (tab.menu === 'projects') {
    const byProg = new Map(programmes.map((p) => [p.id, { h: p.name, dot: '#e8a5a9', items: [] }]))
    const other = { h: 'Other projects', dot: '#c0b5d8', items: [] }
    projects.forEach((p) => (byProg.get(p.programme_id) || other).items.push(p))
    const cols = [...byProg.values(), other].filter((c) => c.items.length).slice(0, 5)
    return (
      <div className="hq-mega" role="menu">
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(cols.length, 1)}, minmax(0, 1fr)) 220px`, gap: 22 }}>
          {cols.map((c) => (
            <MenuCol key={c.h} g={c}>
              {c.items.slice(0, 7).map((p) => <button key={p.id} type="button" className="hq-ml" role="menuitem" onClick={() => openProject(p.id)}><b>{p.is_private ? '🔒 ' : ''}{p.name}</b><span>{p.status || ''}</span></button>)}
              {c.items.length > 7 ? <button type="button" className="hq-ml" onClick={() => nav('board')}><span>+ {c.items.length - 7} more</span></button> : null}
            </MenuCol>
          ))}
          <div className="hq-feat">
            <p style={{ margin: 0, fontWeight: 900 }}>{projects.length} live projects</p>
            <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.45, color: '#e0daeb' }}>Open one, or see them all on the board.</p>
            <button type="button" className="hq-ask" onClick={() => nav('board')}>All projects</button>
          </div>
        </div>
      </div>
    )
  }
  return null
}

export default function HqShell({ view, sub, nav, userName, counts = {}, projects = [], programmes = [], openProject, onLogout, search, setSearch, isMobile, mainRightPad = 0, scrollKey, children }) {
  const sec = sectionOf(view)
  const tab = activeTab(view, sub)
  const [more, setMore] = useState(false)
  const badge = (k) => (k ? counts[k] || 0 : 0)
  const railBadge = { home: counts.unread, projects: counts.triage, approvals: counts.approvals, requests: counts.requests }
  // Hub reports and the HQ agent and data pages are pages at /hub on this address, shown in this same frame.
  const go = (t) => (t.href ? window.location.assign(t.href) : nav(t.view, t.sub))
  useEffect(() => { if (isMobile && typeof window !== 'undefined') window.scrollTo(0, 0) }, [isMobile, scrollKey])
  useEffect(() => { setMore(false) }, [view])

  const tabs = sec.tabs.map((t) => {
    const on = t.key === tab.key && t.view === tab.view
    const n = badge(t.badge)
    return (
      <div key={t.view + t.key} className={`hq-ti${on ? ' on' : ''}`}>
        <button type="button" className="hq-ft" onClick={() => go(t)} aria-current={on ? 'page' : undefined} style={isMobile ? { minHeight: on ? 46 : 42, padding: '0 16px', fontSize: 14, whiteSpace: 'nowrap' } : undefined}>
          {t.label}
          {n ? <span style={{ fontSize: 11.5, fontWeight: 900, background: '#dd6c92', color: '#fff', borderRadius: 999, padding: '1px 8px' }}>{n}</span> : null}
          {t.menu && !isMobile ? chev : null}
        </button>
        {t.menu && !isMobile ? <Mega tab={t} nav={nav} projects={projects} programmes={programmes} openProject={openProject} /> : null}
      </div>
    )
  })

  const title = sec.title(userName)
  const header = (
    <header className="hq-head" style={{ '--acc': sec.acc, background: sec.c, color: sec.ink, padding: isMobile ? 'calc(env(safe-area-inset-top) + 12px) 12px 0' : undefined }}>
      <Splat fill={sec.big} mobile={isMobile} />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontWeight: 900, fontSize: 14 }}>doddlHQ</span>
        <span style={{ flex: 1 }} />
        {!isMobile ? (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', color: '#3D157D', border: '2px solid #3D157D', borderRadius: 999, padding: '0 14px', minHeight: 42, width: 260 }}>
            <Icon d="M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM20 20l-4-4" size={17} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks" aria-label="Search tasks" style={{ border: 0, outline: 0, flex: 1, minWidth: 0, font: "700 14px 'Nunito', sans-serif", color: '#3D157D', background: 'transparent' }} />
          </label>
        ) : null}
        <button type="button" className="hq-pill" onClick={() => nav('requests', 'new')} style={sec.ink === '#fff' ? { background: '#eec682', color: '#3D157D' } : { background: '#3D157D', color: '#fff' }}>+ New request</button>
        {!isMobile ? <button type="button" className="hq-pill" onClick={onLogout} title="Sign out" style={{ background: '#fff', color: '#3D157D', padding: '0 14px' }}>{userName || 'Me'} · Sign out</button> : null}
      </div>
      <h1 style={{ position: 'relative', margin: isMobile ? '14px 0 2px' : '20px 0 4px', fontSize: isMobile ? 30 : 46, fontWeight: 900, lineHeight: 1.05 }}>{title}</h1>
      <p style={{ position: 'relative', margin: isMobile ? '0 0 14px' : '0 0 20px', fontSize: isMobile ? 14 : 16, fontWeight: 700, maxWidth: 760 }}>{sec.sub}</p>
      <div className={isMobile ? 'hq-mtabs' : 'hq-tabs'} style={isMobile ? { display: 'flex', alignItems: 'flex-end' } : undefined}>{tabs}</div>
    </header>
  )

  if (!isMobile) {
    return (
      <div className="hq">
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <nav className="hq-rail" aria-label="doddlHQ">
          <Logo />
          {SECTIONS.map((s) => {
            const on = s.key === sec.key
            const n = railBadge[s.key] || 0
            return (
              <button key={s.key} type="button" className="hq-ri" onClick={() => go(s.tabs[0])} aria-current={on ? 'page' : undefined}>
                {n ? <span className="hq-n">{n > 99 ? '99+' : n}</span> : null}
                <span className="hq-ic" style={on ? { background: s.key === 'approvals' ? '#fff' : s.c, color: '#3D157D' } : undefined}>
                  <Icon d={s.icon} />
                  {on ? null : <i className="hq-pip" style={{ background: s.pip || s.c }} />}
                </span>
                {s.label}
              </button>
            )
          })}
        </nav>
        <div style={{ marginLeft: RAIL_W, height: '100vh', display: 'flex', flexDirection: 'column', background: '#fff' }}>
          {header}
          <main style={{ flex: 1, overflowY: 'auto', padding: '24px 40px 40px', marginRight: mainRightPad, background: '#fff' }}>{children}</main>
        </div>
      </div>
    )
  }

  const bar = SECTIONS.slice(0, 5)
  return (
    <div className="hq">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {header}
      <main style={{ padding: '14px 12px calc(86px + env(safe-area-inset-bottom))', minWidth: 0, background: '#fff' }}>{children}</main>
      {more ? (
        <div role="dialog" aria-label="More" style={{ position: 'fixed', left: 0, right: 0, bottom: 'calc(64px + env(safe-area-inset-bottom))', background: '#fff', borderRadius: '24px 24px 0 0', boxShadow: '0 -12px 30px rgba(61,21,125,.2)', padding: 16, zIndex: 300, display: 'grid', gap: 8 }}>
          {SECTIONS.slice(5).map((s) => (
            <button key={s.key} type="button" onClick={() => go(s.tabs[0])} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, padding: '0 14px', borderRadius: 16, border: 0, background: s.c, color: s.ink, font: "900 15px 'Nunito', sans-serif", cursor: 'pointer' }}>
              <Icon d={s.icon} size={20} />{s.label}
            </button>
          ))}
          <button type="button" onClick={onLogout} style={{ minHeight: 44, borderRadius: 999, border: '2px solid #3D157D', background: '#fff', color: '#3D157D', font: "900 14px 'Nunito', sans-serif" }}>Sign out {userName ? `(${userName})` : ''}</button>
        </div>
      ) : null}
      <nav aria-label="doddlHQ" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 310, background: '#3D157D', display: 'flex', height: 'calc(64px + env(safe-area-inset-bottom))', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {[...bar, { key: 'more', label: 'More', icon: 'M4 6h16M4 12h16M4 18h16', c: '#fff' }].map((s) => {
          const on = s.key === 'more' ? more : !more && s.key === sec.key
          const n = railBadge[s.key] || 0
          return (
            <button key={s.key} type="button" onClick={() => (s.key === 'more' ? setMore((m) => !m) : go(s.tabs[0]))} style={{ flex: 1, minWidth: 0, background: 'none', border: 0, color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, font: "800 10.5px 'Nunito', sans-serif", position: 'relative', cursor: 'pointer' }}>
              <span style={{ width: 38, height: 32, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? (s.key === 'approvals' || s.key === 'more' ? '#fff' : s.c) : 'transparent', color: on ? '#3D157D' : '#fff' }}><Icon d={s.icon} size={19} /></span>
              {s.label}
              {n ? <span style={{ position: 'absolute', top: 4, left: '50%', marginLeft: 8, background: '#dd6c92', color: '#fff', borderRadius: 9, fontSize: 10, fontWeight: 900, padding: '0 5px', lineHeight: '16px' }}>{n > 99 ? '99+' : n}</span> : null}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
