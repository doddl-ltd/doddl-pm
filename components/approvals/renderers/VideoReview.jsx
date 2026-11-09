// Video review (artefact_type video; boards VideoReview / VideoReviewPhone).
// Player in 9:16 / 4:5 / 1:1 with safe zones and captions, frames strip, beats bar, timeline comments
// (onComment(body, {kind:'time', t})), script against the cut, deliverables, checks, version switch.
// "Organic only" is an edit: edits.scope = 'organic' (the card then records approved_with_edits).
import { useEffect, useRef, useState } from 'react'
import {
  C, Panel, H2, Note, Ph, Seg, Tick, Radio, inputStyle, Checks, Steps, WhyBlock, Table, SafeZones, Fold, Cols, Col, Btn,
  STRIPE_DARK, toSeconds, clock,
} from './reviewKit'

const SHAPES = ['9:16', '4:5', '1:1']
const DIMS = { desktop: { '9:16': [270, 480], '4:5': [360, 450], '1:1': [400, 400] }, phone: { '9:16': [234, 416], '4:5': [300, 375], '1:1': [320, 320] } }
const BEAT_COLOURS = ['#3D157D', '#5B3A9C', '#7A5BB5', '#9B83CC', '#190e3e', '#4A2A8A', '#6A4BA8']
const DELIV = { ready: ['Ready', C.ok], missing: ['Missing', C.bad] }

export default function VideoReview({ task, artefact, isMobile, readOnly, edits = {}, setEdits, comments = [], onComment }) {
  const a = artefact || {}
  const files = a.files || {}
  const frames = (a.frames || []).filter(Boolean).map(f => ({ ...f, s: toSeconds(f.t) })).sort((x, y) => x.s - y.s)
  const beats = (a.beats || []).filter(Boolean)
  const duration = Number(a.duration_s) || (beats.length ? Math.max(...beats.map(b => Number(b.end_s) || 0)) : 0) || (frames.length ? frames[frames.length - 1].s + 1 : 15)
  const firstShape = SHAPES.find(s => files[s]) || '9:16'
  const [shape, setShape] = useState(firstShape)
  const [safe, setSafe] = useState(true)
  const [caps, setCaps] = useState(true)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [ver, setVer] = useState('current')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const videoRef = useRef(null)
  const url = files[shape]

  // Without a file, "play" walks the frames second by second.
  useEffect(() => {
    if (!playing || url) return undefined
    const id = setInterval(() => setT(x => { if (x + 1 > duration) { setPlaying(false); return duration } return x + 1 }), 1000)
    return () => clearInterval(id)
  }, [playing, url, duration])

  const seek = (s) => {
    setT(s)
    if (videoRef.current) { try { videoRef.current.currentTime = s } catch (_) { /* not loaded yet */ } }
  }
  const frameIndex = frames.reduce((acc, f, i) => (f.s <= t + 0.01 ? i : acc), 0)
  const f = frames[frameIndex] || {}
  const pct = duration ? Math.min(100, (t / duration) * 100) : 0
  const [w, h] = DIMS[isMobile ? 'phone' : 'desktop'][shape]

  const timeComments = comments.filter(c => c.anchor && c.anchor.kind === 'time').sort((x, y) => toSeconds(x.anchor.t) - toSeconds(y.anchor.t))
  const add = async () => {
    if (!draft.trim() || !onComment) return
    setBusy(true)
    try { await onComment(draft.trim(), { kind: 'time', t: clock(t) }); setDraft('') } finally { setBusy(false) }
  }

  const versions = [...(a.previous_versions || []).filter(Boolean).map(p => ({ value: String(p.version), label: `v${String(p.version).replace(/^v/i, '')}`, p })),
    { value: 'current', label: `v${String(a.version || '').replace(/^v/i, '') || '?'}${isMobile ? '' : ' (this one)'}` }]
  const oldVer = versions.find(x => x.value === ver && x.p)

  const scope = edits && edits.scope === 'organic' ? 'organic' : 'all'
  const setScope = (s) => {
    if (readOnly || !setEdits) return
    const next = { ...(edits || {}) }
    if (s === 'organic') next.scope = 'organic'; else delete next.scope
    setEdits(next)
  }

  const player = (
    <div style={{ position: 'relative', width: w, maxWidth: '100%', aspectRatio: `${w} / ${h}`, margin: '10px auto 0', background: STRIPE_DARK, borderRadius: 14, overflow: 'hidden', color: '#DCD6EC', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      {url ? (
        <video ref={videoRef} src={url} playsInline controls={false} onTimeUpdate={e => setT(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <div style={{ padding: '0 20px', zIndex: 1, marginBottom: caps && f.voice ? '28%' : 0 }}>
          <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 800, opacity: 0.8 }}>No {shape} file delivered yet</p>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 800, letterSpacing: '.06em' }}>{clock(t)}{f.beat ? ` · ${f.beat}` : ''}</p>
          {f.shot ? <p style={{ margin: '8px 0 0', fontSize: isMobile ? 13 : 14 }}>{f.shot}</p> : null}
          {f.text ? <p style={{ margin: '14px 0 0', fontSize: isMobile ? 19 : 22, fontWeight: 800, color: '#fff' }}>{f.text}</p> : null}        </div>
      )}
      {safe ? <SafeZones /> : null}
      {caps && f.voice ? <p style={{ position: 'absolute', left: 12, right: 12, bottom: '38%', margin: 0, background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 13, padding: '4px 8px', borderRadius: 6, zIndex: 2 }}>{f.voice}</p> : null}
    </div>
  )

  const togglePlay = () => {
    if (url && videoRef.current) { if (videoRef.current.paused) videoRef.current.play(); else videoRef.current.pause(); return }
    if (!playing && t >= duration) setT(0)
    setPlaying(p => !p)
  }
  const controls = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
      <Btn aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay} style={{ width: 46, padding: 0 }}>
        {playing
          ? <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2h4v12H3zM9 2h4v12H9z" fill={C.ink} /></svg>
          : <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2l10 6-10 6z" fill={C.ink} /></svg>}
      </Btn>
      <div role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Math.round(t)} tabIndex={0}
        onClick={e => { const r = e.currentTarget.getBoundingClientRect(); seek(Math.round(((e.clientX - r.left) / r.width) * duration)) }}
        onKeyDown={e => { if (e.key === 'ArrowRight') seek(Math.min(duration, t + 1)); if (e.key === 'ArrowLeft') seek(Math.max(0, t - 1)) }}
        style={{ flex: 1, height: 22, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
        <div style={{ flex: 1, height: 6, background: C.soft, borderRadius: 3, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: C.indigo, borderRadius: 3 }} />
        </div>
      </div>
      <span style={{ fontSize: 14, fontWeight: 800 }}>{clock(t)} / {clock(duration)}</span>
    </div>
  )

  const strip = frames.length ? (
    <div className="scroll-x" aria-label="Frames" style={isMobile ? { display: 'flex', gap: 6, paddingBottom: 4 } : { display: 'grid', gridTemplateColumns: `repeat(${Math.min(frames.length, 8)}, minmax(0, 1fr))`, gap: 8, marginTop: 16 }}>
      {frames.map((x, i) => (
        <button key={i} type="button" onClick={() => seek(x.s)} aria-pressed={i === frameIndex}
          style={{ flex: isMobile ? 'none' : undefined, width: isMobile ? 72 : 'auto', border: `2px solid ${i === frameIndex ? C.indigo : 'transparent'}`, borderRadius: 10, padding: 0, background: 'none', cursor: 'pointer', textAlign: 'left', font: 'inherit', color: C.ink }}>
          <Ph dark url={x.thumb_url} alt={x.shot} style={{ height: isMobile ? 64 : 92, borderRadius: 8, alignItems: 'flex-end', justifyContent: 'flex-start', padding: 6, boxSizing: 'border-box', fontSize: 11 }}>{clock(x.s)}</Ph>
          <span style={{ display: 'block', fontSize: isMobile ? 11 : 12, fontWeight: 800, padding: '4px 2px' }}>{x.beat || clock(x.s)}</span>
        </button>
      ))}
    </div>
  ) : null

  const beatBar = beats.length && duration ? (
    <div aria-label="Beats" style={{ display: 'flex', height: 30, borderRadius: 8, overflow: 'hidden', marginTop: 10, fontSize: 11, fontWeight: 800 }}>
      {beats.map((b, i) => {
        const s = Number(b.start_s) || 0, e = Number(b.end_s) || s
        return (
          <button key={i} type="button" onClick={() => seek(s)} title={`${b.label} ${clock(s)}–${clock(e)}`}
            style={{ width: `${Math.max(0, ((e - s) / duration) * 100)}%`, background: BEAT_COLOURS[i % BEAT_COLOURS.length], color: '#fff', border: 0, padding: '0 6px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', cursor: 'pointer', font: "800 11px 'Nunito', sans-serif" }}>
            {b.label}{i === 0 && !isMobile ? ` ${clock(s)}–${clock(e)}` : ''}
          </button>
        )
      })}
    </div>
  ) : null

  const commentsPanel = (
    <Panel pad={isMobile ? '14px' : undefined}>
      <H2>Comments on the timeline</H2>
      {timeComments.length ? timeComments.map((c, i) => (
        <div key={c.id || i} style={{ display: 'flex', gap: 12, padding: '10px 0', borderTop: i ? '1px solid #F1EEF6' : 0, fontSize: 14, lineHeight: 1.45 }}>
          <button type="button" onClick={() => seek(toSeconds(c.anchor.t))} style={{ flex: 'none', fontWeight: 800, color: C.indigo, background: C.soft, borderRadius: 6, padding: '1px 8px', height: 24, fontSize: 13, border: 0, cursor: 'pointer' }}>{c.anchor.t}</button>
          <span><b>{c.author}</b> {c.body}<br /><span style={{ fontSize: 12, color: C.muted }}>{c.resolved ? 'Resolved' : 'Open'}</span></span>
        </div>
      )) : <Note>No comments yet. Pick a moment and say what needs changing.</Note>}
      {onComment ? (<>
        <label htmlFor="vid-c" style={{ display: 'block', fontSize: 13, fontWeight: 800, marginTop: 10 }}>Add a comment at {clock(t)}</label>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <input id="vid-c" style={inputStyle} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} placeholder="What needs changing at this moment?" />
          <Btn onClick={add} disabled={busy || !draft.trim()}>Add</Btn>
        </div>
      </>) : null}
    </Panel>
  )

  const script = (a.script || []).filter(Boolean)
  const scriptTable = script.length ? (
    <Table minWidth={760} head={['Time', 'Beat', 'The brief asked for', 'On screen in this cut', 'Words on screen', 'Footage from']}
      rows={script.map(s => [typeof s.t === 'number' ? clock(s.t) : (s.t || ''), s.beat || '', s.brief || '', s.on_screen || '', s.words || '', s.source || ''])} />
  ) : <Note>No script attached.</Note>
  const scriptList = script.length ? script.map((s, i) => (
    <p key={i} style={{ margin: i ? '8px 0 0' : 0, fontSize: 14, lineHeight: 1.45 }}><b>{typeof s.t === 'number' ? clock(s.t) : s.t} {s.beat}</b>{s.on_screen ? ` · ${s.on_screen}` : ''}{s.words ? ` · ${s.words}` : ''}</p>
  )) : <Note>No script attached.</Note>

  const deliverables = (a.deliverables || []).filter(Boolean)
  const delivPanel = (
    <Panel pad={isMobile ? '14px' : undefined} style={{ flex: '1 1 360px' }}>
      <H2>Files the editor has delivered</H2>
      {deliverables.length ? deliverables.map((d, i) => {
        const [word, col] = DELIV[d.status] || [d.status, C.muted]
        return <div key={i} style={{ display: 'flex', gap: 10, fontSize: 14, lineHeight: 1.45, padding: '7px 0', borderTop: i ? '1px solid #F1EEF6' : 0 }}><span style={{ color: col, fontWeight: 800, flex: 'none', width: 58 }}>{word}</span><span>{d.label}{d.note ? `. ${d.note}` : ''}</span></div>
      }) : <Note>No deliverables listed.</Note>}
    </Panel>
  )

  const usePanel = (
    <Panel pad={isMobile ? '14px' : undefined} style={{ flex: '1 1 360px' }}>
      <H2>Where it can be used</H2>
      <Radio name="vid-scope" checked={scope === 'all'} disabled={readOnly} onChange={() => setScope('all')}>Paid ads and organic</Radio>
      <Radio name="vid-scope" checked={scope === 'organic'} disabled={readOnly} onChange={() => setScope('organic')}>Organic only</Radio>
      <Note style={{ marginTop: 6 }}>
        {[(a.runs_on || []).length ? `Runs on ${a.runs_on.join(', ')}` : '', (a.used_by || []).length ? `used by ${a.used_by.join(', ')}` : ''].filter(Boolean).join(' · ') || 'Choose “Organic only” to keep it out of paid ads; your answer is still given with the buttons on this card.'}
      </Note>
    </Panel>
  )

  const versionNote = oldVer ? (
    <p style={{ margin: '10px 0 0', padding: '10px 12px', borderRadius: 10, background: C.warnBg, color: C.warn, fontSize: 13, fontWeight: 700 }}>
      {oldVer.label}{oldVer.p.outcome ? `: ${oldVer.p.outcome.replace(/_/g, ' ')}` : ''}{oldVer.p.note ? ` — “${oldVer.p.note}”` : ''}. Only the current cut can be played here.
    </p>
  ) : null

  const shapeSeg = <Seg label="Shape" value={shape} onChange={setShape} options={SHAPES.map(s => ({ value: s, label: s }))} />
  const verSeg = versions.length > 1 ? <Seg label="Version" value={ver} onChange={setVer} options={versions} /> : null
  const afterYes = (a.after_yes || []).filter(Boolean)

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{shapeSeg}{verSeg}</div>
        {versionNote}
        {player}
        {controls}
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
          <Tick checked={safe} onChange={setSafe}>Safe zones</Tick>
          <Tick checked={caps} onChange={setCaps}>Captions</Tick>
        </div>
        {strip}
        {beatBar}
        {commentsPanel}
        <Panel pad="14px"><H2>Checks</H2><Checks checks={a.checks} /></Panel>
        <Fold title="Script against the cut">{scriptList}</Fold>
        {delivPanel}
        {a.why ? <Fold title="Why the agent made this"><WhyBlock why={a.why} evidence={a.evidence} expected={a.expected_effect} undo={a.undo} /></Fold> : null}
        {afterYes.length ? <Fold title="After you say yes"><Steps items={afterYes} /></Fold> : null}
        {usePanel}
      </div>
    )
  }

  return (
    <div>
      <Cols>
        <Panel style={{ flex: '1 1 520px' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>{shapeSeg}{verSeg}</div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 8 }}>
            <Tick checked={safe} onChange={setSafe}>Safe zones</Tick>
            <Tick checked={caps} onChange={setCaps}>Captions</Tick>
          </div>
          {versionNote}
          {player}
          {controls}
          {strip}
          {beatBar}
        </Panel>
        <Col basis={380}>
          {commentsPanel}
          <Panel><H2>Checks</H2><Checks checks={a.checks} /></Panel>
          {a.why ? <Panel><H2>Why the agent made this</H2><WhyBlock why={a.why} evidence={a.evidence} expected={a.expected_effect} undo={a.undo} /></Panel> : null}
        </Col>
      </Cols>
      <Panel style={{ marginTop: 20 }}><H2>Script against the cut</H2>{scriptTable}</Panel>
      <Cols style={{ marginTop: 20 }}>
        {delivPanel}
        {usePanel}
        {afterYes.length ? <Panel style={{ flex: '1 1 360px' }}><H2>After you say yes</H2><Steps items={afterYes} /></Panel> : null}
      </Cols>
    </div>
  )
}
