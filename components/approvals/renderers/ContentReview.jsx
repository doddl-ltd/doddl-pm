// Amazon content review (artefact_type content_review, migration 42): an A+ page or one store of a product for Jon and
// Laura. Jon 2026-11-17: "everything is massive. Scale it down for the user to actually see what likely on a screen - it
// should show as if in a desktop & mobile experience, not just massive graphics". So the A+ panels show stacked as
// Amazon shows them, in a desktop browser frame and in a phone frame at true proportions, and the answers sit in a
// compact list underneath: a small thumbnail and a tick per piece. Unticked pieces go back (lines[id] = 'rejected');
// say why in the comments. What happens on approval is in lib/pm/contentReview.js (afterContentDecision).
import { useEffect, useState } from 'react'
import { C, Panel, H2, Note, Tick, Chip, Pill, Pills, PhoneFrame } from './reviewKit'

const isTicked = (v) => v === 'approved'
const cap = { fontSize: 11.5, fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: '.02em' }

/** Panels stacked edge to edge, as Amazon's "From the brand" section. Unticked ones are marked. */
function Stack({ panels, state, sel, onSel }) {
  return panels.map(s => {
    const back = !isTicked(state(s.id))
    return (
      <button key={s.id} type="button" onClick={() => onSel(s.id)} title={s.label}
        style={{ display: 'block', position: 'relative', width: '100%', padding: 0, border: 0, background: 'none', cursor: 'pointer', outline: sel === s.id ? `3px solid ${C.indigo}` : 'none', outlineOffset: -3 }}>
        {s.url ? <img src={s.url} alt={s.text || s.label} loading="lazy" style={{ width: '100%', display: 'block' }} /> : <div style={{ aspectRatio: '970 / 600', background: C.grey }} />}
        {back ? <span style={{ position: 'absolute', inset: 0, background: 'rgba(161,43,43,.35)', color: '#fff', font: "800 12px 'Nunito', sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Sent back</span> : null}
      </button>
    )
  })
}

function Desktop({ children, width }) {
  return (
    <div style={{ width, maxWidth: '100%', flex: 'none', border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', background: '#fff', boxShadow: '0 2px 10px rgba(25,14,62,.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', background: C.grey, borderBottom: `1px solid ${C.line}` }}>
        {[0, 1, 2].map(i => <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: C.border }} />)}
        <span style={{ marginLeft: 8, flex: 1, background: '#fff', borderRadius: 6, padding: '2px 8px', fontSize: 10.5, color: C.faint }}>amazon.co.uk</span>
      </div>
      <div style={{ padding: '10px 14% 14px' }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#0F1111', margin: '0 0 6px' }}>From the brand</div>
        {children}
      </div>
    </div>
  )
}

function Phone({ children, width }) {
  return (
    <PhoneFrame width={width}>
      <div style={{ padding: '6px 8px', fontSize: 10, fontWeight: 800, color: '#0F1111', borderBottom: `1px solid ${C.line}` }}>From the brand</div>
      <div style={{ maxHeight: 520, overflowY: 'auto' }}>{children}</div>
    </PhoneFrame>
  )
}

/** One compact answer row: small picture (or the words), label, tick. */
function Row({ s, ticked, onTick, readOnly, sel, onSel }) {
  const img = s.kind === 'image'
  return (
    <div onClick={() => onSel && onSel(s.id)} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', borderTop: `1px solid ${C.line2}`, background: sel === s.id ? C.soft : ticked ? '#fff' : C.badBg }}>
      {img ? (
        <span style={{ display: 'flex', gap: 4, flex: 'none' }}>
          {s.master_url && s.master_url !== s.url ? <img src={s.master_url} alt="" title="Master (English)" style={{ width: 52, height: 52, objectFit: 'contain', borderRadius: 6, border: `1px solid ${C.line}`, background: C.bg, opacity: .8 }} /> : null}
          {s.url ? <a href={s.url} target="_blank" rel="noreferrer" title="Open full size"><img src={s.url} alt={s.text || s.label} style={{ width: s.id.startsWith('aplus_') ? 97 : 52, height: s.id.startsWith('aplus_') ? 60 : 52, objectFit: 'contain', borderRadius: 6, border: `1px solid ${C.line}`, background: C.bg, display: 'block' }} /></a> : null}
        </span>
      ) : null}
      <div style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.4 }}>
        <b style={{ fontSize: 13.5 }}>{s.label}</b>
        {!img && s.master_text ? <div style={{ color: C.muted, marginTop: 2 }}><span style={cap}>Master </span>{s.master_text}</div> : null}
        {!img ? <div style={{ marginTop: 2, whiteSpace: 'pre-wrap' }}>{s.master_text ? <span style={{ ...cap, color: C.indigo }}>This store </span> : null}{s.text}</div> : null}
        {s.note ? <div style={{ color: C.muted, marginTop: 2, fontSize: 12.5 }}>{s.note}</div> : null}
      </div>
      <span onClick={e => e.stopPropagation()} style={{ flex: 'none' }}>
        {readOnly ? <Chip>{ticked ? 'Approved' : 'Sent back'}</Chip> : <Tick checked={ticked} onChange={onTick} style={{ minHeight: 28, fontSize: 13 }}>{ticked ? 'Approve' : 'Send back'}</Tick>}
      </span>
    </div>
  )
}

export default function ContentReview({ task, artefact, isMobile, readOnly, lines = {}, setLines }) {
  const a = artefact || {}
  const sections = (a.sections || []).filter(s => s && s.id)
  const decided = task.line_decisions || {}
  const ids = sections.map(s => s.id).join('|')
  useEffect(() => {
    if (readOnly || !setLines) return
    const missing = sections.filter(s => !lines[s.id])
    if (missing.length) setLines({ ...lines, ...Object.fromEntries(missing.map(s => [s.id, 'approved'])) })
  }, [ids, readOnly])   // eslint-disable-line react-hooks/exhaustive-deps
  const state = (id) => (readOnly ? decided[id] || 'approved' : lines[id] || 'approved')
  const tick = (id, on) => setLines && setLines({ ...lines, [id]: on ? 'approved' : 'rejected' })
  const [view, setView] = useState(isMobile ? 'mobile' : 'both')
  const [sel, setSel] = useState(null)
  const back = sections.filter(s => !isTicked(state(s.id))).length
  const panels = sections.filter(s => s.id.startsWith('aplus_'))
  const copy = sections.filter(s => s.id.startsWith('copy_'))
  const imgs = sections.filter(s => s.id.startsWith('img_'))
  const rows = (list) => list.map(s => <Row key={s.id} s={s} readOnly={readOnly} sel={sel} onSel={setSel} ticked={isTicked(state(s.id))} onTick={(on) => tick(s.id, on)} />)
  const group = (title, list, note) => list.length ? (
    <Panel pad="0" style={{ marginBottom: 12, overflow: 'hidden' }}>
      <div style={{ padding: '10px 12px' }}><b style={{ fontSize: 14 }}>{title}</b>{note ? <span style={{ fontSize: 12.5, color: C.muted }}> · {note}</span> : null}</div>
      {rows(list)}
    </Panel>
  ) : null

  return (
    <div>
      <Panel pad="14px" style={{ marginBottom: 12 }}>
        <H2 style={{ marginTop: 0 }}>{a.kind === 'aplus' ? 'A+ page' : `${a.market} store`} · {a.product}{a.sku ? ` (${a.sku})` : ''}</H2>
        <p style={{ margin: '2px 0', fontSize: 13, color: C.muted }}>ASIN {a.asin} · {sections.length} piece{sections.length === 1 ? '' : 's'}{a.cost_usd ? ` · made for $${Number(a.cost_usd).toFixed(2)}` : ''}</p>
        {a.brief ? <p style={{ margin: '6px 0 0', fontSize: 13.5 }}><b>Brief:</b> {a.brief}</p> : null}
        {a.notes ? <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.45, color: C.body }}>{a.notes}</p> : null}
        {back && !readOnly ? <p style={{ margin: '6px 0 0', fontSize: 13, fontWeight: 800, color: C.bad }}>{back} piece{back === 1 ? '' : 's'} will go back. Say what to change in a comment.</p> : null}
        {(a.shot_list || []).length ? <p style={{ margin: '6px 0 0', fontSize: 13 }}><b>Shot list (photos the library does not have):</b> {a.shot_list.map(x => `${x.slot ? `${x.slot}: ` : ''}${x.need}`).join(' · ')}</p> : null}
      </Panel>

      {panels.length ? (
        <Panel pad="14px" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <b style={{ fontSize: 14, flex: 1 }}>How shoppers see the A+ page</b>
            <Pills label="Preview">
              {(isMobile ? [['mobile', 'Phone'], ['desktop', 'Desktop']] : [['both', 'Both'], ['desktop', 'Desktop'], ['mobile', 'Phone']]).map(([k, l]) => <Pill key={k} on={view === k} onClick={() => setView(k)} style={{ minHeight: 32, fontSize: 13 }}>{l}</Pill>)}
            </Pills>
          </div>
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', justifyContent: 'center', flexWrap: 'wrap', background: C.bg, borderRadius: 10, padding: 16 }}>
            {view !== 'mobile' ? <Desktop width={isMobile ? '100%' : view === 'both' ? 560 : 720}><Stack panels={panels} state={state} sel={sel} onSel={setSel} /></Desktop> : null}
            {view !== 'desktop' ? <Phone width={isMobile ? 260 : 250}><Stack panels={panels} state={state} sel={sel} onSel={setSel} /></Phone> : null}
          </div>
          <Note style={{ marginTop: 8 }}>Shown at the proportions Amazon uses: desktop centres the panels in the page; phones show them full width. Click a panel to find it below; open any thumbnail for full size.</Note>
        </Panel>
      ) : null}

      {group('Copy', copy, a.kind === 'store' && a.market && !['UK', 'US', 'CA', 'IE'].includes(a.market) ? 'master English beside this store' : null)}
      {group('Listing images', imgs, imgs.some(s => s.master_url) ? 'master on the left, this store on the right' : null)}
      {group('A+ panels', panels, 'tick to approve, untick to send back')}
    </div>
  )
}
