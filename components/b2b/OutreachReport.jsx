// Outreach report (docs/b2b-campaigns/OUTREACH-MAIL.md "Reporting"): one campaign (its Report tab) or every campaign
// (B2B → Outreach report), by day / week / whole campaign, filtered by mailbox. GET /api/b2b/report.
// Opens show "not measured" when the campaign has opens switched off (never 0). Clicks leave link scanners out.
import { useCallback, useEffect, useState } from 'react'
import { C, Panel, H2, Note, Pill, StateLine, th, td, selectStyle } from '../approvals/renderers/reviewKit'
import { BackLink } from '../approvals/ui'
import { Tile, font } from './kit'

const BY = [['all', 'Whole campaign'], ['week', 'By week'], ['day', 'By day']]
const pct = (v) => (v == null ? '–' : `${v}%`)
const opens = (v, measured) => (!measured || v == null ? 'not measured' : v)
const REPLY_LABEL = { positive: 'Yes please', question: 'Question', owner: 'Wants the owner', negative: 'Not interested', optout: 'Opted out' }

function Funnel({ f, isMobile }) {
  const steps = [['Found', f.found], ['Contactable', f.contactable], ['E-mailed', f.emailed], ['Replied', f.replied], ['Warm', f.warm], ['Partner', f.partner]]
  const max = Math.max(1, f.found || 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {steps.map(([l, v]) => (
        <div key={l} style={{ display: 'grid', gridTemplateColumns: isMobile ? '92px minmax(0,1fr) 44px' : '120px minmax(0,1fr) 56px', gap: 8, alignItems: 'center', fontSize: 14 }}>
          <b>{l}</b>
          <span style={{ background: C.bg, borderRadius: 6, height: 14, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${Math.round(((v || 0) / max) * 100)}%`, background: C.indigo, borderRadius: 6 }} />
          </span>
          <span style={{ textAlign: 'right', fontWeight: 800 }}>{v || 0}</span>
        </div>
      ))}
    </div>
  )
}

export default function OutreachReport({ campaignId = null, isMobile, fetcher, onBack, embedded = false }) {
  const [by, setBy] = useState('all')
  const [mailbox, setMailbox] = useState('')
  const [campaign, setCampaign] = useState(campaignId || '')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setError('')
      const qs = new URLSearchParams({ by, ...(campaign ? { campaign_id: campaign } : {}), ...(mailbox ? { mailbox_id: mailbox } : {}) })
      setData(await fetcher(`/api/b2b/report?${qs}`))
    } catch (e) { setError(e.message) }
  }, [fetcher, by, mailbox, campaign])
  useEffect(() => { load() }, [load])

  const t = data && data.total
  const measured = !!(data && data.opens_measured)
  const rows = (data && data.rows) || []

  const filters = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: embedded ? 0 : 14 }}>
      <div role="group" aria-label="Period" className="scroll-x" style={{ display: 'flex', gap: 8 }}>
        {BY.map(([v, l]) => <Pill key={v} on={by === v} onClick={() => setBy(v)}>{l}</Pill>)}
      </div>
      {!campaignId && data && (
        <select aria-label="Campaign" value={campaign} onChange={e => setCampaign(e.target.value)} style={{ ...selectStyle, width: isMobile ? '100%' : 260, minHeight: 44 }}>
          <option value="">All campaigns</option>
          {(data.campaigns || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      {data && (data.mailboxes || []).length > 0 && (
        <select aria-label="Mailbox" value={mailbox} onChange={e => setMailbox(e.target.value)} style={{ ...selectStyle, width: isMobile ? '100%' : 240, minHeight: 44 }}>
          <option value="">All mailboxes</option>
          {data.mailboxes.map(m => <option key={m.id} value={m.id}>{m.address}</option>)}
        </select>
      )}
    </div>
  )

  return (
    <div style={{ fontFamily: font, color: C.ink, maxWidth: 1240 }}>
      {!embedded && (
        <>
          {onBack && <BackLink onClick={onBack}>‹ B2B campaigns</BackLink>}
          <h1 style={{ margin: '4px 0 0', fontSize: isMobile ? 24 : 30, fontWeight: 800 }}>Outreach report</h1>
          <p style={{ margin: '6px 0 0', color: C.muted, fontSize: 14, maxWidth: 780, lineHeight: 1.5 }}>Every e-mail PM sent from the trade mailboxes: what was delivered, who clicked and replied, who opted out, and who became a partner in Klaviyo.</p>
        </>
      )}
      {filters}
      <StateLine loading={!data && !error} error={error} />
      {t && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(5, minmax(0, 1fr))', gap: 12, marginTop: 16 }}>
            <Tile label="Sent" value={t.sent} note={`Step 1: ${t.sent_by_step[1] || 0} · 2: ${t.sent_by_step[2] || 0} · 3: ${t.sent_by_step[3] || 0}`} />
            <Tile label="Delivered" value={t.delivered} note={`Hard bounces ${t.bounces_hard} (${pct(t.bounce_rate)}) · soft ${t.bounces_soft}`} color={t.bounce_rate > 5 ? C.bad : C.ink} />
            <Tile label="Opens" value={opens(t.opens, measured)} note={measured ? 'Unique; unreliable with Apple Mail' : 'Switched off for this campaign'} color={measured ? C.ink : C.faint} />
            <Tile label="Clicks" value={t.clicks} note={`${pct(t.click_rate)} of delivered · scanners left out`} />
            <Tile label="Replies" value={t.replies_total} note={`${pct(t.reply_rate)} · auto-replies ${t.auto_replies}`} color={C.indigo} />
            <Tile label="Opt-outs" value={t.optouts} note={pct(t.optout_rate)} color={t.optout_rate > 5 ? C.bad : C.ink} />
            <Tile label="Warm leads" value={data.funnel.warm} note="Replied wanting more" color={C.ok} />
            <Tile label="Partners" value={data.funnel.partner} note={`${data.klaviyo_partners} B2B profiles in Klaviyo in all`} color={C.ok} />
            <Tile label="Still to send" value={data.still_to_send} note="Contactable, not e-mailed yet" />
            <Tile label="Contacts missing" value={data.contacts_missing} note="No usable address yet" color={data.contacts_missing ? C.warn : C.ink} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 12 : 20, marginTop: 16, alignItems: 'flex-start' }}>
            <Panel style={{ flex: isMobile ? '1 1 100%' : '1 1 340px' }}>
              <H2>Funnel</H2>
              <Funnel f={data.funnel} isMobile={isMobile} />
            </Panel>
            <Panel style={{ flex: isMobile ? '1 1 100%' : '1 1 340px' }}>
              <H2>Replies by kind</H2>
              {Object.entries(t.replies).map(([k, v]) => (
                <p key={k} style={{ margin: '6px 0 0', display: 'flex', justifyContent: 'space-between', fontSize: 14 }}><span>{REPLY_LABEL[k] || k}</span><b>{v}</b></p>
              ))}
              <Note style={{ marginTop: 10 }}>A reply stops the sequence for that business. Opt-outs and “not interested” need nobody; the rest go to the named person.</Note>
            </Panel>
          </div>
          {by !== 'all' && (
            <Panel pad={isMobile ? '14px' : '18px 0 0'} style={{ marginTop: 16 }}>
              <H2 style={{ padding: isMobile ? 0 : '0 20px' }}>{by === 'day' ? 'By day' : 'By week (starting Monday)'}</H2>
              {!rows.length ? <Note style={{ padding: isMobile ? 0 : '0 20px 18px' }}>Nothing sent yet.</Note> : isMobile ? rows.map((r, i) => (
                <p key={r.period} style={{ margin: 0, padding: '8px 0', borderTop: i ? `1px solid ${C.line2}` : 0, fontSize: 13 }}>
                  <b>{r.period}</b><br />Sent {r.sent} · delivered {r.delivered} · clicks {r.clicks} · replies {r.replies_total} · opt-outs {r.optouts} · opens {opens(r.opens, measured)}
                </p>
              )) : (
                <div className="scroll-x">
                  <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead><tr>{['Period', 'Sent', 'Delivered', 'Hard bounce', 'Soft', 'Opens', 'Clicks', 'Replies', 'Auto-replies', 'Opt-outs'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                    <tbody>{rows.map(r => (
                      <tr key={r.period}>
                        <td style={{ ...td, fontWeight: 800 }}>{r.period}</td><td style={td}>{r.sent}</td><td style={td}>{r.delivered}</td>
                        <td style={td}>{r.bounces_hard} <span style={{ color: C.muted }}>({pct(r.bounce_rate)})</span></td><td style={td}>{r.bounces_soft}</td>
                        <td style={{ ...td, color: measured ? C.ink : C.faint }}>{opens(r.opens, measured)}</td><td style={td}>{r.clicks}</td>
                        <td style={td}>{r.replies_total} <span style={{ color: C.muted }}>({pct(r.reply_rate)})</span></td><td style={td}>{r.auto_replies}</td><td style={td}>{r.optouts}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              {!isMobile && <div style={{ height: 8 }} />}
            </Panel>
          )}
        </>
      )}
    </div>
  )
}
