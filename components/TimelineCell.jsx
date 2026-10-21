import { useState, useEffect, useRef } from 'react'
import CalendarPicker, { calendarSize } from './CalendarPicker'
import { useIsMobile } from '../lib/useIsMobile'

export default function TimelineCell({ startDate, dueDate, color, onSave }) {
  const [stage, setStage] = useState(null)   // null | 'start' | 'end'
  const [s, setS]         = useState(startDate || '')
  const [e, setE]         = useState(dueDate   || '')
  const anchorRef         = useRef()
  const [pos, setPos]     = useState(null)
  const savedStart        = useRef(startDate || '')
  const isMobile          = useIsMobile()

  useEffect(() => { if (!stage) { setS(startDate || ''); setE(dueDate || '') } }, [startDate, dueDate])

  const open = (which) => {
    const r = anchorRef.current?.getBoundingClientRect()
    // Keep the calendar on screen: clamp it to the right edge and open it upwards near the bottom.
    if (r) {
      const { w, h } = calendarSize(isMobile)
      const below = r.bottom + 4 + h <= window.innerHeight - 8
      setPos({ top: below ? r.bottom + 4 : Math.max(8, r.top - 4 - h), left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) })
    }
    savedStart.current = startDate || ''
    setStage(which)
  }

  // Abort mid-flow: revert s/e to last known prop values, close picker, do not save.
  const cancel = () => {
    setS(startDate || '')
    setE(dueDate || '')
    setStage(null)
  }

  const pickStart = (v) => {
    setS(v)
    savedStart.current = v
    setStage('end')
  }

  const pickEnd = (v) => {
    setE(v)
    setStage(null)
    onSave(savedStart.current, v)
  }

  const now = new Date()
  const over = e && new Date(e) < now
  const bar  = over ? '#de350b' : color || '#0052cc'
  let pct = 0
  if (s && e) {
    const sd = new Date(s), ed = new Date(e)
    pct = Math.round(Math.min(Math.max((now-sd)/Math.max(ed-sd,86400000),0),1)*100)
  }
  const fmt = (d) => d ? new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short'}) : null

  // Missing-date warning: if only one of start/due is populated (not mid-flow), flag visually
  const incomplete = !stage && ((s && !e) || (!s && e))

  return (
    <>
      <div ref={anchorRef} onClick={() => stage ? cancel() : open('start')}
        style={{ cursor: 'pointer', border: incomplete ? '1px dashed #de350b' : 'none', borderRadius: 4, padding: incomplete ? '2px 4px' : 0 }}
        title={incomplete ? 'Both start and due dates are required — click to set' : undefined}>
        {s||e ? (
          <div style={{display:'flex',flexDirection:'column',gap:3}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:4}}>
              <span style={{fontSize:10,fontWeight:700,color:stage==='start'?'var(--indigo)':'#6b778c'}}>{fmt(s)||<span style={{color:'#de350b'}}>Start*</span>}</span>
              <span style={{fontSize:10,fontWeight:700,color:over?'#de350b':stage==='end'?'var(--indigo)':'#6b778c'}}>{fmt(e)||<span style={{color:'#de350b'}}>End*</span>}</span>
            </div>
            <div style={{height:6,background:'#f0f1f3',borderRadius:3,overflow:'hidden'}}>
              <div style={{width:`${pct}%`,height:'100%',background:bar,borderRadius:3}}/>
            </div>
          </div>
        ) : <span style={{fontSize:10,color:'#c1c7d0',letterSpacing:'0.02em'}}>📅 click to set start &amp; end</span>}
      </div>
      {stage && pos && (
        <>
          {/* Backdrop: click anywhere outside picker → cancel + revert */}
          <div onClick={cancel}
            style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'transparent' }} />
          <div style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}>
            <CalendarPicker
              large={isMobile}
              value={stage === 'start' ? s : e}
              onChange={stage === 'start' ? pickStart : pickEnd}
              label={stage === 'start' ? '① Pick start date (both required)' : '② Pick end date (both required)'} />
          </div>
        </>
      )}
    </>
  )
}
