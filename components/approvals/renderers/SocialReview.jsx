// Social week pack (artefact_type social_pack; boards SocialReview / SocialReviewPhone).
// Channel × day grid (desktop) or day pills (phone), the selected post as it will look, edits into
// lines['<id>:edit'] = {caption, hashtags, alt_text, first_comment, time, note}, a tick per post
// (lines[id] = approved | edited when ticked, rejected when unticked), balance across pillars, tick all.
import { useEffect, useState } from 'react'
import { C, Panel, H2, Note, Ph, Pill, Pills, Tick, Field, inputStyle, Checks, Btn, Fold, Cols, PhoneFrame, Avatar, mini, fmtDay } from './reviewKit'

const EDIT_KEYS = ['caption', 'hashtags', 'alt_text', 'first_comment', 'time', 'note']
const tagText = (h) => (Array.isArray(h) ? h.join(' ') : h || '')

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function shapeHeight(format, isMobile) {
  const f = String(format || '').toLowerCase()
  const tall = isMobile ? 380 : 420
  if (/9:16|reel|stor|tiktok|short/.test(f)) return tall
  if (/1:1|square/.test(f)) return isMobile ? 234 : 264
  return isMobile ? 292 : 320
}

const isTicked = (v) => v === 'approved' || v === 'edited'

export default function SocialReview({ task, artefact, isMobile, readOnly, lines = {}, setLines }) {
  const a = artefact || {}
  const posts = (a.posts || []).filter(p => p && p.id)
  const start = /^\d{4}-\d{2}-\d{2}$/.test(a.week_start || '') ? a.week_start : ([...posts.map(p => p.day).filter(Boolean)].sort()[0] || null)
  const days = start ? Array.from({ length: 7 }, (_, i) => addDays(start, i)) : [...new Set(posts.map(p => p.day || ''))]
  const channels = [...new Set(posts.map(p => p.channel || 'Other'))]
  const [sel, setSel] = useState(posts[0] ? posts[0].id : null)
  const [day, setDay] = useState(posts[0] ? posts[0].day : days[0])
  // Every post starts with an explicit answer: unticked = not scheduled ('rejected'), so approving a
  // half-ticked pack is recorded as partially approved and HQ never has to guess about an untouched post.
  const postIds = posts.map(x => x.id).join('|')
  useEffect(() => {
    if (readOnly || !setLines) return
    const missing = posts.filter(x => !lines[x.id])
    if (missing.length) setLines({ ...lines, ...Object.fromEntries(missing.map(x => [x.id, 'rejected'])) })
  }, [postIds, readOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!posts.length) return <Panel><Note>This pack has no posts.</Note></Panel>
  const raw = posts.find(p => p.id === sel) || posts[0]
  const edit = (lines && lines[`${raw.id}:edit`]) || {}
  const p = { ...raw, hashtags: tagText(raw.hashtags) }
  for (const k of EDIT_KEYS) if (typeof edit[k] === 'string') p[k] = edit[k]
  const tickedN = posts.filter(x => isTicked(lines[x.id])).length

  const setEdit = (key, val) => {
    if (readOnly || !setLines) return
    const orig = key === 'hashtags' ? tagText(raw.hashtags) : (raw[key] || '')
    const cur = { ...edit }
    if (val === orig || (key === 'note' && !val)) delete cur[key]; else cur[key] = val
    const next = { ...lines }
    const changed = Object.keys(cur).some(k => k !== 'note')
    if (Object.keys(cur).length) next[`${raw.id}:edit`] = cur; else delete next[`${raw.id}:edit`]
    if (isTicked(next[raw.id])) next[raw.id] = changed ? 'edited' : 'approved'
    setLines(next)
  }
  const toggle = (post, on) => {
    if (readOnly || !setLines) return
    const e = lines[`${post.id}:edit`] || {}
    const changed = Object.keys(e).some(k => k !== 'note')
    setLines({ ...lines, [post.id]: on ? (changed ? 'edited' : 'approved') : 'rejected' })
  }
  const tickAll = () => {
    if (readOnly || !setLines) return
    const next = { ...lines }
    for (const x of posts) if (!isTicked(next[x.id])) next[x.id] = Object.keys(next[`${x.id}:edit`] || {}).some(k => k !== 'note') ? 'edited' : 'approved'
    setLines(next)
  }

  const tickWord = (x) => {
    const v = lines[x.id]
    if (isTicked(v)) return ['Ticked', C.ok]
    if (v === 'rejected') return ['Not ticked', C.warn || C.bad]
    return [isMobile ? 'Not yet' : 'Not ticked', C.warn]
  }

  const preview = (
    <PhoneFrame width={isMobile ? 250 : 280} style={{ margin: isMobile ? '0 auto' : 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}><Avatar size={isMobile ? 22 : 26} /><span style={mini}><b>doddl</b></span></div>
      <Ph url={p.image && p.image.url} alt={p.alt_text} style={{ height: shapeHeight(p.format, isMobile) }}>{(p.image && p.image.label) || 'Post picture'}<br />{p.format || ''}</Ph>
      <p style={{ ...mini, fontSize: 12, margin: 0, padding: '8px 10px 4px' }}><b>doddl</b> {p.caption}</p>
      {p.hashtags ? <p style={{ ...mini, fontSize: 12, margin: 0, padding: '0 10px 12px', color: C.blue }}>{p.hashtags}</p> : <div style={{ height: 8 }} />}
    </PhoneFrame>
  )
  const where = `${p.channel || ''} · ${p.day ? fmtDay(p.day) : ''} ${p.time || ''}`

  const editFields = (all) => (<>
    <Field id="sp-cap" label="Caption" hint={`${(p.caption || '').length} characters`}>
      <textarea id="sp-cap" rows={4} style={inputStyle} value={p.caption || ''} readOnly={readOnly} onChange={e => setEdit('caption', e.target.value)} />
    </Field>
    <Field id="sp-tg" label="Hashtags"><input id="sp-tg" style={inputStyle} value={p.hashtags || ''} readOnly={readOnly} onChange={e => setEdit('hashtags', e.target.value)} /></Field>
    <Field id="sp-alt" label="Alt text, for screen readers"><input id="sp-alt" style={inputStyle} value={p.alt_text || ''} readOnly={readOnly} onChange={e => setEdit('alt_text', e.target.value)} /></Field>
    {all ? (<>
      <Field id="sp-fc" label="First comment"><input id="sp-fc" style={inputStyle} value={p.first_comment || ''} readOnly={readOnly} onChange={e => setEdit('first_comment', e.target.value)} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        <Field id="sp-when" label={`Goes out ${p.day ? fmtDay(p.day) : ''}`}><input id="sp-when" style={inputStyle} value={p.time || ''} readOnly={readOnly} onChange={e => setEdit('time', e.target.value)} placeholder="HH:MM" /></Field>
        <Field id="sp-prod" label="Product tag"><input id="sp-prod" style={{ ...inputStyle, background: C.bg }} value={p.product_tag || 'None'} readOnly /></Field>
      </div>
    </>) : null}
  </>)

  const tickPanel = (
    <Panel pad={isMobile ? '14px' : undefined}>
      <Tick checked={isTicked(lines[raw.id])} disabled={readOnly} onChange={on => toggle(raw, on)}>Tick: schedule this post</Tick>
      <label htmlFor="sp-note" style={{ display: 'block', fontSize: 13, fontWeight: 800, marginTop: 6 }}>Or a note to send it back</label>
      <input id="sp-note" style={{ ...inputStyle, marginTop: 6 }} value={edit.note || ''} readOnly={readOnly} placeholder="What should change?"
        onChange={e => { setEdit('note', e.target.value) }} />
    </Panel>
  )

  const counts = {}
  for (const x of posts) if (x.pillar) counts[x.pillar] = (counts[x.pillar] || 0) + 1
  const max = Math.max(1, ...Object.values(counts))
  const pillars = Object.entries(counts)
  const balance = (
    <Panel pad={isMobile ? '14px' : undefined} style={{ flex: '1 1 420px' }}>
      <H2>Balance this week</H2>
      {isMobile ? (
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{pillars.map(([n, c]) => `${n} ${c}`).join(' · ') || 'No pillars given.'}</p>
      ) : pillars.length ? pillars.map(([n, c]) => (
        <div key={n} style={{ display: 'grid', gridTemplateColumns: '150px minmax(0, 1fr) 70px', gap: 12, alignItems: 'center', marginTop: 8, fontSize: 14 }}>
          <b>{n}</b>
          <div style={{ height: 12, borderRadius: 6, background: C.soft, overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${(c / max) * 100}%`, background: C.indigo }} /></div>
          <span style={{ color: C.muted }}>{c} post{c === 1 ? '' : 's'}</span>
        </div>
      )) : <Note>No pillars given.</Note>}
      {a.pillars_note ? <Note style={{ marginTop: 12 }}>{a.pillars_note}</Note> : null}
    </Panel>
  )

  const checks = <Panel pad={isMobile ? '14px' : undefined}><H2>Checks</H2><Checks checks={p.checks} />{p.image && p.image.source ? <Note style={{ marginTop: 10 }}>Picture: {p.image.source}</Note> : null}</Panel>

  if (isMobile) {
    const dayPosts = posts.filter(x => x.day === day)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Pills label="Day">
          {days.map(d => {
            const n = posts.filter(x => x.day === d).length
            return (
              <Pill key={d} on={d === day} style={{ minHeight: 52, lineHeight: 1.2 }} onClick={() => { setDay(d); const first = posts.find(x => x.day === d); if (first) setSel(first.id) }}>
                {fmtDay(d, { weekday: 'short', day: 'numeric' })}<br /><span style={{ fontSize: 11, opacity: 0.8 }}>{n} post{n === 1 ? '' : 's'}</span>
              </Pill>
            )
          })}
        </Pills>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {dayPosts.length ? dayPosts.map(x => {
            const [w, col] = tickWord(x)
            return (
              <button key={x.id} type="button" onClick={() => setSel(x.id)} aria-pressed={x.id === raw.id}
                style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%', textAlign: 'left', border: `1px solid ${x.id === raw.id ? C.indigo : C.line}`, boxShadow: x.id === raw.id ? `0 0 0 2px ${C.lilac}` : 'none', borderRadius: 10, padding: 8, background: '#fff', cursor: 'pointer', font: 'inherit', color: C.ink, minHeight: 56 }}>
                <Ph url={x.image && x.image.url} style={{ width: 30, height: 38, flex: 'none', borderRadius: 4 }} />
                <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontSize: 14, fontWeight: 800 }}>{x.title || x.id}</span><span style={{ display: 'block', fontSize: 12, color: C.muted }}>{[x.channel, x.time, x.pillar].filter(Boolean).join(' · ')}</span></span>
                <span style={{ fontSize: 12, fontWeight: 800, color: col }}>{w}</span>
              </button>
            )
          }) : <Note>Nothing planned this day.</Note>}
        </div>
        <Panel pad="14px">
          {preview}
          <p style={{ margin: '10px 0 0', textAlign: 'center', fontSize: 13, fontWeight: 800, color: C.muted }}>{where}</p>
          <Tick checked={isTicked(lines[raw.id])} disabled={readOnly} onChange={on => toggle(raw, on)} style={{ justifyContent: 'center' }}>Tick: schedule it</Tick>
        </Panel>
        <Fold title="Edit caption, tags, alt text">{editFields(true)}
          <Field id="sp-note-m" label="Note to send it back"><input id="sp-note-m" style={inputStyle} value={edit.note || ''} readOnly={readOnly} onChange={e => setEdit('note', e.target.value)} placeholder="What should change?" /></Field>
        </Fold>
        {checks}
        {balance}
        <Panel pad="14px">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            <Btn onClick={tickAll} disabled={readOnly}>Tick all {posts.length}</Btn>
            <span style={{ alignSelf: 'center', fontSize: 14, fontWeight: 800, textAlign: 'center' }}>{tickedN} of {posts.length} ticked</span>
          </div>
        </Panel>
      </div>
    )
  }

  return (
    <div>
      <div className="scroll-x" style={{ marginTop: 4 }}>
        <div style={{ display: 'grid', gridTemplateColumns: `130px repeat(${days.length}, minmax(118px, 1fr))`, minWidth: 1000, border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
          {[{ k: 'h', label: 'Channel' }, ...days.map(d => ({ k: d, label: fmtDay(d, { weekday: 'short', day: 'numeric' }) }))].map((h, i) => (
            <div key={h.k} style={{ background: C.bg, fontSize: 12, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: C.muted, padding: 8, borderLeft: i ? `1px solid ${C.line2}` : 0 }}>{h.label}</div>
          ))}
          {channels.map(ch => [
            <div key={`${ch}-h`} style={{ fontSize: 13, fontWeight: 800, background: '#FBFAFD', padding: 8, borderTop: `1px solid ${C.line2}`, minHeight: 84 }}>{ch}</div>,
            ...days.map(d => (
              <div key={`${ch}-${d}`} style={{ borderTop: `1px solid ${C.line2}`, borderLeft: `1px solid ${C.line2}`, padding: 8, minHeight: 84, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {posts.filter(x => (x.channel || 'Other') === ch && x.day === d).map(x => {
                  const [w, col] = tickWord(x)
                  const on = x.id === raw.id
                  return (
                    <button key={x.id} type="button" onClick={() => setSel(x.id)} aria-pressed={on}
                      style={{ display: 'flex', gap: 6, alignItems: 'flex-start', width: '100%', textAlign: 'left', border: `1px solid ${on ? C.indigo : C.line}`, boxShadow: on ? `0 0 0 2px ${C.lilac}` : 'none', borderRadius: 8, padding: 6, background: '#fff', cursor: 'pointer', font: 'inherit', color: C.ink }}>
                      <Ph url={x.image && x.image.url} style={{ width: 30, height: 38, flex: 'none', borderRadius: 4 }} />
                      <span><span style={{ ...mini, fontSize: 12, display: 'block', fontWeight: 800 }}>{x.time ? `${x.time} · ` : ''}{x.title || x.id}</span><span style={{ fontSize: 11, fontWeight: 800, color: col }}>{w}</span></span>
                    </button>
                  )
                })}
              </div>
            )),
          ])}
        </div>
      </div>

      <Cols style={{ marginTop: 20 }}>
        <Panel style={{ flex: '0 1 340px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {preview}
          <p style={{ margin: '10px 0 0', fontSize: 13, fontWeight: 800, color: C.muted }}>{where}</p>
        </Panel>
        <Panel style={{ flex: '1 1 420px' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {p.pillar ? <span style={{ fontSize: 12, fontWeight: 800, borderRadius: 999, padding: '3px 10px', background: C.soft, color: C.indigo }}>{p.pillar}</span> : null}
            {p.age_stage ? <span style={{ fontSize: 12, fontWeight: 800, borderRadius: 999, padding: '3px 10px', background: C.grey, color: C.body }}>{p.age_stage}</span> : null}
          </div>
          <H2 style={{ marginTop: 10 }}>{p.title || p.id}</H2>
          {editFields(true)}
        </Panel>
        <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {checks}
          {tickPanel}
        </div>
      </Cols>

      <Cols style={{ marginTop: 20, alignItems: 'stretch' }}>
        {balance}
        <Panel style={{ flex: '1 1 420px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 14 }}>
          <div>
            <H2>{tickedN} of {posts.length} ticked</H2>
            <p style={{ margin: 0, fontSize: 14, color: C.body, lineHeight: 1.5 }}>Ticked posts go into the scheduler at the times shown. Posts you untick go back to the agent with your note.</p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Btn onClick={tickAll} disabled={readOnly}>Tick all {posts.length}</Btn>
          </div>
        </Panel>
      </Cols>
    </div>
  )
}
