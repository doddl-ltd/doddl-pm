// Settings → Outreach mailboxes (docs/b2b-campaigns/OUTREACH-MAIL.md "Mailboxes"): connect Microsoft 365 trade mailboxes
// (PM admins), bring them online over time with a warm-up, and watch their health. GET /api/b2b/mailboxes,
// POST /api/b2b/mailboxes/connect, PATCH /api/b2b/mailboxes/:id.
import { useCallback, useEffect, useState } from 'react'
import { C, Panel, H2, Note, Chip, Btn, StateLine, Field, inputStyle, Tick, fmtWhen } from '../approvals/renderers/reviewKit'
import { Notice } from '../approvals/ui'
import { defaultFetcher, Tile, font } from './kit'

const STATUS = {
  connecting: ['Connecting', C.grey, C.body], warming: ['Warming up', C.blueBg, C.blue], active: ['Active', C.okBg, C.ok],
  paused: ['Paused', C.warnBg, C.warn], error: ['Needs reconnecting', C.badBg, C.bad], disconnected: ['Disconnected', C.grey, C.muted],
}
const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']]
const ERRORS = {
  admin_consent: 'Microsoft needs a Global Admin to approve the "doddl PM outreach" app for the whole tenant first.',
  state: 'The sign-in took too long or came from another browser. Start again.',
  expired: 'The sign-in took too long. Start again.',
  token: 'Microsoft did not accept the sign-in. Try again, signing in as the trade mailbox.',
  no_refresh: 'Microsoft did not allow offline access. Check the app has the offline_access permission.',
  mailbox: 'The account signed in has no mailbox PM can use. Sign in as a licensed user mailbox (shared mailboxes cannot sign in).',
  setup: 'Outreach mail is not set up yet (see below).',
}

function MailboxCard({ m, isAdmin, isMobile, onSaved, fetcher }) {
  const [edit, setEdit] = useState(false)
  const [f, setF] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [confirm, setConfirm] = useState(false)
  const s = STATUS[m.status] || STATUS.connecting
  const w = m.send_window || {}
  const open = () => { setF({ daily_cap: m.daily_cap, send_days: m.send_days || [1, 2, 3, 4, 5], from: w.from || '09:00', to: w.to || '16:30', signature_html: m.signature_html || '', display_name: m.display_name || '' }); setEdit(true); setErr('') }
  const call = async (what, body) => {
    setBusy(what); setErr('')
    try { await fetcher(`/api/b2b/mailboxes/${m.id}`, { method: 'PATCH', body: JSON.stringify(body) }); setEdit(false); setConfirm(false); onSaved() }
    catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const save = () => call('save', { daily_cap: Number(f.daily_cap), send_days: f.send_days, send_window: { from: f.from, to: f.to }, signature_html: f.signature_html, display_name: f.display_name })
  return (
    <Panel>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: '1 1 260px' }}>
          <b style={{ fontSize: 17, overflowWrap: 'anywhere' }}>{m.address}</b>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: C.muted }}>{m.display_name || ''}{m.connected_by ? ` · connected by ${m.connected_by}` : ''}{m.last_polled_at ? ` · inbox read ${fmtWhen(m.last_polled_at)}` : ''}</p>
        </div>
        <Chip bg={s[1]} fg={s[2]}>{s[0]}{m.status === 'warming' && m.warmup_week ? `, week ${m.warmup_week}` : ''}</Chip>
      </div>
      {m.status_reason && <p style={{ margin: '8px 0 0', fontSize: 14, color: ['error', 'paused'].includes(m.status) ? C.bad : C.muted }}>{m.status_reason}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0,1fr))' : 'repeat(5, minmax(0,1fr))', gap: 8, marginTop: 12 }}>
        {[["Today", `${m.sent_today} / ${m.allowance_today}`], ['Last 7 days', m.sent_7d], ['Bounce rate', m.bounce_rate == null ? '–' : `${m.bounce_rate}%`], ['Reply rate', m.reply_rate == null ? '–' : `${m.reply_rate}%`], ['Daily cap', m.daily_cap]].map(([l, v]) => (
          <div key={l} style={{ background: C.bg, borderRadius: 10, padding: '8px 10px' }}><b style={{ display: 'block', fontSize: 18, color: l === 'Bounce rate' && m.bounce_rate > 5 ? C.bad : C.ink }}>{v}</b><span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>{l}</span></div>
        ))}
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 13, color: C.muted }}>
        Sends {(m.send_days || []).map(d => (DAYS.find(x => x[0] === d) || [0, d])[1]).join(', ')}, {w.from || '09:00'}–{w.to || '16:30'} UK time, 3–9 minutes apart{m.in_window_now ? ' · in its window now' : ''}. Warm-up: 10 a day in week 1, 20 in week 2, 30 in week 3, then the daily cap.
      </p>
      {isAdmin && !edit && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {m.status !== 'disconnected' && <Btn onClick={open} style={{ minHeight: 44 }}>Change</Btn>}
          {['warming', 'active'].includes(m.status) && <Btn onClick={() => call('pause', { action: 'pause' })} disabled={!!busy} style={{ minHeight: 44 }}>{busy === 'pause' ? 'Pausing…' : 'Pause'}</Btn>}
          {['paused', 'error'].includes(m.status) && m.status !== 'error' && <Btn primary onClick={() => call('resume', { action: 'resume' })} disabled={!!busy} style={{ minHeight: 44 }}>{busy === 'resume' ? 'Resuming…' : 'Resume'}</Btn>}
          {m.status !== 'disconnected' && !confirm && <Btn danger onClick={() => setConfirm(true)} style={{ minHeight: 44 }}>Disconnect</Btn>}
          {confirm && (
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', background: C.badBg, borderRadius: 10, padding: '6px 10px' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.bad }}>Delete its sign-in? Queued first e-mails move to the campaign’s other mailboxes.</span>
              <Btn danger onClick={() => call('disconnect', { action: 'disconnect' })} disabled={!!busy} style={{ minHeight: 40 }}>Yes, disconnect</Btn>
              <Btn onClick={() => setConfirm(false)} style={{ minHeight: 40 }}>Keep it</Btn>
            </span>
          )}
        </div>
      )}
      {edit && f && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0,1fr))', gap: 12 }}>
            <Field id={`cap-${m.id}`} label="Daily cap (after warm-up)" hint="1–100"><input id={`cap-${m.id}`} type="number" min={1} max={100} value={f.daily_cap} onChange={e => setF({ ...f, daily_cap: e.target.value })} style={inputStyle} /></Field>
            <Field id={`from-${m.id}`} label="From (UK time)"><input id={`from-${m.id}`} type="time" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} style={inputStyle} /></Field>
            <Field id={`to-${m.id}`} label="Until"><input id={`to-${m.id}`} type="time" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} style={inputStyle} /></Field>
          </div>
          <div role="group" aria-label="Send days" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
            {DAYS.map(([d, l]) => <Tick key={d} checked={f.send_days.includes(d)} onChange={(on) => setF({ ...f, send_days: on ? [...f.send_days, d].sort() : f.send_days.filter(x => x !== d) })} style={{ marginRight: 10 }}>{l}</Tick>)}
          </div>
          <Field id={`name-${m.id}`} label="Name shown to people"><input id={`name-${m.id}`} value={f.display_name} onChange={e => setF({ ...f, display_name: e.target.value })} style={inputStyle} /></Field>
          <Field id={`sig-${m.id}`} label="Signature (HTML)" hint="Added under every e-mail, above the footer"><textarea id={`sig-${m.id}`} rows={4} value={f.signature_html} onChange={e => setF({ ...f, signature_html: e.target.value })} style={{ ...inputStyle, fontFamily: 'monospace' }} /></Field>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <Btn primary onClick={save} disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save'}</Btn>
            <Btn onClick={() => setEdit(false)}>Cancel</Btn>
          </div>
        </div>
      )}
      {err && <p role="alert" style={{ margin: '8px 0 0', color: C.bad, fontSize: 13, fontWeight: 700 }}>{err}</p>}
    </Panel>
  )
}

export default function MailboxesView({ isMobile, fetcher = defaultFetcher }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [hint, setHint] = useState('')

  const load = useCallback(async () => {
    try { setData(await fetcher('/api/b2b/mailboxes')) } catch (e) { setError(e.message) }
  }, [fetcher])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (typeof window === 'undefined') return
    const p = new URLSearchParams(window.location.search)
    if (p.get('connected')) setMsg({ tone: 'ok', text: `${p.get('connected')} is connected and starts warming up: 10 e-mails a day this week.` })
    else if (p.get('mailbox_error')) setMsg({ tone: 'bad', code: p.get('mailbox_error'), text: ERRORS[p.get('mailbox_error')] || `The mailbox could not be connected (${p.get('mailbox_error')}).` })
    if (p.get('connected') || p.get('mailbox_error')) window.history.replaceState(window.history.state, '', '/?view=mailboxes')
  }, [])

  const connect = async () => {
    setBusy(true); setMsg(null)
    try {
      const r = await fetcher('/api/b2b/mailboxes/connect', { method: 'POST', body: JSON.stringify(hint ? { login_hint: hint } : {}) })
      window.location.assign(r.url)
    } catch (e) { setMsg({ tone: 'bad', text: e.message }); setBusy(false) }
  }

  const boxes = (data && data.mailboxes) || []
  const setup = (data && data.setup) || {}
  const live = boxes.filter(m => ['warming', 'active'].includes(m.status))
  return (
    <div style={{ fontFamily: font, color: C.ink, maxWidth: 1100 }}>
      <p style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted, margin: '0 0 6px' }}>Settings</p>
      <h1 style={{ margin: 0, fontSize: isMobile ? 24 : 30, fontWeight: 800 }}>Outreach mailboxes</h1>
      <p style={{ margin: '6px 0 0', color: C.muted, fontSize: 14, maxWidth: 780, lineHeight: 1.5 }}>
        B2B e-mails go out from these Microsoft 365 trade mailboxes, at the pace approved on each campaign’s go-live card. Replies, bounces and auto-replies are read back from their inboxes. Klaviyo is never used for cold e-mail.
      </p>
      <StateLine loading={!data && !error} error={error} />
      {msg && (
        <Notice tone={msg.tone === 'ok' ? 'ok' : 'bad'} style={{ marginTop: 14 }}>
          {msg.text}
          {msg.code === 'admin_consent' && setup.admin_consent_url && <> Jon is not a Global Admin: ask a Global Admin to open<a href={setup.admin_consent_url} target="_blank" rel="noreferrer">the admin-consent page</a> once, then connect again.</>}
        </Notice>
      )}
      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0,1fr))' : 'repeat(3, minmax(0,1fr))', gap: 12, marginTop: 18 }}>
            <Tile label="Sending" value={live.length} note={`${boxes.length} connected in all`} />
            <Tile label="Allowed today" value={live.reduce((t, m) => t + (m.allowance_today || 0), 0)} note="Across warming and active mailboxes" color={C.indigo} />
            <Tile label="Sent today" value={boxes.reduce((t, m) => t + (m.sent_today || 0), 0)} />
          </div>
          {!setup.ready && (
            <Notice tone="warn" style={{ marginTop: 14 }}>
              Not set up yet: {setup.missing.join(', ')} {setup.missing.length === 1 ? 'is' : 'are'} missing in the Vercel environment. They come from the single-tenant Entra app “doddl PM outreach” (delegated Mail.Send, Mail.ReadWrite, User.Read, offline_access){setup.redirect_uri ? `, redirect URI ${setup.redirect_uri}` : ''}.
            </Notice>
          )}
          <Panel style={{ marginTop: 16 }}>
            <H2>Connect a Microsoft 365 mailbox</H2>
            {data.is_admin ? (
              <>
                <Note>You will sign in to Microsoft <b>as the trade mailbox</b> (a licensed user mailbox; shared mailboxes cannot sign in). It starts warming up straight away. If Microsoft asks for an administrator, a Global Admin must grant consent once{setup.admin_consent_url ? <> on <a href={setup.admin_consent_url} target="_blank" rel="noreferrer">the admin-consent page</a></> : ''}; Jon is not a Global Admin.</Note>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'flex-end' }}>
                  <Field id="mb-hint" label="Mailbox address (optional)" style={{ marginTop: 0, flex: isMobile ? '1 1 100%' : '0 1 320px' }}>
                    <input id="mb-hint" type="email" value={hint} onChange={e => setHint(e.target.value)} placeholder="trade@…" style={inputStyle} />
                  </Field>
                  <Btn primary onClick={connect} disabled={busy || !setup.ready} style={isMobile ? { width: '100%' } : undefined}>{busy ? 'Opening Microsoft…' : 'Connect a mailbox'}</Btn>
                </div>
              </>
            ) : <Note>Only a PM admin can connect or change mailboxes. You can see their health here.</Note>}
          </Panel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
            {!boxes.length && <Note>No mailboxes yet.</Note>}
            {boxes.map(m => <MailboxCard key={m.id} m={m} isAdmin={data.is_admin} isMobile={isMobile} onSaved={load} fetcher={fetcher} />)}
          </div>
        </>
      )}
    </div>
  )
}
