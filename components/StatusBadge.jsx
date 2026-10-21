import { useRef, useState } from 'react'
import { STATUSES, statusMap } from '../lib/constants'
import { useDropdownPosition } from '../lib/useDropdownPosition'
import { useIsMobile } from '../lib/useIsMobile'

export default function StatusBadge({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef(null)
  const big = useIsMobile()   // phone: finger-sized options
  const pos = useDropdownPosition(anchorRef, open, { estimatedHeight: STATUSES.length * (big ? 42 : 32) + 10 })
  const s = statusMap[value] || STATUSES[0]
  const handleChange = (key) => {
    setOpen(false)
    onChange(key)
  }
  return (
    <div style={{ position: 'relative' }} ref={anchorRef}>
      <div onClick={() => onChange && setOpen(o => !o)} style={{ background: s.color, color: '#fff', borderRadius: 3, padding: '3px 8px', fontSize: 11, fontWeight: 700, cursor: onChange ? 'pointer' : 'default', whiteSpace: 'nowrap', textAlign: 'center' }}>{s.label}</div>
      {open && pos && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 998 }} onClick={() => setOpen(false)} />
          <div style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 999, background: '#fff', border: '1px solid #dfe1e6', borderRadius: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', minWidth: 140 }}>
            {STATUSES.map(st => (
              <div key={st.key} onClick={() => handleChange(st.key)} style={{ padding: big ? '11px 14px' : '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                onMouseEnter={e => e.currentTarget.style.background = '#f4f5f7'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: st.color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 600 }}>{st.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
