// Email review (artefact_type email; boards EmailReview / EmailReviewPhone).
// Inbox preview, subject A/B, desktop / mobile / dark preview of the HTML (sandboxed iframe, no scripts)
// or a labelled fallback, audience, checks, every link, where it sits in the sequence, send-test (stub).
import { useState } from 'react'
import { C, Panel, H2, Lbl, Note, Ph, Seg, Radio, Checks, Steps, WhyBlock, Table, Btn, Fold, Cols, Col, fmtWhen, text } from './reviewKit'

const LIGHT = { bg: '#FFFFFF', fg: '#190e3e', muted: '#5B5470', logo: '#3D157D', btn: '#3D157D', line: '#EFECF5' }
const DARK = { bg: '#1C1A22', fg: '#F1EEF8', muted: '#B9B2CC', logo: '#C9B6F2', btn: '#6A44B0', line: '#36323F' }

function sendAt(v) {
  if (!v) return ''
  return /^\d{4}-\d{2}-\d{2}T/.test(v) ? `${fmtWhen(v)} UK` : v
}

function Fallback({ a, subj, dark, mob }) {
  const t = dark ? DARK : LIGHT
  return (
    <div style={{ background: t.bg, color: t.fg, borderRadius: 10, overflow: 'hidden', border: '1px solid #DAD4E8' }}>
      <div style={{ padding: mob ? 14 : 18, textAlign: 'center', fontSize: mob ? 22 : 24, fontWeight: 800, color: t.logo }}>doddl</div>
      <Ph style={{ height: mob ? 190 : 280 }}>Email body not attached<br />(no html or html_url)</Ph>
      <div style={{ padding: mob ? 16 : '22px 24px' }}>
        <h2 style={{ margin: '0 0 10px', fontSize: mob ? 22 : 26, fontWeight: 800, lineHeight: 1.2 }}>{subj || 'Subject line'}</h2>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6 }}>{a.preview_text || 'Preview text not given.'}</p>
        <div style={{ textAlign: 'center', marginTop: 22 }}><span style={{ display: 'inline-block', background: t.btn, color: '#fff', fontWeight: 800, padding: '14px 28px', borderRadius: 10 }}>Button</span></div>
      </div>
      <div style={{ padding: '16px 24px', fontSize: 12, lineHeight: 1.5, color: t.muted, borderTop: `1px solid ${t.line}`, textAlign: 'center' }}>Footer, unsubscribe and address render here</div>
    </div>
  )
}

/** The email itself. sandbox="" = no scripts, no forms, no same-origin: the HTML is only drawn. */
function Frame({ a, dark, mob }) {
  const src = a.html ? { srcDoc: a.html } : { src: a.html_url }
  return (
    <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid #DAD4E8', background: '#fff', filter: dark ? 'invert(1) hue-rotate(180deg)' : 'none' }}>
      <iframe title="Email preview" sandbox="" referrerPolicy="no-referrer" {...src}
        style={{ display: 'block', width: '100%', height: mob ? 640 : 900, border: 0, background: '#fff' }} />
    </div>
  )
}

export default function EmailReview({ task, artefact, isMobile }) {
  const a = artefact || {}
  const subjects = (a.subjects || []).filter(s => s && s.text)
  const [si, setSi] = useState(0)
  const [tab, setTab] = useState('email')
  const [dev, setDev] = useState(isMobile ? 'mob' : 'desk')
  const subj = subjects[si] ? subjects[si].text : ''
  const hasHtml = !!(a.html || a.html_url)
  const dark = dev === 'dark'
  const mob = isMobile || dev === 'mob'
  const seq = (a.sequence || []).filter(Boolean)
  const links = (a.links || []).filter(Boolean)
  const aud = a.audience || {}

  const preview = (
    <div style={{ maxWidth: mob ? 360 : 640, margin: '0 auto' }}>
      {hasHtml ? <Frame a={a} dark={dark} mob={mob} /> : <Fallback a={a} subj={subj} dark={dark} mob={mob} />}
      {hasHtml && dark ? <Note style={{ marginTop: 8, textAlign: 'center' }}>Dark mode is simulated by inverting colours; real inboxes vary.</Note> : null}
    </div>
  )

  const flow = (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: '10px 0' }}>
      <p style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.5 }}>{a.kind === 'flow' ? 'A flow email: the trigger, the wait before it and what comes after.' : 'A one-off campaign and the emails around it.'}</p>
      {seq.length ? seq.map((s, i) => (
        <div key={i}>
          {i ? <div style={{ textAlign: 'center', color: C.muted, fontWeight: 800, fontSize: 13, padding: '4px 0' }}>↓</div> : null}
          <div style={{ border: `${s.current ? 2 : 1}px solid ${s.current ? C.indigo : C.line}`, background: s.current ? C.soft : '#fff', borderRadius: 10, padding: '10px 14px', fontSize: 14, fontWeight: s.current ? 800 : 700 }}>
            {[s.when, s.label].filter(Boolean).join(' · ')}{s.current ? ' (this email)' : ''}
          </div>
        </div>
      )) : <Note>The agent did not say where this sits.</Note>}
    </div>
  )

  const inbox = (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', border: isMobile ? 0 : `1px solid ${C.line}`, borderRadius: 10, padding: isMobile ? 0 : 12 }}>
      <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: '50%', background: C.indigo, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, flex: 'none' }}>d</span>
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>{(a.from || 'doddl').split(/[<·]/)[0].trim() || 'doddl'}</p>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>{subj || 'No subject line given'}</p>
        <p style={{ margin: 0, fontSize: 13, color: C.muted }}>{a.preview_text || 'No preview text'}</p>
      </div>
    </div>
  )

  const subjectPicker = subjects.length > 1 ? (isMobile ? (
    <Seg full style={{ marginTop: 10 }} label="Subject line" value={String(si)} onChange={x => setSi(Number(x))} options={subjects.map((s, i) => ({ value: String(i), label: `Subject ${s.split || String.fromCharCode(65 + i)}` }))} />
  ) : (<>
    <Lbl style={{ marginTop: 14 }}>Subject line test</Lbl>
    <div style={{ marginTop: 6 }}>
      {subjects.map((s, i) => <Radio key={i} name="em-subj" checked={si === i} onChange={() => setSi(i)}>{s.text} <span style={{ color: C.muted, fontWeight: 600 }}>({s.text.length} characters{s.split != null ? `, ${s.split}` : ''})</span></Radio>)}
    </div>
  </>)) : null

  const who = [['Sent to', aud.segment], ['About', aud.size != null ? `${text(aud.size)} people` : ''], ['Left out', text(aud.excluded)], ['Sender', a.from], ['Send time', sendAt(a.send_at)],
    ['Smart sending', a.smart_sending == null ? '' : a.smart_sending ? 'On: skips anyone emailed recently' : 'Off']].filter(x => x[1])
  const whoBlock = who.length ? (isMobile ? who.map(([k, v], i) => (
    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14, padding: '8px 0', borderTop: i ? '1px solid #F1EEF6' : 0 }}><b>{k}</b><span style={{ textAlign: 'right' }}>{v}</span></div>
  )) : (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px 18px', fontSize: 14, lineHeight: 1.45 }}>
      {who.map(([k, v]) => <div key={k}><Lbl>{k}</Lbl>{v}</div>)}
    </div>
  )) : <Note>No audience given.</Note>

  const testBtn = (
    <div style={{ marginTop: 10 }}>
      <Btn disabled title="Coming soon" style={isMobile ? { width: '100%' } : null}>Send a test to me</Btn>
      <Note style={{ marginTop: 6 }}>Coming soon: HQ will send the test once it is wired up.</Note>
    </div>
  )

  const linksTable = links.length
    ? <Table head={['Where in the email', 'Goes to', 'Tracking', 'Opens']} rows={links.map(l => [l.where || '', l.url, l.utm || '', l.ok === false ? <span style={{ color: C.bad, fontWeight: 800 }}>No</span> : l.ok ? 'Yes' : 'Not checked'])} />
    : <Note>No links listed.</Note>
  const afterYes = (a.after_yes || []).filter(Boolean)

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Panel pad="14px"><H2>In the inbox</H2>{inbox}{subjectPicker}</Panel>
        <Seg full label="Preview" value={dark ? 'dark' : 'mob'} onChange={setDev} options={[{ value: 'mob', label: 'Light' }, { value: 'dark', label: 'Dark mode' }]} />
        {preview}
        {testBtn}
        <Panel pad="14px"><H2>Who gets it</H2>{whoBlock}</Panel>
        <Panel pad="14px"><H2>Checks</H2><Checks checks={a.checks} /></Panel>
        {links.length ? <Fold title={`Every link (${links.length})`}>{links.map((l, i) => <p key={i} style={{ margin: i ? '8px 0 0' : 0, fontSize: 14, lineHeight: 1.45, wordBreak: 'break-word' }}><b>{l.where || 'Link'}</b> · {l.url}{l.ok === false ? <b style={{ color: C.bad }}> · does not open</b> : ''}</p>)}</Fold> : null}
        <Fold title="Where it sits in the plan">{flow}</Fold>
        {a.why ? <Fold title="Why the agent made this"><WhyBlock why={a.why} evidence={a.evidence} expected={a.expected_effect} undo={a.undo} /></Fold> : null}
        {afterYes.length ? <Fold title="After you say yes"><Steps items={afterYes} /></Fold> : null}
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
        <Seg label="Show" value={tab} onChange={setTab} options={[{ value: 'email', label: 'The email' }, { value: 'flow', label: 'Where it sits' }]} />
        {tab === 'email' ? <Seg label="Preview as" value={dev} onChange={setDev} options={[{ value: 'desk', label: 'Desktop' }, { value: 'mob', label: 'Mobile' }, { value: 'dark', label: 'Dark mode' }]} /> : null}
      </div>
      <Cols style={{ marginTop: 16 }}>
        <Panel style={{ flex: '1 1 560px', background: '#EFECF5' }}>{tab === 'email' ? preview : flow}</Panel>
        <Col basis={400}>
          <Panel><H2>How it looks in the inbox</H2>{inbox}{subjectPicker}</Panel>
          <Panel><H2>Who gets it</H2>{whoBlock}</Panel>
          <Panel><H2>Checks</H2><Checks checks={a.checks} />{testBtn}</Panel>
          {a.why ? <Panel><H2>Why the agent made this</H2><WhyBlock why={a.why} evidence={a.evidence} expected={a.expected_effect} undo={a.undo} /></Panel> : null}
        </Col>
      </Cols>
      <Panel style={{ marginTop: 20 }}><H2>Every link in the email</H2>{linksTable}</Panel>
      {afterYes.length ? <Panel style={{ marginTop: 20 }}><H2>After you say yes</H2><Steps items={afterYes} /></Panel> : null}
    </div>
  )
}
