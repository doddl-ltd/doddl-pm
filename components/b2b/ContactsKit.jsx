// Contacts and partner pieces for the campaign screen (docs/b2b-campaigns/OUTREACH-MAIL.md "Contacts", "Warm lead →
// partner"). Addresses live in PM only (b2b_contacts); agents never see them. People add, edit, accept or reject
// contacts here; "Make partner lead" hands a warm reply to Klaviyo.
import { useCallback, useEffect, useState } from 'react'
import { C, Panel, H2, Note, Chip, Btn, Field, inputStyle, Radio } from '../approvals/renderers/reviewKit'

const STATUS = { suggested: ['Found on website: accept?', C.warnBg, C.warn], ok: ['Usable', C.okBg, C.ok], bounced: ['Bounced', C.badBg, C.bad], opted_out: ['Opted out', C.badBg, C.bad], invalid: ['No mail server', C.badBg, C.bad], rejected: ['Rejected', C.grey, C.muted] }

function AddForm({ prospectId, fetcher, onDone, isMobile, compact }) {
  const [f, setF] = useState({ email: '', first_name: '', last_name: '', role: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const add = async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetcher(`/api/b2b/prospects/${prospectId}/contacts`, { method: 'POST', body: JSON.stringify({ ...f, is_primary: true }) })
      setF({ email: '', first_name: '', last_name: '', role: '' })
      onDone(r && r.mx_ok === false ? 'Saved, but that domain has no mail server, so it will not be mailed.' : null)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div style={{ background: C.bg, borderRadius: 10, padding: '4px 12px 12px', marginTop: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : compact ? '2fr 1fr 1fr' : '2fr 1fr 1fr 1fr', gap: 8 }}>
        <Field id={`em-${prospectId}`} label="E-mail"><input id={`em-${prospectId}`} type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} style={inputStyle} /></Field>
        <Field id={`fn-${prospectId}`} label="First name"><input id={`fn-${prospectId}`} value={f.first_name} onChange={e => setF({ ...f, first_name: e.target.value })} style={inputStyle} /></Field>
        <Field id={`ln-${prospectId}`} label="Last name"><input id={`ln-${prospectId}`} value={f.last_name} onChange={e => setF({ ...f, last_name: e.target.value })} style={inputStyle} /></Field>
        {!compact && <Field id={`ro-${prospectId}`} label="Role"><input id={`ro-${prospectId}`} value={f.role} onChange={e => setF({ ...f, role: e.target.value })} placeholder="Manager" style={inputStyle} /></Field>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <Btn primary onClick={add} disabled={busy || !f.email.trim()} style={{ minHeight: 44 }}>{busy ? 'Saving…' : 'Add and use this one'}</Btn>
        <Note>Without a first name the e-mail says “Hello,”.</Note>
      </div>
      {err && <p role="alert" style={{ margin: '6px 0 0', color: C.bad, fontSize: 13, fontWeight: 700 }}>{err}</p>}
    </div>
  )
}

/** Every contact of one business: accept / reject, make the one we e-mail, edit, add. */
export function ProspectContacts({ prospectId, fetcher, isMobile, onChanged }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState(null)
  const load = useCallback(async () => { try { setData(await fetcher(`/api/b2b/prospects/${prospectId}/contacts`)) } catch (e) { setErr(e.message) } }, [fetcher, prospectId])
  useEffect(() => { load() }, [load])
  const patch = async (id, body) => {
    setErr('')
    try { await fetcher(`/api/b2b/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }); setEditing(null); await load(); onChanged && onChanged() } catch (e) { setErr(e.message) }
  }
  if (!data) return <Note style={{ padding: '8px 0' }}>{err || 'Loading contacts…'}</Note>
  return (
    <div style={{ padding: '6px 0' }}>
      {data.prospect.website && <Note>Website: <a href={/^https?:/.test(data.prospect.website) ? data.prospect.website : `https://${data.prospect.website}`} target="_blank" rel="noreferrer">{data.prospect.website}</a></Note>}
      {!data.contacts.length && <Note style={{ marginTop: 4 }}>No addresses yet{data.prospect.website ? ' (none found on the website)' : ''}.</Note>}
      {data.contacts.map(c => {
        const s = STATUS[c.status] || STATUS.ok
        return (
          <div key={c.id} style={{ padding: '8px 0', borderTop: `1px solid ${C.line2}`, fontSize: 14 }}>
            {editing && editing.id === c.id ? (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
                <Field id={`e-${c.id}`} label="E-mail"><input id={`e-${c.id}`} value={editing.email} onChange={e => setEditing({ ...editing, email: e.target.value })} style={inputStyle} /></Field>
                <Field id={`f-${c.id}`} label="First name"><input id={`f-${c.id}`} value={editing.first_name} onChange={e => setEditing({ ...editing, first_name: e.target.value })} style={inputStyle} /></Field>
                <Field id={`l-${c.id}`} label="Last name"><input id={`l-${c.id}`} value={editing.last_name} onChange={e => setEditing({ ...editing, last_name: e.target.value })} style={inputStyle} /></Field>
                <Field id={`r-${c.id}`} label="Role"><input id={`r-${c.id}`} value={editing.role} onChange={e => setEditing({ ...editing, role: e.target.value })} style={inputStyle} /></Field>
                <span style={{ display: 'flex', gap: 6 }}>
                  <Btn primary onClick={() => patch(c.id, { email: editing.email, first_name: editing.first_name, last_name: editing.last_name, role: editing.role })} style={{ minHeight: 44 }}>Save</Btn>
                  <Btn onClick={() => setEditing(null)} style={{ minHeight: 44 }}>Cancel</Btn>
                </span>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  <b>{c.email}</b>{c.is_primary ? <Chip bg={C.soft} fg={C.indigo} style={{ marginLeft: 6 }}>We e-mail this one</Chip> : null}
                  <br /><span style={{ color: C.muted, fontSize: 13 }}>{[[c.first_name, c.last_name].filter(Boolean).join(' '), c.role, c.type === 'generic' ? 'main business address' : 'named', (c.source || '').startsWith('website:') ? 'from their website' : c.added_by ? `added by ${c.added_by}` : ''].filter(Boolean).join(' · ')}</span>
                </span>
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Chip bg={s[1]} fg={s[2]}>{s[0]}</Chip>
                  {['suggested', 'rejected', 'invalid'].includes(c.status) && <Btn primary onClick={() => patch(c.id, { action: 'accept' })} style={{ minHeight: 40, padding: '0 12px' }}>Accept</Btn>}
                  {c.status === 'ok' && !c.is_primary && <Btn onClick={() => patch(c.id, { is_primary: true })} style={{ minHeight: 40, padding: '0 12px' }}>E-mail this one</Btn>}
                  {!['bounced', 'opted_out'].includes(c.status) && <Btn onClick={() => setEditing({ id: c.id, email: c.email, first_name: c.first_name || '', last_name: c.last_name || '', role: c.role || '' })} style={{ minHeight: 40, padding: '0 12px' }}>Edit</Btn>}
                  {!['rejected', 'bounced', 'opted_out'].includes(c.status) && <Btn danger onClick={() => patch(c.id, { action: 'reject' })} style={{ minHeight: 40, padding: '0 12px' }}>{c.status === 'suggested' ? 'Reject' : 'Remove'}</Btn>}
                </span>
              </div>
            )}
          </div>
        )
      })}
      <AddForm prospectId={prospectId} fetcher={fetcher} isMobile={isMobile} onDone={(n) => { setNote(n || ''); load(); onChanged && onChanged() }} />
      {note && <p style={{ margin: '6px 0 0', color: C.warn, fontSize: 13, fontWeight: 700 }}>{note}</p>}
      {err && <p role="alert" style={{ margin: '6px 0 0', color: C.bad, fontSize: 13, fontWeight: 700 }}>{err}</p>}
    </div>
  )
}

/** The campaign's "Contacts to add": addresses found on websites to accept, and businesses with none. */
export function ContactsToAdd({ campaignId, owner, fetcher, isMobile, onChanged }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(null)
  const [all, setAll] = useState(false)
  const load = useCallback(async () => { try { setData(await fetcher(`/api/b2b/campaigns/${campaignId}/contacts`)) } catch (e) { setErr(e.message) } }, [fetcher, campaignId])
  useEffect(() => { load() }, [load])
  const decide = async (id, action) => {
    try { await fetcher(`/api/b2b/contacts/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) }); await load(); onChanged && onChanged() } catch (e) { setErr(e.message) }
  }
  const missing = data ? data.missing.filter(m => !m.suggested) : []
  const shown = all ? missing : missing.slice(0, 12)
  return (
    <Panel>
      <H2>Contacts to add</H2>
      {!data ? <Note>{err || 'Loading…'}</Note> : (
        <>
          <Note>{data.counts.with_contact} of {data.counts.businesses} businesses have an address PM can e-mail. PM reads each business’s own website for addresses; people add the rest. Agents never see them.</Note>
          {data.suggested.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <b style={{ fontSize: 14 }}>Found on websites: accept before they are mailed ({data.suggested.length})</b>
              {data.suggested.slice(0, 30).map(c => (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderTop: `1px solid ${C.line2}`, fontSize: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}><b>{c.email}</b><br /><span style={{ color: C.muted, fontSize: 13 }}>{c.prospect ? c.prospect.name : ''}</span></span>
                  <span style={{ display: 'flex', gap: 6 }}>
                    <Btn primary onClick={() => decide(c.id, 'accept')} style={{ minHeight: 40, padding: '0 12px' }}>Accept</Btn>
                    <Btn danger onClick={() => decide(c.id, 'reject')} style={{ minHeight: 40, padding: '0 12px' }}>Reject</Btn>
                  </span>
                </div>
              ))}
            </div>
          )}
          {missing.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: C.bg, borderRadius: 10, padding: '10px 12px', fontSize: 14, lineHeight: 1.45 }}>
                <input type="checkbox" disabled aria-label="To do" style={{ width: 18, height: 18, marginTop: 2, flex: 'none' }} />
                <span><b>For {owner || 'the campaign owner'}: add {missing.length} contact{missing.length === 1 ? '' : 's'}.</b><br /><span style={{ color: C.muted }}>No address found on their website yet. Add one and it is mailed from then on.</span></span>
              </div>
              {shown.map((p, i) => (
                <div key={p.id} style={{ padding: '8px 0', borderTop: i ? `1px solid ${C.line2}` : 0, marginTop: i ? 0 : 8, fontSize: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ minWidth: 0 }}><b>{p.name}</b>{p.place ? <span style={{ color: C.muted }}> · {p.place}</span> : null}<br /><span style={{ color: C.muted, fontSize: 13 }}>{p.checked ? 'Website read: no address found' : 'Website not read yet'}</span></span>
                    <Btn onClick={() => setOpen(open === p.id ? null : p.id)} style={{ minHeight: 40, padding: '0 12px' }} aria-expanded={open === p.id}>{open === p.id ? 'Close' : 'Add contact'}</Btn>
                  </div>
                  {open === p.id && <AddForm prospectId={p.id} fetcher={fetcher} isMobile={isMobile} compact onDone={() => { setOpen(null); load(); onChanged && onChanged() }} />}
                </div>
              ))}
              {missing.length > 12 && <Btn onClick={() => setAll(x => !x)} style={{ minHeight: 40, marginTop: 6 }}>{all ? 'Show 12' : `Show all ${missing.length}`}</Btn>}
            </div>
          )}
          {!data.suggested.length && !missing.length && <Note style={{ marginTop: 8 }}>Every business on the list has an address PM can use.</Note>}
          {err && <p role="alert" style={{ margin: '6px 0 0', color: C.bad, fontSize: 13, fontWeight: 700 }}>{err}</p>}
        </>
      )}
    </Panel>
  )
}

const WANTS = [['trade_pack', 'The trade pack'], ['prices', 'Prices'], ['samples', 'Samples'], ['call', 'A call']]

/** "Make partner lead": what they asked for and their name, then Klaviyo. */
export function PartnerForm({ reply, fetcher, onDone, onCancel }) {
  const [wants, setWants] = useState('trade_pack')
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go = async () => {
    setBusy(true); setErr('')
    try { await fetcher(`/api/b2b/replies/${reply.id}/partner`, { method: 'POST', body: JSON.stringify({ wants, first_name: first || undefined, last_name: last || undefined }) }); onDone() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div style={{ background: C.okBg, borderRadius: 10, padding: '10px 12px', marginTop: 8 }}>
      <b style={{ fontSize: 14 }}>Make partner lead</b>
      <p style={{ margin: '4px 0 0', fontSize: 13, color: C.body }}>They move to Klaviyo (the “B2B partners” list) with a note that they replied asking for this; PM stops e-mailing them.</p>
      <div role="radiogroup" aria-label="What they want" style={{ display: 'flex', flexWrap: 'wrap', gap: '0 16px' }}>
        {WANTS.map(([v, l]) => <Radio key={v} name={`wants-${reply.id}`} checked={wants === v} onChange={() => setWants(v)}>{l}</Radio>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
        <Field id={`pf-${reply.id}`} label="First name (if known)" style={{ marginTop: 4 }}><input id={`pf-${reply.id}`} value={first} onChange={e => setFirst(e.target.value)} style={inputStyle} /></Field>
        <Field id={`pl-${reply.id}`} label="Last name" style={{ marginTop: 4 }}><input id={`pl-${reply.id}`} value={last} onChange={e => setLast(e.target.value)} style={inputStyle} /></Field>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <Btn primary onClick={go} disabled={busy} style={{ minHeight: 44 }}>{busy ? 'Moving to Klaviyo…' : 'Move to Klaviyo'}</Btn>
        <Btn onClick={onCancel} style={{ minHeight: 44 }}>Cancel</Btn>
      </div>
      {err && <p role="alert" style={{ margin: '6px 0 0', color: C.bad, fontSize: 13, fontWeight: 700 }}>{err}</p>}
    </div>
  )
}
