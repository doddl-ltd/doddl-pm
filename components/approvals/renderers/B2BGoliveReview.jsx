// b2b_golive: the final card before anyone is contacted: the full list, the first day's batch (business and
// contact ROLE only), the send times and the contacts still to add. A single decision.
import { useState } from 'react'
import { C, Panel, H2, Lbl, Note, Checks, Btn, th, td } from './reviewKit'

export default function B2BGoliveReview({ artefact, isMobile }) {
  const a = artefact || {}
  const batch = (a.first_batch || []).filter(Boolean)
  const [all, setAll] = useState(false)
  const shown = all || batch.length <= 12 ? batch : batch.slice(0, 12)
  const missing = Number(a.contacts_missing) || 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 18 }}>
      <p style={{ margin: 0, color: C.muted, fontSize: 14, maxWidth: 900, lineHeight: 1.5 }}>
        This is the last step before anyone is contacted. Approving starts the first day’s sends; each later day’s batch comes to you as an outreach pack.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
        {[['On the list', a.total ?? '–', C.ink], ['First day', batch.length, C.indigo], ['Contacts still to add', missing, missing ? C.warn : C.ok]].map(([l, v, col]) => (
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
            <H2>Send times</H2>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{a.send_times || 'As set on the emails-and-flow card.'}</p>
          </Panel>
          {missing > 0 && (
            <Panel>
              <H2>Contacts to add</H2>
              <Note style={{ fontSize: 14 }}>{missing} business{missing === 1 ? ' has' : 'es have'} no contact HQ can use yet. They wait until someone adds a contact in HubSpot; this is a task for the campaign owner, not a problem with the list.</Note>
            </Panel>
          )}
          {(a.checks || []).length > 0 && <Panel><H2>Checks</H2><Checks checks={a.checks} /></Panel>}
        </div>
      </div>
    </div>
  )
}

B2BGoliveReview.approveLabel = () => 'Go live'
