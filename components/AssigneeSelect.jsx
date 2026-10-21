import { useRef, useState } from 'react'
import { TEAM } from '../lib/team'
import { useDropdownPosition } from '../lib/useDropdownPosition'
import { useIsMobile } from '../lib/useIsMobile'

const COLORS = ['#0052cc','#00875a','#de350b','#ff8b00','#6554c0','#00a3bf']
const colorFor = (name) => COLORS[name.charCodeAt(0) % COLORS.length]

// AssigneeSelect — clicking the pill opens the roster. Per UI #10, the pill
// displays the full first name (not a single-letter circle). The avatarOnly
// prop is retained for narrow contexts (project table 'Owner' column) but
// still renders the full name in a compact pill.
//
// Panel opens downward by default; flips upward when the pill is near the
// viewport footer (see lib/useDropdownPosition).
export default function AssigneeSelect({ value, onChange, avatarOnly }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef(null)
  const big = useIsMobile()   // phone: finger-sized options
  const pos = useDropdownPosition(anchorRef, open, { estimatedHeight: TEAM.length * (big ? 42 : 32) + 40 })

  return (
    <div style={{ position: 'relative' }} ref={anchorRef}>
      <div onClick={() => setOpen(o => !o)} title={value || 'Assign…'} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
        {value ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', background: colorFor(value), color: '#fff', fontWeight: 800, whiteSpace: 'nowrap', flexShrink: 0, height: avatarOnly ? 20 : 22, padding: avatarOnly ? '0 8px' : '0 10px', fontSize: avatarOnly ? 10 : 11, borderRadius: avatarOnly ? 10 : 11 }}>
            {value}
          </span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#f0f1f3', color: '#a0aec0', fontSize: 11, fontWeight: 700, height: avatarOnly ? 20 : 22, padding: '0 10px', borderRadius: avatarOnly ? 10 : 11, border: '1px dashed #c1c7d0' }}>
            + Assign
          </span>
        )}
      </div>
      {open && pos && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 998 }} onClick={() => setOpen(false)} />
          <div style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 999, background: '#fff', border: '1px solid #dfe1e6', borderRadius: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', minWidth: 160 }}>
            <div onClick={() => { onChange(''); setOpen(false) }}
              style={{ padding: big ? '11px 14px' : '6px 10px', cursor: 'pointer', fontSize: 12, color: '#6b778c' }}
              onMouseEnter={e => e.currentTarget.style.background = '#f4f5f7'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>Unassigned</div>
            {TEAM.map(m => (
              <div key={m.email} onClick={() => { onChange(m.name); setOpen(false) }}
                style={{ padding: big ? '11px 14px' : '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                onMouseEnter={e => e.currentTarget.style.background = '#f4f5f7'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ display: 'inline-flex', alignItems: 'center', background: colorFor(m.name), color: '#fff', fontWeight: 800, height: 20, padding: '0 8px', fontSize: 10, borderRadius: 10 }}>
                  {m.name}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
