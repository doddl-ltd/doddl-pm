// One campaign: stage track, the approvals linked per stage (open the existing approval card), prospects with their
// contacts (addresses held in PM, people only), contacts to add, replies waiting with who and by when (Make partner
// lead, Draft in Outlook), sending settings (opens tracking, approve each day's batch), the Report tab, pause / resume /
// cancel. GET /api/b2b/campaigns/:id, PATCH /api/b2b/campaigns/:id, PATCH /api/b2b/replies/:id, /api/b2b/report.
import { useCallback, useEffect, useState } from 'react'
import { C, Panel, H2, Note, Chip, Btn, Pill, StateLine, Tick, th, td, dueText, fmtWhen } from '../approvals/renderers/reviewKit'
import { BackLink } from '../approvals/ui'
import { NextChip, Track, Nums, DefRow, Tags, font } from './kit'
import OutreachReport from './OutreachReport'
import { ProspectContacts, ContactsToAdd, PartnerForm } from './ContactsKit'
import { ResearchPanel, ResearchSummary, WebsiteLink, nameLooksWrong } from './Research'
import { contactText, countryName, areaText, goalName, offerName, channelName, REASON_LABEL, draftEditable } from '../../lib/b2b'

const KIND_LABEL = { definition: 'Who we talk to', sample: 'Sample', words: 'Emails and flow', golive: 'Go live' }
const OUTCOME = {
  approved: ['Approved', C.okBg, C.ok], approved_with_edits: ['Approved with edits', C.okBg, C.ok], partially_approved: ['Partly approved', C.okBg, C.ok],
  revision_requested: ['Sent back', C.warnBg, C.warn], rejected: ['Rejected', C.badBg, C.bad], expired: ['Expired', C.grey, C.body],
}
const STATUS_LABEL = {
  sample: 'In the sample', approved: 'Approved', rejected: 'Rejected', found: 'Found', queued: 'Queued', contacted: 'Contacted', replied: 'Replied', warm: 'Warm lead', partner: 'Partner (Klaviyo)',
  opted_out: 'Opted out', bounced: 'Bounced', excluded: 'Left out',
}
const REPLY_KIND = { positive: 'Yes please', question: 'A question', owner: 'Wants the owner or bulk', ooo: 'Out of office', negative: 'Not interested', optout: 'Opted out', bounce: 'Bounced' }
const FILTERS = [['', 'All'], ['approved,found,queued', 'To contact'], ['contacted,replied', 'Contacted'], ['warm,partner', 'Warm and partners'], ['sample', 'In the sample'], ['rejected,excluded,opted_out,bounced', 'Out']]
const OPENS_WHY = [
  'The UK ICO’s guidance treats e-mail tracking pixels as needing consent under PECR.',
  'Apple Mail Privacy Protection opens every e-mail itself, so open counts are unreliable.',
  'Tracking pixels hurt the delivery of cold e-mail.',
]

function ApprovalRow({ a, onOpen, first }) {
  const o = a.decision ? OUTCOME[a.decision] : null
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', padding: '10px 0', borderTop: first ? 0 : '1px solid #F1EEF6', fontSize: 14, flexWrap: 'wrap' }}>
      <span style={{ minWidth: 0, flex: '1 1 160px' }}>
        <b>{KIND_LABEL[a.kind] || a.title}</b>
        <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{fmtWhen(a.created_at)}{a.decision_by ? ` · ${a.decision_by}` : ''}</span>
      </span>
      <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {o ? <Chip bg={o[1]} fg={o[2]}>{o[0]}{a.decision_at ? `, ${fmtWhen(a.decision_at).split(' ').slice(1, 3).join(' ')}` : ''}</Chip>
          : <Chip bg={C.warnBg} fg={C.warn}>Waiting for {(a.waiting_on || []).join(' or ') || 'the approver'}{a.due_at ? ` · ${dueText(a.due_at)}` : ''}</Chip>}
        {onOpen && <Btn onClick={() => onOpen(a.id)} style={{ minHeight: 36, padding: '0 12px', fontSize: 13 }} aria-label={`Open the ${KIND_LABEL[a.kind] || 'approval'} card`}>Open</Btn>}
      </span>
    </div>
  )
}

function ContactCell({ contact }) {
  const t = contactText(contact)
  return <span>{t.role}<br /><span style={{ fontSize: 12, color: t.has_contact ? C.ok : C.warn }}>{t.has_contact ? t.type + ' · address in PM' : 'No address yet'}</span></span>
}

export default function CampaignDetail({ id, isMobile, fetcher, userName, onBack, onEdit, onOpenApproval }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState('')
  const [actErr, setActErr] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [tab, setTab] = useState('overview')
  const [openP, setOpenP] = useState(null)
  const [openR, setOpenR] = useState(null)
  const [partnerFor, setPartnerFor] = useState(null)
  const [draftMsg, setDraftMsg] = useState({})

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ page: String(page), ...(filter ? { status: filter } : {}) })
      setData(await fetcher(`/api/b2b/campaigns/${id}?${qs}`))
    } catch (e) { setError(e.message) }
  }, [fetcher, id, page, filter])
  useEffect(() => { load() }, [load])

  const act = async (action) => {
    setBusy(action); setActErr('')
    try { await fetcher(`/api/b2b/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) }); setConfirmCancel(false); await load() }
    catch (e) { setActErr(e.message) } finally { setBusy('') }
  }
  const setSetting = async (key, value) => {
    setBusy(key); setActErr('')
    try { await fetcher(`/api/b2b/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify({ [key]: value }) }); await load() }
    catch (e) { setActErr(e.message) } finally { setBusy('') }
  }
  const draftReply = async (rid) => {
    setBusy(rid); setActErr('')
    try { const r = await fetcher(`/api/b2b/replies/${rid}/draft`, { method: 'POST' }); setDraftMsg(m => ({ ...m, [rid]: r })) }
    catch (e) { setActErr(e.message) } finally { setBusy('') }
  }
  const markReply = async (rid, status) => {
    setBusy(rid); setActErr('')
    try { await fetcher(`/api/b2b/replies/${rid}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await load() }
    catch (e) { setActErr(e.message) } finally { setBusy('') }
  }

  if (!data) return <div style={{ fontFamily: font }}><BackLink onClick={onBack}>‹ B2B campaigns</BackLink><StateLine loading={!error} error={error} /></div>

  const c = data.campaign
  const d = c.definition || {}
  const editable = draftEditable(c, data.linked && data.linked.definition)
  const canPause = ['define_review', 'sampling', 'sample_review', 'finding', 'words_review', 'golive_review', 'live'].includes(c.stage)
  const pr = data.prospects
  const pages = Math.max(1, Math.ceil((pr.total || 0) / pr.page_size))
  const waitingReplies = (data.replies || []).filter(r => r.status === 'needs_person')
  const otherReplies = (data.replies || []).filter(r => r.status !== 'needs_person').slice(0, 10)
  const chips = [data.business_type && data.business_type.name, c.market && c.market.country ? areaText(c.market) : null, (c.channels || []).map(channelName).join(', ')].filter(Boolean)

  const header = (
    <>
      <BackLink onClick={onBack}>‹ B2B campaigns</BackLink>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{chips.map((x, i) => <Chip key={i} style={{ whiteSpace: 'normal' }}>{x}</Chip>)}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start', marginTop: 8 }}>
        <div style={{ minWidth: 0, flex: '1 1 420px' }}>
          <h1 style={{ margin: 0, fontSize: isMobile ? 22 : 28, fontWeight: 800, lineHeight: 1.25, overflowWrap: 'anywhere' }}>{c.name || 'Untitled campaign'}</h1>
          <p style={{ margin: '4px 0 0', color: C.muted, fontSize: 14 }}>
            Goal: {[c.goal && c.goal.target ? c.goal.target : goalName(c.goal && c.goal.id), c.goal && c.goal.by].filter(Boolean).join(', ') || '–'} · Owner {c.owner || c.created_by || '–'}
          </p>
        </div>
        <NextChip next={data.next} style={{ fontSize: 13, padding: '5px 12px' }} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        {editable && <Btn primary onClick={onEdit}>{c.stage === 'draft' ? 'Finish and send' : 'Change and send again'}</Btn>}
        {canPause && <Btn onClick={() => act('pause')} disabled={!!busy}>{busy === 'pause' ? 'Pausing…' : 'Pause'}</Btn>}
        {c.stage === 'paused' && <Btn primary onClick={() => act('resume')} disabled={!!busy}>{busy === 'resume' ? 'Resuming…' : 'Resume'}</Btn>}
        {!['done', 'cancelled'].includes(c.stage) && !confirmCancel && <Btn danger onClick={() => setConfirmCancel(true)}>Cancel campaign</Btn>}
        {confirmCancel && (
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', background: C.badBg, borderRadius: 10, padding: '6px 10px' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.bad }}>Stop this campaign for good?</span>
            <Btn danger onClick={() => act('cancel')} disabled={!!busy} style={{ minHeight: 40 }}>{busy === 'cancel' ? 'Cancelling…' : 'Yes, cancel it'}</Btn>
            <Btn onClick={() => setConfirmCancel(false)} style={{ minHeight: 40 }}>Keep it</Btn>
          </span>
        )}
      </div>
      {actErr && <p role="alert" style={{ margin: '10px 0 0', color: C.bad, fontSize: 13, fontWeight: 700 }}>{actErr}</p>}
      <Track steps={data.track} isMobile={isMobile} />
      <Nums nums={data.nums} isMobile={isMobile} />
    </>
  )

  const approvals = (
    <Panel>
      <H2>Approvals for this campaign</H2>
      {!data.approvals.length && <Note>{c.stage === 'draft' ? 'Nothing sent for approval yet.' : 'No approval cards yet.'}</Note>}
      {data.approvals.map((a, i) => <ApprovalRow key={a.id} a={a} first={i === 0} onOpen={onOpenApproval} />)}
    </Panel>
  )

  const replies = (
    <Panel>
      <H2>Replies waiting for a person</H2>
      {!waitingReplies.length && <Note>No replies waiting. A reply stops the sequence for that business; the named person answers it from the trade mailbox.</Note>}
      {waitingReplies.map((r, i) => {
        const overdue = r.due_at && new Date(r.due_at).getTime() < Date.now()
        return (
          <div key={r.id} style={{ padding: '12px 0', borderTop: i ? '1px solid #F1EEF6' : 0, fontSize: 14, lineHeight: 1.45 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <b style={{ minWidth: 0 }}>{r.prospect ? `${r.prospect.name}${r.prospect.place ? `, ${r.prospect.place}` : ''}` : 'A business'}</b>
              <Chip bg={overdue ? C.badBg : C.warnBg} fg={overdue ? C.bad : C.warn}>{r.assigned_to || 'Nobody yet'} · {r.due_at ? dueText(r.due_at) : 'no due time'}</Chip>
            </div>
            <p style={{ margin: '4px 0 0', color: C.body }}><b>{REPLY_KIND[r.kind] || r.kind}.</b> {r.summary}</p>
            {r.draft && <details style={{ marginTop: 6 }}><summary style={{ cursor: 'pointer', fontWeight: 800, color: C.indigo, minHeight: 32, display: 'flex', alignItems: 'center' }}>Draft answer</summary><p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', background: C.bg, borderRadius: 10, padding: '10px 12px' }}>{r.draft}</p></details>}
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <Btn primary onClick={() => markReply(r.id, 'sent')} disabled={busy === r.id} style={{ minHeight: 40 }}>I have sent it</Btn>
              <Btn onClick={() => markReply(r.id, 'closed')} disabled={busy === r.id} style={{ minHeight: 40 }}>Close, no answer needed</Btn>
              {['positive', 'question', 'owner'].includes(r.kind) && partnerFor !== r.id && <Btn primary={r.kind === 'positive'} onClick={() => setPartnerFor(r.id)} style={{ minHeight: 40 }}>Make partner lead</Btn>}
              <Btn onClick={() => draftReply(r.id)} disabled={busy === r.id} style={{ minHeight: 40 }}>Draft in Outlook</Btn>
            </div>
            {draftMsg[r.id] && <Note style={{ marginTop: 6 }}>A draft is waiting in {draftMsg[r.id].mailbox}’s Drafts{draftMsg[r.id].web_link ? <>: <a href={draftMsg[r.id].web_link} target="_blank" rel="noreferrer">open it in Outlook</a></> : ''}. Finish and send it there.</Note>}
            {partnerFor === r.id && <PartnerForm reply={r} fetcher={fetcher} onCancel={() => setPartnerFor(null)} onDone={() => { setPartnerFor(null); load() }} />}
          </div>
        )
      })}
      {waitingReplies.length > 0 && <Note style={{ marginTop: 8 }}>Answer from the trade mailbox in Outlook, then mark it sent here. Sending a reply is always a person’s action; PM never sends one.</Note>}
      {otherReplies.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 800, fontSize: 14, minHeight: 32, display: 'flex', alignItems: 'center' }}>Earlier replies ({otherReplies.length})</summary>
          {otherReplies.map(r => <p key={r.id} style={{ margin: '6px 0 0', fontSize: 13, color: C.body }}>{REPLY_KIND[r.kind] || r.kind} · {r.status === 'auto' ? 'handled automatically' : `${r.status} by ${r.closed_by || '–'}`} · {fmtWhen(r.created_at)}</p>)}
        </details>
      )}
    </Panel>
  )

  const showContacts = !['draft', 'define_review', 'sampling', 'sample_review', 'cancelled'].includes(c.stage)
  const contacts = showContacts ? <ContactsToAdd campaignId={c.id} owner={c.owner || c.created_by} fetcher={fetcher} isMobile={isMobile} onChanged={load} /> : null

  const tracking = c.track_opens
  const settings = (
    <Panel>
      <H2>Sending</H2>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
        {(c.mailbox_ids || []).length ? <>From {c.mailbox_ids.length} trade mailbox{c.mailbox_ids.length === 1 ? '' : 'es'} chosen at go-live, each at its own warm-up pace.</> : 'The mailboxes are chosen on the go-live card.'}
        {(c.send_gaps || []).length ? <> E-mails on day {c.send_gaps.join(', ')}; at most 3 per business, stopped by any reply, bounce or opt-out.</> : null}
      </p>
      <Tick checked={!!c.approve_daily} disabled={busy === 'approve_daily' || ['done', 'cancelled'].includes(c.stage)} onChange={(v) => setSetting('approve_daily', v)} style={{ marginTop: 6 }}>Approve each day’s batch</Tick>
      <Note style={{ marginTop: -4 }}>Off: the go-live approval covers the words, the mailboxes and the pace. On: the first e-mails to new businesses come to you each morning as an outreach pack; follow-ups carry on.</Note>
      <Tick checked={!!tracking} disabled={busy === 'track_opens' || ['done', 'cancelled'].includes(c.stage)} onChange={(v) => setSetting('track_opens', v)} style={{ marginTop: 6 }}>Measure opens (tracking pixel)</Tick>
      <div style={{ background: tracking ? C.warnBg : C.bg, borderRadius: 10, padding: '8px 12px', fontSize: 13, lineHeight: 1.5 }}>
        <b>Off by default.</b> {OPENS_WHY.map((w, i) => <span key={i}>{w} </span>)}With it off, reports say “not measured”. Clicks and replies are always measured.
      </div>
    </Panel>
  )

  const prospectRows = pr.rows || []
  const prospects = (
    <Panel pad={isMobile ? '14px' : '18px 0 0'}>
      <div style={{ padding: isMobile ? 0 : '0 20px' }}>
        <H2>Businesses ({pr.counts && pr.counts.total ? pr.counts.total : 0})</H2>
        <div role="group" aria-label="Filter businesses" className="scroll-x" style={{ display: 'flex', gap: 8, paddingBottom: 8 }}>
          {FILTERS.map(([v, l]) => <Pill key={l} on={filter === v} onClick={() => { setFilter(v); setPage(1) }} style={{ minHeight: 40 }}>{l}</Pill>)}
        </div>
      </div>
      {!prospectRows.length ? <Note style={{ padding: isMobile ? '8px 0' : '8px 20px 20px' }}>{pr.counts && pr.counts.total ? 'None in this view.' : 'HQ adds businesses here once the definition is approved.'}</Note>
        : isMobile ? (
          <div>
            {prospectRows.map((p, i) => (
              <div key={p.id} style={{ padding: '10px 0', borderTop: i ? `1px solid ${C.line2}` : 0, fontSize: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <b style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{p.name}{nameLooksWrong(p.name) ? <span style={{ color: C.warn, fontWeight: 600, fontSize: 12 }}> · name to check</span> : null}</b>
                  {p.fit != null && <b style={{ color: p.fit >= 80 ? C.ok : p.fit >= 65 ? C.warn : C.bad }}>{p.fit}</b>}
                </div>
                <p style={{ margin: '2px 0 0', color: C.muted, fontSize: 13 }}>{[p.place, STATUS_LABEL[p.status], contactText(p.contact).role, p.contact && p.contact.has_contact ? 'address in PM' : 'no address yet'].filter(Boolean).join(' · ')}</p>
                {p.reject_reason && <p style={{ margin: '2px 0 0', color: C.bad, fontSize: 13 }}>Rejected: {REASON_LABEL[p.reject_reason] || p.reject_reason}{p.reject_note ? ` (${p.reject_note})` : ''}</p>}
                <div style={{ marginTop: 4 }}><WebsiteLink p={p} /></div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Btn onClick={() => setOpenR(openR === p.id ? null : p.id)} aria-expanded={openR === p.id} style={{ minHeight: 40, padding: '0 12px', marginTop: 6, fontSize: 13 }}>{openR === p.id ? 'Close research' : 'Research'}</Btn>
                  {showContacts && <Btn onClick={() => setOpenP(openP === p.id ? null : p.id)} aria-expanded={openP === p.id} style={{ minHeight: 40, padding: '0 12px', marginTop: 6, fontSize: 13 }}>{openP === p.id ? 'Close contacts' : 'Contacts'}</Btn>}
                </div>
                {openR === p.id && <ResearchPanel p={p} isMobile />}
                {openP === p.id && <ProspectContacts prospectId={p.id} fetcher={fetcher} isMobile onChanged={load} />}
              </div>
            ))}
          </div>
        ) : (
          <div className="scroll-x">
            <table style={{ width: '100%', minWidth: 680, borderCollapse: 'collapse', fontSize: 14 }}>
              <thead><tr>{['Business', 'Status', 'Contact', 'Fit', 'Why it matches', ''].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {prospectRows.map(p => [
                  <tr key={p.id}>
                    <td style={td}><b>{p.name}</b>{nameLooksWrong(p.name) ? <span style={{ color: C.warn, fontSize: 12 }}> · name to check</span> : null}{p.place ? <><br /><span style={{ color: C.muted }}>{p.place}</span></> : null}<br /><WebsiteLink p={p} /></td>
                    <td style={td}>{STATUS_LABEL[p.status] || p.status}{p.reject_reason ? <><br /><span style={{ color: C.bad, fontSize: 12 }}>{REASON_LABEL[p.reject_reason] || p.reject_reason}{p.reject_note ? `: ${p.reject_note}` : ''}</span></> : null}{p.excluded_reason ? <><br /><span style={{ color: C.muted, fontSize: 12 }}>{p.excluded_reason}</span></> : null}</td>
                    <td style={td}><ContactCell contact={p.contact} /></td>
                    <td style={{ ...td, fontWeight: 800, color: p.fit == null ? C.faint : p.fit >= 80 ? C.ok : p.fit >= 65 ? C.warn : C.bad }}>{p.fit ?? '–'}</td>
                    <td style={td}>{(p.match || []).map((m, j) => <span key={j} style={{ display: 'inline-block', fontSize: 12, fontWeight: 800, borderRadius: 6, padding: '1px 6px', margin: '0 4px 4px 0', background: m.ok === false ? C.grey : C.okBg, color: m.ok === false ? C.muted : C.ok }}>{m.t}</span>)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}><Btn onClick={() => setOpenR(openR === p.id ? null : p.id)} aria-expanded={openR === p.id} style={{ minHeight: 36, padding: '0 12px', fontSize: 13 }}>{openR === p.id ? 'Close' : 'Research'}</Btn>{showContacts && <Btn onClick={() => setOpenP(openP === p.id ? null : p.id)} aria-expanded={openP === p.id} style={{ minHeight: 36, padding: '0 12px', fontSize: 13, marginLeft: 6 }}>{openP === p.id ? 'Close' : 'Contacts'}</Btn>}</td>
                  </tr>,
                  openR === p.id ? <tr key={`${p.id}-r`}><td colSpan={6} style={{ ...td, background: '#FBFAFD' }}><ResearchPanel p={p} isMobile={false} /></td></tr> : null,
                  openP === p.id ? <tr key={`${p.id}-c`}><td colSpan={6} style={{ ...td, background: '#FBFAFD' }}><ProspectContacts prospectId={p.id} fetcher={fetcher} isMobile={false} onChanged={load} /></td></tr> : null,
                ])}
              </tbody>
            </table>
          </div>
        )}
      {pages > 1 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', padding: isMobile ? '10px 0 0' : '12px 20px', borderTop: `1px solid ${C.line2}`, flexWrap: 'wrap' }}>
          <Note>Page {pr.page} of {pages}</Note>
          <span style={{ display: 'flex', gap: 8 }}>
            <Btn onClick={() => setPage(p => Math.max(1, p - 1))} disabled={pr.page <= 1} style={{ minHeight: 40 }}>Previous</Btn>
            <Btn onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={pr.page >= pages} style={{ minHeight: 40 }}>Next</Btn>
          </span>
        </div>
      )}
      {!isMobile && pages <= 1 && <div style={{ height: 8 }} />}
    </Panel>
  )

  const definition = (
    <Panel>
      <details open={!isMobile && c.stage === 'draft'}>
        <summary style={{ cursor: 'pointer', fontSize: 17, fontWeight: 800, minHeight: 32, display: 'flex', alignItems: 'center' }}>Who we want to talk to</summary>
        <DefRow first isMobile={isMobile} labelWidth={130} label="Business type">{d.line || d.own_words || '–'}</DefRow>
        <DefRow isMobile={isMobile} labelWidth={130} label="Kinds"><Tags items={(d.kinds || []).filter(k => k.on !== false).map(k => k.t)} /></DefRow>
        <DefRow isMobile={isMobile} labelWidth={130} label="Size">{d.size || '–'}</DefRow>
        <DefRow isMobile={isMobile} labelWidth={130} label="Must have"><Tags kind="must" items={d.must} /></DefRow>
        <DefRow isMobile={isMobile} labelWidth={130} label="Nice to have"><Tags kind="nice" items={d.nice} /></DefRow>
        <DefRow isMobile={isMobile} labelWidth={130} label="Rule out"><Tags kind="not" items={[...(d.rule_out || []), ...(d.extra_rules || [])]} /></DefRow>
        <DefRow isMobile={isMobile} labelWidth={130} label="Offer">{(c.offers || []).map(offerName).join(', ') || '–'}</DefRow>
        <DefRow isMobile={isMobile} labelWidth={130} label="How many">{c.volume || '–'}; sample of {c.sample_size || '–'}{c.pace ? ` · ${c.pace}` : ''}</DefRow>
        <DefRow isMobile={isMobile} labelWidth={130} label="People">{(c.people || {}).replies || '–'} answers replies; {(c.people || {}).calls || '–'} takes calls and deals</DefRow>
        {(data.business_type && (data.business_type.learned_rules || []).length > 0) && (
          <DefRow isMobile={isMobile} labelWidth={130} label="Learned">{data.business_type.learned_rules.map((r, i) => <p key={i} style={{ margin: i ? '4px 0 0' : 0 }}>{r.rule}</p>)}</DefRow>
        )}
        <DefRow isMobile={isMobile} labelWidth={130} label="Contact rules">{(data.country_rules || []).map((r, i) => <p key={i} style={{ margin: i ? '4px 0 0' : 0 }}>{r}</p>)}</DefRow>
      </details>
    </Panel>
  )

  return (
    <div style={{ fontFamily: font, color: C.ink, maxWidth: 1240 }}>
      {header}
      {showContacts && (
        <div role="tablist" aria-label="Campaign" style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          {[['overview', 'Overview'], ['report', 'Report']].map(([v, l]) => <Pill key={v} role="tab" aria-selected={tab === v} on={tab === v} onClick={() => setTab(v)}>{l}</Pill>)}
        </div>
      )}
      {tab === 'report' && showContacts ? <div style={{ marginTop: 16 }}><OutreachReport campaignId={c.id} fetcher={fetcher} isMobile={isMobile} embedded /></div> : (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 12 : 20, marginTop: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: isMobile ? '1 1 100%' : '1 1 600px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 16 }}>
          {isMobile && approvals}
          {replies}
          <ResearchSummary research={data.research} isMobile={isMobile} />
          {prospects}
          {definition}
        </div>
        <div style={{ flex: isMobile ? '1 1 100%' : '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 16 }}>
          {!isMobile && approvals}
          {showContacts && settings}
          {contacts}
        </div>
      </div>
      )}
    </div>
  )
}
