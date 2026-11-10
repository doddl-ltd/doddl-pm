// b2b_golive: the final card before anyone is contacted (docs/b2b-campaigns/OUTREACH-MAIL.md): the full list, the first
// day's batch (business and contact ROLE only), the trade mailbox(es) to send from and the pace, and the contacts still
// to add. A single decision: approving approves the words, the mailboxes and the pace; PM then sends within it.
// The chosen mailboxes go back as decision edits { mailbox_ids } (the decide endpoint refuses a go-live without one).
import { useEffect, useState } from 'react'
import { C, Panel, H2, Lbl, Note, Checks, Btn, Tick, th, td } from './reviewKit'
import { apiFetch } from '../../../lib/supabase'
import { callJson } from '../ui'

const STATUS = { warming: 'warming up', active: 'active' }

export default function B2BGoliveReview({ artefact, isMobile, readOnly, edits, setEdits, task }) {
  const a = artefact || {}
  const batch = (a.first_batch || []).filter(Boolean)
  const [all, setAll] = useState(false)
  const [boxes, setBoxes] = useState(Array.isArray(a.mailboxes) ? a.mailboxes : null)
  const shown = all || batch.length <= 12 ? batch : batch.slice(0, 12)
  const missing = Number(a.contacts_missing) || 0
  const chosen = (edits && Array.isArray(edits.mailbox_ids)) ? edits.mailbox_ids : ((task && task.decision_edits && task.decision_edits.mailbox_ids) || [])

  // Fresh list (a mailbox may have been connected since HQ posted the card).
  useEffect(() => {
    if (readOnly) return
    let live = true
    callJson(apiFetch, '/api/b2b/mailboxes').then(d => {
      if (!live) return
      setBoxes((d.mailboxes || []).filter(m => ['warming', 'active'].includes(m.status)).map(m => ({ id: m.id, address: m.address, status: m.status, allowance: m.allowance_today, daily_cap: m.daily_cap })))
    }).catch(() => {})
    return () => { live = false }
  }, [readOnly])
  useEffect(() => {
    if (readOnly || !setEdits || !boxes || (edits && edits.mailbox_ids)) return
    if (boxes.length === 1) setEdits({ ...(edits || {}), mailbox_ids: [boxes[0].id] })
  }, [boxes, readOnly, setEdits, edits])

  const toggle = (id, on) => {
    const next = on ? [...new Set([...chosen, id])] : chosen.filter(x => x !== id)
    const ed = { ...(edits || {}) }
    if (next.length) ed.mailbox_ids = next; else delete ed.mailbox_ids
    setEdits(ed)
  }
  const pick = (boxes || []).filter(m => chosen.includes(m.id))
  const perDay = pick.reduce((t, m) => t + (Number(m.allowance) || 0), 0)
  const gaps = Array.isArray(a.send_gaps) ? a.send_gaps : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 18 }}>
      <p style={{ margin: 0, color: C.muted, fontSize: 14, maxWidth: 900, lineHeight: 1.5 }}>
        This is the last step before anyone is contacted. Approving approves the words, the mailboxes and the pace: doddl PM then sends from the trade mailboxes you tick, within each one’s warm-up allowance, 09:00–16:30 UK time on weekdays.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        {[['On the list', a.total ?? '–', C.ink], ['First day', batch.length, C.indigo], ['Per day now', pick.length ? perDay : '–', C.indigo], ['Contacts still to add', missing, missing ? C.warn : C.ok]].map(([l, v, col]) => (
          <Panel key={l} pad="12px 16px"><Lbl>{l}</Lbl><p style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 800, color: col }}>{v}</p></Panel>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 12 : 20, alignItems: 'flex-start' }}>
        <Panel pad={isMobile ? '14px' : '18px 0 0'} style={{ flex: isMobile ? '1 1 100%' : '1 1 520px' }}>
          <H2 style={{ padding: isMobile ? 0 : '0 20px' }}>The first day’s businesses</H2>
          {isMobile ? shown.map((b, i) => (
            <p key={b.id} style={{ margin: 0, padding: '8px 0', borderTop: i ? `1px solid ${C.line2}` : 0, fontSize: 14 }}><b>{b.name}</b><br /><span style={{ color: C.muted, fontSize: 13 }}>{[b.place, b.contact_role || 'Contact to add'].filter(Boolean).join(' · ')}</span></p>
          )) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, tableLayout: 'fixed' }}>
              <thead><tr><th style={th}>Business</th><th style={th}>Place</th><th style={th}>Contact</th></tr></thead>
              <tbody>{shown.map(b => <tr key={b.id}><td style={{ ...td, fontWeight: 800, overflowWrap: 'anywhere' }}>{b.name}</td><td style={td}>{b.place || '–'}</td><td style={td}>{b.contact_role || <span style={{ color: C.warn }}>Contact to add</span>}</td></tr>)}</tbody>
            </table>
          )}
          {batch.length > 12 && <div style={{ padding: isMobile ? '8px 0 0' : '10px 20px' }}><Btn onClick={() => setAll(x => !x)} style={{ minHeight: 40 }}>{all ? 'Show 12' : `Show all ${batch.length}`}</Btn></div>}
          {!isMobile && <div style={{ height: 8 }} />}
        </Panel>
        <div style={{ flex: isMobile ? '1 1 100%' : '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 16 }}>
          <Panel>
            <H2>Send from</H2>
            {boxes == null ? <Note>Loading the trade mailboxes…</Note> : !boxes.length ? (
              <Note style={{ color: C.bad }}>No trade mailbox is connected and sending. A PM admin connects one in Settings → Outreach mailboxes first.</Note>
            ) : boxes.map(m => (
              <Tick key={m.id} checked={chosen.includes(m.id)} disabled={readOnly || !setEdits} onChange={(on) => toggle(m.id, on)}>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{m.address}<br /><span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>{STATUS[m.status] || m.status} · {m.allowance ?? '–'} a day now, up to {m.daily_cap ?? 50}</span></span>
              </Tick>
            ))}
            {!readOnly && boxes && boxes.length > 0 && !chosen.length && <p style={{ margin: '6px 0 0', color: C.warn, fontSize: 13, fontWeight: 700 }}>Tick at least one mailbox to go live.</p>}
            <Note style={{ marginTop: 8 }}>Businesses are spread across the ticked mailboxes; each business gets all its e-mails from the same one, as replies in one thread.</Note>
          </Panel>
          <Panel>
            <H2>Pace</H2>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
              {gaps.length ? <>E-mails on day {gaps.join(', ')}, at most 3 per business. </> : null}
              {a.send_times || 'Weekdays 09:00–16:30 UK time, 3–9 minutes apart.'} New mailboxes warm up: 10 a day in week 1, 20 in week 2, 30 in week 3, then their cap. Follow-ups count toward the day.
            </p>
            {a.pace && <p style={{ margin: '6px 0 0', fontSize: 14 }}>{a.pace}</p>}
          </Panel>
          {missing > 0 && (
            <Panel>
              <H2>Contacts to add</H2>
              <Note style={{ fontSize: 14 }}>{missing} business{missing === 1 ? ' has' : 'es have'} no address PM can use yet. They wait until someone adds or accepts a contact on the campaign; this is a task for the campaign owner, not a problem with the list.</Note>
            </Panel>
          )}
          {(a.checks || []).length > 0 && <Panel><H2>Checks</H2><Checks checks={a.checks} /></Panel>}
        </div>
      </div>
    </div>
  )
}

B2BGoliveReview.approveLabel = () => 'Go live'
