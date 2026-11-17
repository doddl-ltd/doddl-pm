// Amazon content review (artefact_type content_review, migration 42): an A+ page or one store of a product for Jon and
// Laura. Every piece is shown as it will look (image or words, with the master English beside a translation) and has a
// tick; unticked pieces go back (lines[id] = 'rejected'), ticked ones are approved. Say why in the comments.
// What happens on approval is in lib/pm/contentReview.js (afterContentDecision).
import { useEffect } from 'react'
import { C, Panel, H2, Note, Tick, Chip } from './reviewKit'

const isTicked = (v) => v === 'approved'

function Piece({ s, ticked, onTick, readOnly, isMobile }) {
  const img = s.kind === 'image'
  return (
    <Panel pad="14px" style={{ marginBottom: 10, borderColor: ticked ? C.line : C.bad }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ flex: 1, fontSize: 15 }}>{s.label}</b>
        {readOnly ? <Chip>{ticked ? 'Approved' : 'Sent back'}</Chip> : <Tick checked={ticked} onChange={onTick} style={{ minHeight: 32 }}>{ticked ? 'Approve' : 'Send back'}</Tick>}
      </div>
      {img ? (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
          {s.url ? <a href={s.url} target="_blank" rel="noreferrer" style={{ flex: '1 1 420px', maxWidth: '100%' }}><img src={s.url} alt={s.text || s.label} style={{ width: '100%', borderRadius: 8, border: `1px solid ${C.line}`, display: 'block' }} /></a> : <Note>No image</Note>}
          {s.master_url && s.master_url !== s.url ? (
            <div style={{ flex: isMobile ? '1 1 100%' : '0 1 220px' }}>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: C.muted, textTransform: 'uppercase' }}>Master (English)</span>
              <img src={s.master_url} alt="" style={{ width: '100%', borderRadius: 8, border: `1px solid ${C.line}`, display: 'block', marginTop: 2 }} />
            </div>
          ) : null}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: s.master_text ? 'repeat(auto-fit, minmax(240px, 1fr))' : '1fr', gap: 10, marginTop: 6, fontSize: 14, lineHeight: 1.45 }}>
          {s.master_text ? <div><span style={{ fontSize: 11.5, fontWeight: 800, color: C.muted, textTransform: 'uppercase' }}>Master (English)</span><p style={{ margin: '2px 0 0', whiteSpace: 'pre-wrap', color: C.body }}>{s.master_text}</p></div> : null}
          <div>{s.master_text ? <span style={{ fontSize: 11.5, fontWeight: 800, color: C.indigo, textTransform: 'uppercase' }}>This store</span> : null}<p style={{ margin: '2px 0 0', whiteSpace: 'pre-wrap' }}>{s.text}</p></div>
        </div>
      )}
      {s.note ? <Note style={{ marginTop: 6 }}>{s.note}</Note> : null}
    </Panel>
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
  const back = sections.filter(s => !isTicked(state(s.id))).length
  return (
    <div>
      <Panel pad="16px" style={{ marginBottom: 12 }}>
        <H2 style={{ marginTop: 0 }}>{a.kind === 'aplus' ? 'A+ page' : `${a.market} store`} · {a.product}{a.sku ? ` (${a.sku})` : ''}</H2>
        <p style={{ margin: '4px 0', fontSize: 13.5, color: C.muted }}>ASIN {a.asin} · {sections.length} piece{sections.length === 1 ? '' : 's'}{a.cost_usd ? ` · made for $${Number(a.cost_usd).toFixed(2)}` : ''}</p>
        {a.brief ? <p style={{ margin: '8px 0 0', fontSize: 14 }}><b>Brief:</b> {a.brief}</p> : null}
        {a.notes ? <p style={{ margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.45 }}>{a.notes}</p> : null}
        {back && !readOnly ? <p style={{ margin: '8px 0 0', fontSize: 13.5, fontWeight: 800, color: C.bad }}>{back} piece{back === 1 ? '' : 's'} will go back. Say what to change in a comment.</p> : null}
      </Panel>
      {(a.shot_list || []).length ? (
        <Panel pad="14px" style={{ marginBottom: 12, background: C.bg }}>
          <b style={{ fontSize: 14 }}>Shot list: photos the image library does not have yet</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13.5 }}>{a.shot_list.map((x, i) => <li key={i}>{x.slot ? <b>{x.slot}: </b> : null}{x.need}</li>)}</ul>
        </Panel>
      ) : null}
      {sections.map(s => (
        <Piece key={s.id} s={s} isMobile={isMobile} readOnly={readOnly} ticked={isTicked(state(s.id))}
          onTick={(on) => setLines && setLines({ ...lines, [s.id]: on ? 'approved' : 'rejected' })} />
      ))}
    </div>
  )
}
