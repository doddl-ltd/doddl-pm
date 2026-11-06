// Give HQ an idea (boards Idea, IdeaPhone): six questions, only the first required (POST /api/ideas),
// and the person's own ideas with HQ's reply and status (GET /api/ideas?mine=1).
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { C, IDEA_STATUS, fmtWhen } from '../../lib/approvalsUi'
import { Chip, Panel, Btn, Notice, inputStyle, callJson, font } from './ui'

const defaultFetcher = (path, init) => callJson(apiFetch, path, init)
const DRAFT_KEY = 'doddl-pm-idea-draft'
const STAGES = ['6–12 months', 'Toddler 12–24 months', 'Toddler 2–4 years', 'SEN']
const CHANNELS = ['Amazon', 'Email', 'Instagram', 'Facebook', 'TikTok', 'Website', 'Paid social', 'Paid search', 'PR and creators', 'B2B']
const MARKETS = ['UK', 'US', 'EU', 'Japan']
const OFFERS = ['No offer', 'Discount', 'Bundle', 'Free gift']
const MEASURES = ['Sales of the products named', 'Email revenue per recipient', 'Amazon conversion', 'New subscribers', 'Followers and saves']
const EMPTY = { text: '', persona: '', age_stages: [], channels: [], markets: [], from: '', to: '', when: '', offer: 'No offer', must_include: '', must_avoid: '', measure: '', target: '' }

function Pill({ on, onClick, children }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      style={{ minHeight: 40, padding: '0 14px', borderRadius: 999, border: `1px solid ${on ? C.indigo : C.border}`, background: on ? C.indigo : '#fff', font: `800 14px ${font}`, color: on ? '#fff' : C.ink, cursor: 'pointer' }}>
      {children}
    </button>
  )
}

function Q({ n, title, htmlFor, children, first, isMobile }) {
  const T = htmlFor ? 'label' : 'p'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: isMobile ? '0' : first ? '0 0 16px' : '16px 0', borderTop: first || isMobile ? 0 : `1px solid ${C.line2}` }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
        {!isMobile && <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', background: C.indigo, borderRadius: 999, width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{n}</span>}
        <T htmlFor={htmlFor} style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{isMobile ? `${n} · ` : ''}{title}</T>
      </div>
      {children}
    </div>
  )
}

const hint = { fontSize: 13, color: C.muted, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }

/** The form values as the POST /api/ideas body. */
export function ideaBody(f) {
  const timing = f.when.trim() || (f.from || f.to ? [f.from && `from ${f.from}`, f.to && `to ${f.to}`].filter(Boolean).join(' ') : '')
  const measure = [f.measure, f.target.trim() && `target: ${f.target.trim()}`].filter(Boolean).join(' · ')
  const out = { text: f.text.trim() }
  if (f.persona.trim()) out.persona = f.persona.trim()
  for (const k of ['age_stages', 'channels', 'markets']) if (f[k].length) out[k] = f[k]
  if (timing) out.timing = timing
  if (f.offer && f.offer !== 'No offer') out.offer = f.offer
  if (f.must_include.trim()) out.must_include = f.must_include.trim()
  if (f.must_avoid.trim()) out.must_avoid = f.must_avoid.trim()
  if (measure) out.measure = measure
  return out
}

export default function IdeaView({ isMobile, fetcher = defaultFetcher, initialIdeas = null }) {
  const [f, setF] = useState(EMPTY)
  const [ideas, setIdeas] = useState(initialIdeas || [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [sent, setSent] = useState(false)
  const [draftNote, setDraftNote] = useState(null)

  useEffect(() => {
    try { const d = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || 'null'); if (d && typeof d === 'object') setF({ ...EMPTY, ...d }) } catch { /* no draft */ }
  }, [])
  const loadIdeas = useCallback(async () => {
    try { const r = await fetcher('/api/ideas?mine=1&limit=20'); setIdeas(r.ideas || []) } catch { /* list is a nicety */ }
  }, [fetcher])
  useEffect(() => { if (!initialIdeas) loadIdeas() }, [initialIdeas, loadIdeas])

  const set = (k) => (e) => { setSent(false); setF(x => ({ ...x, [k]: e.target.value })) }
  const toggle = (k, v) => () => { setSent(false); setF(x => ({ ...x, [k]: x[k].includes(v) ? x[k].filter(y => y !== v) : [...x[k], v] })) }
  const pills = (k, list) => <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{list.map(v => <Pill key={v} on={f[k].includes(v)} onClick={toggle(k, v)}>{v}</Pill>)}</div>

  const send = async () => {
    if (!f.text.trim()) { setErr('Say what the idea is first. The rest is optional.'); return }
    setBusy(true); setErr(null)
    try {
      const row = await fetcher('/api/ideas', { method: 'POST', body: JSON.stringify(ideaBody(f)) })
      setSent(true); setF(EMPTY); setDraftNote(null)
      try { window.localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
      if (row && row.id) setIdeas(list => [row, ...list.filter(i => i.id !== row.id)])
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const saveDraft = () => {
    try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(f)); setDraftNote('Draft saved on this device.') } catch { setDraftNote('Could not save a draft here.') }
  }

  const form = (
    <>
      <Q n={1} first isMobile={isMobile} title="The idea, in a sentence" htmlFor="idea-text">
        <textarea id="idea-text" rows={isMobile ? 4 : 3} value={f.text} onChange={set('text')} placeholder="For example: we’ve got 400 Dusky Rose sets ageing in the UK. What would you do?" style={{ ...inputStyle, resize: 'vertical' }} />
      </Q>
      <Q n={2} isMobile={isMobile} title="Who it’s for">
        <label style={hint}>Persona<input value={f.persona} onChange={set('persona')} placeholder="For example: first-time weaning parents" style={inputStyle} /></label>
        {!isMobile && <p style={{ ...hint, marginTop: 4 }}>Age stage</p>}
        {pills('age_stages', STAGES)}
      </Q>
      <Q n={3} isMobile={isMobile} title="Channels and markets">
        {pills('channels', CHANNELS)}
        {pills('markets', MARKETS)}
      </Q>
      <Q n={4} isMobile={isMobile} title="Timing and offer">
        {isMobile ? (
          <>
            <label style={hint}>When<input value={f.when} onChange={set('when')} placeholder="For example: all of January" style={inputStyle} /></label>
            <label style={hint}>Offer<select value={f.offer} onChange={set('offer')} style={inputStyle}>{OFFERS.map(o => <option key={o}>{o}</option>)}</select></label>
          </>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
            <label style={hint}>From<input type="date" value={f.from} onChange={set('from')} style={inputStyle} /></label>
            <label style={hint}>To<input type="date" value={f.to} onChange={set('to')} style={inputStyle} /></label>
            <label style={hint}>Offer<select value={f.offer} onChange={set('offer')} style={inputStyle}>{OFFERS.map(o => <option key={o}>{o}</option>)}</select></label>
          </div>
        )}
        <p style={hint}>Any offer goes to Jon as a pricing recommendation first. HQ never changes prices.</p>
      </Q>
      <Q n={5} isMobile={isMobile} title={isMobile ? 'Must include, must avoid' : 'Must include, and must avoid'}>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          <label style={hint}>Must include<textarea rows={isMobile ? 2 : 3} value={f.must_include} onChange={set('must_include')} style={{ ...inputStyle, resize: 'vertical' }} /></label>
          <label style={hint}>Must avoid<textarea rows={isMobile ? 2 : 3} value={f.must_avoid} onChange={set('must_avoid')} style={{ ...inputStyle, resize: 'vertical' }} /></label>
        </div>
      </Q>
      <Q n={6} isMobile={isMobile} title="How we’ll know it worked">
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          <label style={hint}>Measure<select value={f.measure} onChange={set('measure')} style={inputStyle}><option value="">Choose a measure</option>{MEASURES.map(o => <option key={o}>{o}</option>)}</select></label>
          <label style={hint}>Target (optional)<input value={f.target} onChange={set('target')} placeholder="For example: up 20% on January last year" style={inputStyle} /></label>
        </div>
      </Q>
    </>
  )
  const actions = (
    <>
      {err && <p role="alert" style={{ color: '#A12B2B', fontSize: 13, fontWeight: 700, margin: '0 0 8px' }}>{err}</p>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', borderTop: isMobile ? 0 : `1px solid ${C.line2}`, paddingTop: isMobile ? 0 : 16 }}>
        <Btn kind="primary" onClick={send} disabled={busy} style={isMobile ? { width: '100%' } : undefined}>{busy ? 'Sending…' : 'Send to HQ'}</Btn>
        <Btn onClick={saveDraft} style={isMobile ? { width: '100%' } : undefined}>Save as draft</Btn>
      </div>
      {draftNote && <p style={{ margin: '8px 0 0', fontSize: 13, color: C.muted }}>{draftNote}</p>}
      {sent && <Notice tone="ok" style={{ marginTop: 12, fontWeight: 800 }}>Sent. HQ has it and will reply on the idea, usually within the hour.</Notice>}
    </>
  )
  const yours = (
    <Panel>
      <h2 style={{ margin: '0 0 10px', fontSize: 17, fontWeight: 800 }}>Your ideas</h2>
      {!ideas.length && <p style={{ margin: 0, fontSize: 14, color: C.muted }}>Nothing sent yet. HQ’s replies show here.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 14 }}>
        {ideas.map(i => {
          const st = IDEA_STATUS[i.status] || { label: i.status, tone: 'grey' }
          const label = i.status === 'new' && i.hq_reply ? 'HQ has a question' : st.label
          return (
            <div key={i.id} style={{ borderTop: `1px solid ${C.line2}`, paddingTop: 10 }}>
              <b style={{ display: 'block', lineHeight: 1.35 }}>{i.text.length > 110 ? `${i.text.slice(0, 110)}…` : i.text}</b>
              <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                <Chip tone={i.status === 'new' && i.hq_reply ? 'warn' : st.tone}>{label}{i.status === 'briefed' && i.brief_ref ? `: ${i.brief_ref}` : ''}</Chip>
                <span style={{ color: C.muted, fontSize: 13 }}>{fmtWhen(i.created_at, { time: false })}</span>
              </div>
              {i.hq_reply && <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.5, background: C.bg, borderRadius: 10, padding: '8px 10px' }}><b>HQ:</b> {i.hq_reply}</p>}
            </div>
          )
        })}
      </div>
    </Panel>
  )

  if (isMobile) {
    return (
      <div style={{ fontFamily: font, color: C.ink, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Give HQ an idea</h1>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: C.muted }}>Only the first box is needed. HQ asks for the rest.</p>
        </div>
        {form}
        {actions}
        {yours}
      </div>
    )
  }
  return (
    <div style={{ fontFamily: font, color: C.ink, maxWidth: 1240 }}>
      <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800 }}>Give HQ an idea</h1>
      <p style={{ margin: '6px 0 0', color: C.muted, fontSize: 15, maxWidth: 720 }}>Say it the way you would to a colleague. Only the first question is needed: HQ asks for anything else it needs, here on the idea.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginTop: 22, alignItems: 'flex-start' }}>
        <Panel as="form" onSubmit={e => { e.preventDefault(); send() }} style={{ flex: '999 1 620px' }}>
          {form}
          {actions}
        </Panel>
        <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Panel>
            <h2 style={{ margin: '0 0 10px', fontSize: 17, fontWeight: 800 }}>What happens next</h2>
            <ol style={{ margin: 0, paddingLeft: 20, listStyle: 'decimal', fontSize: 14, lineHeight: 1.55, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <li>HQ reads it and asks about anything missing, here on the idea.</li>
              <li>Content Marketing turns it into briefs in the next content calendar, or a stand-alone plan if it can’t wait.</li>
              <li>You see the plan as a card. Then each finished piece, with a preview.</li>
              <li>Results come back in the weekly review.</li>
            </ol>
          </Panel>
          {yours}
        </div>
      </div>
    </div>
  )
}
