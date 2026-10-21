import { useRef, useState } from 'react'
import { PRIORITIES, priorityMap } from '../lib/constants'
import { useDropdownPosition } from '../lib/useDropdownPosition'
import { useIsMobile } from '../lib/useIsMobile'

export default function PriorityBadge({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef(null)
  const big = useIsMobile()   // phone: finger-sized options
  const pos = useDropdownPosition(anchorRef, open, { estimatedHeight: PRIORITIES.length * (big ? 42 : 32) + 10 })
  const p = priorityMap[value] || PRIORITIES[2]
  return (
    <div style={{ position: 'relative' }} ref={anchorRef}>
      <div onClick={() => onChange && setOpen(o => !o)} style={{ color: p.color, fontSize: 11, fontWeight: 700, cursor: onChange ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color }} />{p.label}
      </div>
      {open && pos && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 998 }} onClick={() => setOpen(false)} />
          <div style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 999, background: '#fff', border: '1px solid #dfe1e6', borderRadius: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', minWidth: 120 }}>
            {PRIORITIES.map(pr => (
              <div key={pr.key} onClick={() => { onChange(pr.key); setOpen(false) }} style={{ padding: big ? '11px 14px' : '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                onMouseEnter={e => e.currentTarget.style.background = '#f4f5f7'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: pr.color }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: pr.color }}>{pr.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
