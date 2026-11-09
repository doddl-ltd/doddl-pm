// b2b_sequence (board B2BFlow): the flow as columns with an arrow between steps (a person's steps dashed), the
// selected email with approve / edit per email (lines = email ids; edits in "<id>:edit" = {subject?, body?}),
// how it sends, and who does what when someone replies. Phones: the flow stacks with arrows down.
import { useEffect, useMemo, useState } from 'react'
import { C, Panel, H2, Lbl, Note, Chip, Btn, Checks, inputStyle } from './reviewKit'

const PERSON_TINT = { bg: '#FFF8EE', bd: '#D98A1F' }

/** "Hi [first name]" with the tokens marked. */
function Tokens({ children }) {
  const parts = String(children || '').split(/(\[[^\]]+\])/g)
  return parts.map((p, i) => (/^\[[^\]]+\]$/.test(p)
    ? <mark key={i} style={{ background: C.soft, color: C.indigo, borderRadius: 4, padding: '0 3px', fontWeight: 700 }}>{p}</mark>
    : <span key={i}>{p}</span>))
}

function whoTone(who) {
  const w = String(who || '').toLowerCase()
  if (!w) return { bg: C.grey, fg: C.body }
  if (w === 'hq' || w.includes('automatic')) return { bg: C.soft, fg: C.indigo }
  if (w.includes('stop')) return { bg: C.grey, fg: C.body }
  return { bg: C.warnBg, fg: C.warn }
}

export default function B2BSequenceReview({ task, artefact, isMobile, readOnly, lines: liveLines, setLines }) {
  const a = artefact || {}
  const emails = useMemo(() => (a.emails || []).filter(e => e && e.id), [a.emails])
  const decided = task && task.decision
  const lines = decided ? (task.line_decisions || {}) : (liveLines || {})
  const ro = readOnly || !!decided

  // Flow nodes: as sent, or one per email when HQ sent no flow.
  const nodes = useMemo(() => {
    const flow = (a.flow || []).filter(n => n && n.id)
    if (flow.length) return flow
    return emails.map(e => ({ id: e.id, when: e.when, title: e.subject, email_id: e.id }))
  }, [a.flow, emails])
  const emailFor = (n) => emails.find(e => e.id === n.email_id || e.step === n.id || e.id === n.id) || null
  const [sel, setSel] = useState(0)
  const [editing, setEditing] = useState(null)

  useEffect(() => {
    if (ro || !setLines) return
    const missing = emails.filter(e => !(e.id in (liveLines || {})))
    if (missing.length) setLines(prev => ({ ...Object.fromEntries(missing.map(e => [e.id, 'approved'])), ...prev }))
  }, [emails, ro, liveLines]) // eslint-disable-line react-hooks/exhaustive-deps

  const cur = nodes[Math.min(sel, nodes.length - 1)] || null
  const mail = cur ? emailFor(cur) : null
  const edit = mail ? lines[`${mail.id}:edit`] : null
  const subject = edit && edit.subject != null ? edit.subject : mail && mail.subject
  const body = edit && edit.body != null ? edit.body : mail && mail.body

  const setApproved = (id, on) => setLines(prev => {
    const n = { ...prev, [id]: on ? (prev[`${id}:edit`] ? 'edited' : 'approved') : 'rejected' }
    return n
  })
  const setEdit = (m, patch) => setLines(prev => {
    const before = prev[`${m.id}:edit`] || {}
    const next = { ...before, ...patch }
    for (const k of Object.keys(next)) if (next[k] === m[k]) delete next[k]
    const n = { ...prev }
    if (Object.keys(next).length) { n[`${m.id}:edit`] = next; n[m.id] = 'edited' } else { delete n[`${m.id}:edit`]; n[m.id] = 'approved' }
    return n
  })

  const perRow = Math.min(5, Math.max(1, nodes.length))
  const flow = (
    <Panel>
      <H2 style={{ margin: '0 0 4px' }}>The flow</H2>
      <Note style={{ marginBottom: 12 }}>Click a step to read and edit it. Dashed steps are where a person takes over. Every reply stops the sequence for that business.</Note>
      <div role="list" style={isMobile ? { display: 'flex', flexDirection: 'column', gap: 0 } : { display: 'grid', gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))`, columnGap: 30, rowGap: 16, alignItems: 'stretch' }}>
        {nodes.map((n, i) => {
          const on = i === sel
          const m = emailFor(n)
          const status = m ? (lines[m.id] === 'rejected' ? 'Not approved' : lines[m.id] === 'edited' ? 'Edited' : null) : null
          const lastInRow = isMobile ? i === nodes.length - 1 : (i % perRow === perRow - 1 || i === nodes.length - 1)
          return (
            <div role="listitem" key={n.id} style={{ position: 'relative', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <button type="button" onClick={() => { setSel(i); setEditing(null) }} aria-pressed={on}
                style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', textAlign: 'left', font: 'inherit', color: C.ink, cursor: 'pointer', borderRadius: 12, padding: '10px 12px', minHeight: 44,
                  border: `2px ${n.person ? 'dashed' : 'solid'} ${on ? C.indigo : n.person ? PERSON_TINT.bd : C.border}`, background: n.person ? PERSON_TINT.bg : '#fff', boxShadow: on ? '0 0 0 3px #E3D9F7' : 'none' }}>
                {n.when ? <Lbl style={{ fontSize: 11 }}>{n.when}</Lbl> : null}
                <span style={{ display: 'block', fontWeight: 800, fontSize: 15, marginTop: 2, overflowWrap: 'anywhere' }}>{n.title}</span>
                {n.sub ? <span style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 4 }}>{n.sub}</span> : null}
                <span style={{ marginTop: 'auto', paddingTop: 8, fontSize: 12, fontWeight: 800, color: C.indigo }}>{n.then ? `Then: ${n.then}` : i === nodes.length - 1 ? 'End of the flow' : ''}</span>
                {status ? <span style={{ fontSize: 12, fontWeight: 800, color: status === 'Edited' ? C.warn : C.bad, marginTop: 4 }}>{status}</span> : null}
              </button>
              {!lastInRow && !isMobile && <span aria-hidden="true" style={{ position: 'absolute', right: -24, top: '50%', transform: 'translateY(-50%)', color: C.faint, fontSize: 18, fontWeight: 800 }}>→</span>}
              {!lastInRow && isMobile && <span aria-hidden="true" style={{ textAlign: 'center', color: C.faint, fontSize: 18, fontWeight: 800, lineHeight: '26px' }}>↓</span>}
            </div>
          )
        })}
      </div>
    </Panel>
  )

  const preview = cur && (
    <Panel style={{ flex: isMobile ? '1 1 100%' : '1 1 520px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <H2 style={{ margin: 0 }}>{cur.title}</H2>{cur.when ? <Chip>{cur.when}</Chip> : null}
      </div>
      {mail ? (
        <>
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden', marginTop: 12 }}>
            <div style={{ background: C.bg, padding: '10px 14px', fontSize: 13, lineHeight: 1.6, overflowWrap: 'anywhere' }}>
              <b>From</b> {(a.sending && a.sending.from) || 'doddl, from the separate outreach address'}<br />
              <b>To</b> <Tokens>[contact role], [business name]</Tokens><br />
              <b>Subject</b> <Tokens>{subject}</Tokens>
            </div>
            {editing === mail.id && !ro ? (
              <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={{ fontSize: 13, fontWeight: 800 }}>Subject<input value={subject || ''} onChange={e => setEdit(mail, { subject: e.target.value })} style={{ ...inputStyle, marginTop: 6 }} /></label>
                <label style={{ fontSize: 13, fontWeight: 800 }}>Email<textarea rows={isMobile ? 10 : 12} value={body || ''} onChange={e => setEdit(mail, { body: e.target.value })} style={{ ...inputStyle, marginTop: 6, fontWeight: 500, lineHeight: 1.55 }} /></label>
              </div>
            ) : (
              <div style={{ padding: '16px 18px', fontSize: 15, lineHeight: 1.6, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}><Tokens>{body}</Tokens></div>
            )}
            <div style={{ padding: '10px 18px', fontSize: 12, color: C.muted, borderTop: `1px solid ${C.line2}` }}>doddl Ltd · [postal address] · Not for you? Reply “stop” or use the link and we won’t email again.</div>
          </div>
          <Note style={{ marginTop: 10 }}>Words in square brackets are filled from each business’s record.</Note>
          {!ro ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
                <input type="checkbox" checked={lines[mail.id] !== 'rejected'} onChange={e => setApproved(mail.id, e.target.checked)} style={{ width: 20, height: 20, accentColor: C.indigo }} />
                Approve this email
              </label>
              <Btn onClick={() => setEditing(editing === mail.id ? null : mail.id)} style={{ minHeight: 40 }}>{editing === mail.id ? 'Done editing' : 'Edit this email'}</Btn>
              {edit && <Btn onClick={() => setLines(prev => { const n = { ...prev }; delete n[`${mail.id}:edit`]; n[mail.id] = 'approved'; return n })} style={{ minHeight: 40 }}>Undo my edits</Btn>}
            </div>
          ) : (
            lines[mail.id] ? <p style={{ margin: '10px 0 0', fontSize: 14, fontWeight: 800, color: lines[mail.id] === 'rejected' ? C.bad : C.ok }}>{lines[mail.id] === 'rejected' ? 'Not approved' : lines[mail.id] === 'edited' ? 'Approved with edits' : 'Approved'}</p> : null
          )}
        </>
      ) : (
        <p style={{ margin: '12px 0 0', fontSize: 15, lineHeight: 1.6, whiteSpace: 'pre-line' }}>{cur.body || cur.sub || 'A person takes over here.'}</p>
      )}
    </Panel>
  )

  const s = a.sending || {}
  const side = (
    <div style={{ flex: isMobile ? '1 1 100%' : '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 16 }}>
      <Panel>
        <H2>How it sends</H2>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7 }}>
          <b>Sent through</b> {s.via || 'HubSpot sequences, from a separate outreach address'}<br />
          {s.pace ? <><b>Pace</b> {s.pace}<br /></> : null}
          {s.days ? <><b>Days</b> {s.days}<br /></> : null}
          <b>Stops when</b> {s.stops_when || 'they reply, opt out, bounce or book a call'}
        </p>
      </Panel>
      <section style={{ background: C.warnBg, color: '#6B3A00', borderRadius: 12, padding: '12px 14px', fontSize: 14, lineHeight: 1.5 }}>
        <b>Why not Klaviyo for this?</b> Klaviyo is for people who signed up to hear from doddl. Its rules don’t allow emailing lists we found ourselves, and a breach could put the customer email account at risk. Businesses who reply and want to hear more can be added to Klaviyo with their permission.
      </section>
      {(a.checks || []).length > 0 && <Panel><H2>Checks</H2><Checks checks={a.checks} /></Panel>}
    </div>
  )

  const branches = (a.branches || []).filter(Boolean)
  const BR = '200px minmax(0, 1fr) 150px 130px'
  const branchPanel = branches.length > 0 && (
    <Panel>
      <H2>When someone replies: who does what</H2>
      {isMobile ? branches.map((b, i) => (
        <div key={i} style={{ padding: '10px 0', borderTop: i ? '1px solid #F1EEF6' : 0, fontSize: 14, lineHeight: 1.45 }}>
          <b>{b.say}</b>
          <p style={{ margin: '4px 0 0' }}>{b.what}</p>
          <p style={{ margin: '6px 0 0', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{b.who ? <Chip bg={whoTone(b.who).bg} fg={whoTone(b.who).fg}>{b.who}</Chip> : null}<span style={{ color: C.muted, fontSize: 13 }}>{b.fast}</span></p>
        </div>
      )) : (
        <div role="table" aria-label="Reply branches">
          <div role="row" style={{ display: 'grid', gridTemplateColumns: BR, gap: 12, fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted, paddingBottom: 6 }}>
            <span role="columnheader">They say</span><span role="columnheader">What happens</span><span role="columnheader">Who</span><span role="columnheader">How fast</span>
          </div>
          {branches.map((b, i) => (
            <div role="row" key={i} style={{ display: 'grid', gridTemplateColumns: BR, gap: 12, alignItems: 'start', padding: '12px 0', borderTop: '1px solid #F1EEF6', fontSize: 14, lineHeight: 1.45 }}>
              <b role="cell" style={{ minWidth: 0 }}>{b.say}</b>
              <span role="cell" style={{ minWidth: 0 }}>{b.what}</span>
              <span role="cell">{b.who ? <Chip bg={whoTone(b.who).bg} fg={whoTone(b.who).fg} style={{ whiteSpace: 'normal' }}>{b.who}</Chip> : '–'}</span>
              <span role="cell">{b.fast}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 20 }}>
      {flow}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 12 : 20, alignItems: 'flex-start' }}>
        {preview}
        {side}
      </div>
      {branchPanel}
    </div>
  )
}

B2BSequenceReview.approveLabel = (tally, lines) => {
  if (!tally.yes && !tally.no) return 'Approve emails and flow'
  const edited = Object.keys(lines || {}).some(k => k.endsWith(':edit'))
  if (tally.no) return `Approve ${tally.yes} of ${tally.yes + tally.no} emails`
  return edited ? 'Approve with my edits' : 'Approve emails and flow'
}
