// B2B outreach mail, the database side (docs/b2b-campaigns/OUTREACH-MAIL.md): mailboxes, contacts, the sender and
// inbox crons, tracking, the Klaviyo partner hand-off and the report. Plain code, no model.
//
// Every function takes a service-role client (lib/server/admin.js). The rules are pure and unit-tested in
// lib/b2bMail/rules.js. Contact details (b2b_contacts) are read here and in /api/b2b/* for signed-in people only:
// nothing in this file is reachable from /api/agent/* or MCP except knownDomains (domain + reason only).

import { B2B_AREA, B2B_PROJECT_ID, b2bError } from '../b2b'
import {
  USABLE_MAILBOX, MAILABLE_PROSPECT, CROSS_CAMPAIGN_DAYS, SOFT_BOUNCE_RETRY_HOURS, addressConfirmed, allowanceFor, approvedEmails, buildMessage,
  campaignPauseReason, classifyInbound, domainOf, firstEmailBlocked, followUpDue, inWindow, isScanner, jitterMs, linkTarget, localParts,
  mailboxPauseReason, nextWorkingDay17, normEmail, referencedIds, runQuota, runsLeft, sendGaps, shouldActivate, validEmail, wallToUtc,
  warmupWeek, buildReport, funnel, redact,
} from '../b2bMail/rules'
import { decryptSecret, encryptSecret, hashToken, newTrackToken, pkcePair, randomState, validToken, mailError } from '../b2bMail/crypto'
import { adminConsentUrl, authorizeUrl, exchangeCode, graphClient, mailConfig, needsAdminConsent, requireConfig, clearTokenCache } from '../b2bMail/graph'
import { extractFromWebsite, hasMx } from '../b2bMail/extract'
import { klaviyoConfig, upsertPartnerProfile, subscribeToPartnerList, PARTNER_WANTS } from '../b2bMail/klaviyo'
import { notify } from './approvals'
import { submitForApproval } from './ops'

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v)
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const DAY = 86400_000
const APPROVED_FAMILY = ['approved', 'approved_with_edits', 'partially_approved']
export const TOKEN_SLOT = '__DODDL_TRACK_TOKEN__'
export const CONNECT_COOKIE = 'b2b_mail_connect'
const SYSTEM = { kind: 'person', agent_id: null, actor: 'doddl PM outreach', scopes: [], on_behalf_of: null }
const MAILBOX_PUBLIC = 'id, address, display_name, signature_html, provider, ms_user_id, status, status_reason, daily_cap, warmup_started_on, send_days, send_window, token_updated_at, last_polled_at, connected_by, created_at, updated_at'
const CONTACT_FIELDS = 'id, prospect_id, email, first_name, last_name, role, type, status, is_primary, source, added_by, checked_at, created_at, updated_at'

function must(result, what) {
  if (result.error) {
    const code = result.error.code
    throw b2bError(code === '23514' || code === '22P02' || code === '23503' ? 400 : code === '23505' ? 409 : 500, `${what}: ${result.error.message}`)
  }
  return result.data
}

async function pageAll(build, cap = 50000) {
  const rows = []
  for (let from = 0; from < cap; from += 1000) {
    const data = must(await build().range(from, from + 999), 'rows')
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return rows
}

async function inChunks(ids, fn, size = 200) {
  const out = []
  const list = [...new Set(ids.filter(Boolean))]
  for (let i = 0; i < list.length; i += size) out.push(...(await fn(list.slice(i, i + size))))
  return out
}

const londonMidnight = (now) => wallToUtc(localParts(now).date, '00:00')

// ─── who may manage mailboxes ───────────────────────────────────────────────

/** PM admins (people.approval_admin) connect and change mailboxes. */
export async function isPmAdmin(db, name) {
  const me = must(await db.from('people').select('name, approval_admin').ilike('name', String(name || '').trim()).maybeSingle(), 'person')
  return !!(me && me.approval_admin)
}

async function requireAdmin(db, name) {
  if (!(await isPmAdmin(db, name))) throw b2bError(403, 'Only a PM admin can connect or change outreach mailboxes')
}

// ─── mailboxes ──────────────────────────────────────────────────────────────

/** A Graph client for a stored mailbox; a 401 on refresh marks it "error: reconnect". */
export function mailboxClient(db, mailbox, { cfg = requireConfig(), fetchImpl = fetch } = {}) {
  if (!mailbox.token_enc) throw mailError(409, `${mailbox.address} is not connected`)
  return graphClient({
    cfg, mailboxId: mailbox.id, fetchImpl,
    getRefresh: async () => decryptSecret(mailbox.token_enc),
    onRotate: async (fresh) => {
      const token_enc = encryptSecret(fresh)
      mailbox.token_enc = token_enc
      await db.from('b2b_mailboxes').update({ token_enc, token_updated_at: new Date().toISOString() }).eq('id', mailbox.id)
    },
  })
}

async function markMailboxError(db, mailbox, e) {
  clearTokenCache(mailbox.id)
  const reason = e && e.reconnect ? 'Microsoft refused the stored sign-in: reconnect this mailbox' : `Error: ${String((e && e.message) || e).slice(0, 200)}`
  await db.from('b2b_mailboxes').update({ status: 'error', status_reason: reason }).eq('id', mailbox.id)
  return reason
}

/** Health figures for each mailbox (Settings → Outreach mailboxes). Never returns token_enc. */
export async function listMailboxes(db, actor, { now = new Date() } = {}) {
  const cfg = mailConfig()
  const rows = must(await db.from('b2b_mailboxes').select(MAILBOX_PUBLIC).order('created_at'), 'mailboxes')
  const since7 = new Date(now.getTime() - 7 * DAY).toISOString()
  const today = londonMidnight(now).toISOString()
  const out = []
  for (const m of rows) {
    const recent = must(await db.from('b2b_messages').select('id, sent_at, status').eq('mailbox_id', m.id).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(100), 'sends')
    const ids = recent.map(r => r.id)
    const ev = ids.length ? must(await db.from('b2b_message_events').select('message_id, kind').in('message_id', ids).in('kind', ['bounce_hard', 'reply']), 'events') : []
    const hard = new Set(ev.filter(e => e.kind === 'bounce_hard').map(e => e.message_id))
    const replied = new Set(ev.filter(e => e.kind === 'reply').map(e => e.message_id))
    out.push({
      ...m,
      warmup_week: warmupWeek(m, now),
      allowance_today: allowanceFor(m, now),
      sent_today: recent.filter(r => r.sent_at >= today).length,
      sent_7d: recent.filter(r => r.sent_at >= since7).length,
      bounce_rate: recent.length ? Math.round((hard.size / recent.length) * 1000) / 10 : null,
      reply_rate: recent.length ? Math.round((replied.size / recent.length) * 1000) / 10 : null,
      in_window_now: inWindow(m, now),
    })
  }
  return {
    is_admin: await isPmAdmin(db, actor),
    setup: { ready: cfg.ready, missing: cfg.missing, redirect_uri: cfg.redirectUri || null, admin_consent_url: adminConsentUrl(cfg) },
    mailboxes: out,
  }
}

/**
 * POST /api/b2b/mailboxes/connect (PM admin): the Microsoft sign-in URL and an encrypted, httpOnly cookie
 * carrying state + PKCE verifier + who started it (10 minutes).
 */
export async function startConnect(db, actor, { loginHint } = {}) {
  await requireAdmin(db, actor)
  const cfg = requireConfig()
  const { verifier, challenge } = pkcePair()
  const state = randomState()
  const cookie = encryptSecret(JSON.stringify({ state, verifier, by: actor, exp: Date.now() + 10 * 60_000 }))
  return { url: authorizeUrl(cfg, { state, challenge, loginHint }), cookie, cookieName: CONNECT_COOKIE, maxAge: 600 }
}

/**
 * GET /api/b2b/mailboxes/callback: checks the state against the cookie, swaps the code (PKCE) for tokens, reads
 * the signed-in mailbox and stores it encrypted, status warming. Returns { address } or { error, consent }.
 */
export async function finishConnect(db, { query = {}, cookie, fetchImpl = fetch, now = new Date() }) {
  const cfg = mailConfig()
  if (query.error) {
    const consent = needsAdminConsent({ code: query.error, description: query.error_description })
    return { error: consent ? 'admin_consent' : String(query.error).slice(0, 60), consent, admin_consent_url: consent ? adminConsentUrl(cfg) : null }
  }
  let saved
  try { saved = JSON.parse(decryptSecret(cookie)) } catch { return { error: 'expired' } }
  if (!saved || saved.exp < now.getTime() || !query.state || query.state !== saved.state) return { error: 'state' }
  if (!cfg.ready) return { error: 'setup' }
  let tokens
  try { tokens = await exchangeCode(cfg, { code: String(query.code || ''), verifier: saved.verifier }, fetchImpl) } catch (e) {
    const consent = needsAdminConsent(e)
    return { error: consent ? 'admin_consent' : 'token', consent, admin_consent_url: consent ? adminConsentUrl(cfg) : null }
  }
  if (!tokens.refresh_token) return { error: 'no_refresh' }
  const meRes = await fetchImpl('https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName,displayName', { headers: { authorization: `Bearer ${tokens.access_token}` } })
  const me = await meRes.json().catch(() => ({}))
  const address = normEmail(me.mail || me.userPrincipalName)
  if (!meRes.ok || !validEmail(address)) return { error: 'mailbox' }
  const existing = must(await db.from('b2b_mailboxes').select('id, warmup_started_on, status').eq('address', address).maybeSingle(), 'mailbox')
  const row = {
    address, display_name: me.displayName || null, ms_user_id: me.id || null, provider: 'm365',
    token_enc: encryptSecret(tokens.refresh_token), token_updated_at: now.toISOString(), connected_by: saved.by,
    status: existing && existing.status === 'active' ? 'active' : 'warming', status_reason: null,
    warmup_started_on: (existing && existing.warmup_started_on) || localParts(now).date,
  }
  if (existing) {
    clearTokenCache(existing.id)
    must(await db.from('b2b_mailboxes').update(row).eq('id', existing.id), 'mailbox')
  } else must(await db.from('b2b_mailboxes').insert([row]), 'mailbox')
  return { address }
}

const MAILBOX_EDITABLE = ['display_name', 'signature_html', 'daily_cap', 'send_days', 'send_window']

/** PATCH /api/b2b/mailboxes/:id (PM admin): cap, days, window, signature; or { action: pause | resume | disconnect }. */
export async function patchMailbox(db, actor, id, input = {}) {
  await requireAdmin(db, actor)
  if (!isUuid(id)) throw b2bError(400, 'mailbox id must be a UUID')
  const m = must(await db.from('b2b_mailboxes').select('id, address, status, warmup_started_on, token_enc').eq('id', id).maybeSingle(), 'mailbox')
  if (!m) throw b2bError(404, `No mailbox ${id}`)
  if (input.action) {
    if (Object.keys(input).some(k => k !== 'action' && k !== 'reason')) throw b2bError(400, 'Send an action on its own')
    if (input.action === 'pause') {
      if (!USABLE_MAILBOX.includes(m.status)) throw b2bError(409, `A ${m.status} mailbox cannot be paused`)
      return must(await db.from('b2b_mailboxes').update({ status: 'paused', status_reason: `Paused by ${actor}${input.reason ? `: ${String(input.reason).slice(0, 200)}` : ''}` }).eq('id', id).select(MAILBOX_PUBLIC).single(), 'mailbox')
    }
    if (input.action === 'resume') {
      if (!['paused', 'error'].includes(m.status)) throw b2bError(409, 'Only a paused mailbox can be resumed')
      if (!m.token_enc) throw b2bError(409, 'Connect the mailbox again first')
      const w = warmupWeek(m)
      return must(await db.from('b2b_mailboxes').update({ status: w != null && w >= 5 ? 'active' : 'warming', status_reason: null }).eq('id', id).select(MAILBOX_PUBLIC).single(), 'mailbox')
    }
    if (input.action === 'disconnect') {
      clearTokenCache(id)
      const up = must(await db.from('b2b_mailboxes').update({ status: 'disconnected', status_reason: `Disconnected by ${actor}`, token_enc: null, delta_link: null }).eq('id', id).select(MAILBOX_PUBLIC).single(), 'mailbox')
      await moveQueuedOff(db, id)
      return up
    }
    throw b2bError(400, 'action must be pause, resume or disconnect')
  }
  const extra = Object.keys(input).filter(k => !MAILBOX_EDITABLE.includes(k))
  if (extra.length) throw b2bError(400, `Unknown field ${extra.join(', ')}. Fields: ${MAILBOX_EDITABLE.join(', ')}`)
  const patch = {}
  if ('display_name' in input) patch.display_name = input.display_name == null ? null : String(input.display_name).slice(0, 120)
  if ('signature_html' in input) patch.signature_html = input.signature_html == null ? null : cleanSignature(input.signature_html)
  if ('daily_cap' in input) {
    const n = Number(input.daily_cap)
    if (!Number.isInteger(n) || n < 1 || n > 100) throw b2bError(400, 'daily_cap must be a whole number from 1 to 100')
    patch.daily_cap = n
  }
  if ('send_days' in input) {
    const d = Array.isArray(input.send_days) ? [...new Set(input.send_days.map(Number))].sort() : null
    if (!d || !d.length || d.some(x => !Number.isInteger(x) || x < 1 || x > 7)) throw b2bError(400, 'send_days must be days 1 (Monday) to 7 (Sunday)')
    patch.send_days = d
  }
  if ('send_window' in input) {
    const w = isObj(input.send_window) ? input.send_window : {}
    const ok = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''))
    if (!ok(w.from) || !ok(w.to) || w.from >= w.to) throw b2bError(400, 'send_window must be { from: "HH:MM", to: "HH:MM" } with from before to')
    patch.send_window = { from: w.from, to: w.to, tz: 'Europe/London' }
  }
  if (!Object.keys(patch).length) throw b2bError(400, 'Nothing to change')
  return must(await db.from('b2b_mailboxes').update(patch).eq('id', id).select(MAILBOX_PUBLIC).single(), 'mailbox')
}

/** Signature HTML: no scripts, event handlers, iframes or javascript: links. */
export function cleanSignature(html) {
  return String(html).slice(0, 5000)
    .replace(/<\s*(script|style|iframe|object|embed|form)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|meta|link)[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"')
}

/** A disconnected mailbox's queued e-mails move to another mailbox of the same campaign (or stop if there is none). */
async function moveQueuedOff(db, mailboxId) {
  const queued = must(await db.from('b2b_messages').select('id, campaign_id, step').eq('mailbox_id', mailboxId).eq('status', 'queued'), 'queued')
  if (!queued.length) return
  const camps = must(await db.from('b2b_campaigns').select('id, mailbox_ids').in('id', [...new Set(queued.map(q => q.campaign_id))]), 'campaigns')
  const usable = new Set(must(await db.from('b2b_mailboxes').select('id').in('status', USABLE_MAILBOX), 'mailboxes').map(m => m.id))
  for (const q of queued) {
    const c = camps.find(x => x.id === q.campaign_id)
    const other = ((c && c.mailbox_ids) || []).find(id => id !== mailboxId && usable.has(id))
    if (other && q.step === 1) await db.from('b2b_messages').update({ mailbox_id: other }).eq('id', q.id)
    else await db.from('b2b_messages').update({ status: 'stopped', error: 'Mailbox disconnected' }).eq('id', q.id)
  }
}

// ─── contacts ───────────────────────────────────────────────────────────────

/** prospect.contact.has_contact (and type) from b2b_contacts: a usable primary exists. */
export async function syncContactFlag(db, prospectIds) {
  for (const id of [...new Set(prospectIds.filter(Boolean))]) {
    const p = must(await db.from('b2b_prospects').select('id, contact').eq('id', id).maybeSingle(), 'prospect')
    if (!p) continue
    const rows = must(await db.from('b2b_contacts').select('type, status, is_primary, role').eq('prospect_id', id), 'contacts')
    const primary = rows.find(r => r.is_primary && r.status === 'ok')
    const prev = isObj(p.contact) ? p.contact : {}
    const next = { role: prev.role || (primary && primary.role) || null, type: primary ? primary.type : (prev.type || 'none'), has_contact: !!primary }
    if (prev.has_contact !== next.has_contact || prev.type !== next.type || 'in_hubspot' in prev || prev.role !== next.role) {
      must(await db.from('b2b_prospects').update({ contact: next }).eq('id', id), 'prospect contact')
    }
  }
}

/** Makes one usable contact primary when none is. */
async function ensurePrimary(db, prospectId) {
  const rows = must(await db.from('b2b_contacts').select('id, type, status, is_primary, created_at').eq('prospect_id', prospectId).order('created_at'), 'contacts')
  const cur = rows.find(r => r.is_primary)
  if (cur && cur.status === 'ok') return
  if (cur) must(await db.from('b2b_contacts').update({ is_primary: false }).eq('id', cur.id), 'primary')
  const pick = rows.filter(r => r.status === 'ok').sort((a, b) => (a.type === b.type ? 0 : a.type === 'named' ? -1 : 1))[0]
  if (pick) must(await db.from('b2b_contacts').update({ is_primary: true }).eq('id', pick.id), 'primary')
}

export async function listProspectContacts(db, prospectId) {
  if (!isUuid(prospectId)) throw b2bError(400, 'prospect id must be a UUID')
  const p = must(await db.from('b2b_prospects').select('id, campaign_id, name, place, details, status, contact, klaviyo_profile_id').eq('id', prospectId).maybeSingle(), 'prospect')
  if (!p) throw b2bError(404, `No business ${prospectId}`)
  const contacts = must(await db.from('b2b_contacts').select(CONTACT_FIELDS).eq('prospect_id', prospectId).order('is_primary', { ascending: false }).order('created_at'), 'contacts')
  return { prospect: { id: p.id, campaign_id: p.campaign_id, name: p.name, place: p.place, status: p.status, website: (p.details || {}).website || null, contact: p.contact }, contacts }
}

function cleanName(v, what) {
  if (v == null || v === '') return null
  const s = String(v).trim()
  if (s.length > 80 || /[<>@]/.test(s)) throw b2bError(400, `${what} must be a name (max 80 characters)`)
  return s
}

/** POST /api/b2b/prospects/:id/contacts { email, first_name?, last_name?, role? } (a person). */
export async function addContact(db, actor, prospectId, input = {}, { resolveMx } = {}) {
  const { prospect } = await listProspectContacts(db, prospectId)
  const email = normEmail(input.email)
  if (!validEmail(email)) throw b2bError(400, 'That is not a valid e-mail address')
  const mx = await hasMx(domainOf(email), resolveMx ? { resolveMx } : {})
  const first = cleanName(input.first_name, 'first_name')
  const row = {
    prospect_id: prospect.id, email, first_name: first, last_name: cleanName(input.last_name, 'last_name'),
    role: input.role ? String(input.role).trim().slice(0, 60) : null, type: first ? 'named' : 'generic',
    status: mx === false ? 'invalid' : 'ok', source: `person:${actor}`, added_by: actor, checked_at: mx === null ? null : new Date().toISOString(),
  }
  const ins = await db.from('b2b_contacts').insert([row]).select(CONTACT_FIELDS).single()
  if (ins.error && ins.error.code === '23505') throw b2bError(409, 'That address is already on this business')
  const c = must(ins, 'contact')
  if (input.is_primary && c.status === 'ok') await setPrimary(db, c)
  else await ensurePrimary(db, prospect.id)
  await syncContactFlag(db, [prospect.id])
  return { contact: c, mx_ok: mx }
}

async function setPrimary(db, c) {
  must(await db.from('b2b_contacts').update({ is_primary: false }).eq('prospect_id', c.prospect_id).eq('is_primary', true), 'primary')
  must(await db.from('b2b_contacts').update({ is_primary: true }).eq('id', c.id), 'primary')
}

/**
 * PATCH /api/b2b/contacts/:id: { first_name?, last_name?, role?, email?, is_primary? } or { action: accept | reject }.
 * A suggested address is not mailed until a person accepts it. Remove = reject (nothing is deleted).
 */
export async function patchContact(db, actor, id, input = {}, { resolveMx } = {}) {
  if (!isUuid(id)) throw b2bError(400, 'contact id must be a UUID')
  const c = must(await db.from('b2b_contacts').select(CONTACT_FIELDS).eq('id', id).maybeSingle(), 'contact')
  if (!c) throw b2bError(404, `No contact ${id}`)
  const patch = {}
  if (input.action) {
    if (input.action === 'accept') {
      if (!['suggested', 'rejected', 'invalid'].includes(c.status)) throw b2bError(409, `This contact is ${c.status}`)
      const mx = await hasMx(domainOf(c.email), resolveMx ? { resolveMx } : {})
      Object.assign(patch, { status: mx === false ? 'invalid' : 'ok', checked_at: new Date().toISOString(), added_by: c.added_by || actor })
    } else if (input.action === 'reject') {
      Object.assign(patch, { status: 'rejected', is_primary: false })
    } else throw b2bError(400, 'action must be accept or reject')
  }
  if ('first_name' in input) { patch.first_name = cleanName(input.first_name, 'first_name'); patch.type = patch.first_name ? 'named' : 'generic' }
  if ('last_name' in input) patch.last_name = cleanName(input.last_name, 'last_name')
  if ('role' in input) patch.role = input.role ? String(input.role).trim().slice(0, 60) : null
  if ('email' in input) {
    const email = normEmail(input.email)
    if (!validEmail(email)) throw b2bError(400, 'That is not a valid e-mail address')
    if (['bounced', 'opted_out'].includes(c.status)) throw b2bError(409, 'This address bounced or opted out; add the new address as another contact')
    patch.email = email
    patch.source = `person:${actor}`
  }
  if (Object.keys(patch).length) {
    const r = await db.from('b2b_contacts').update(patch).eq('id', id).select(CONTACT_FIELDS).single()
    if (r.error && r.error.code === '23505') throw b2bError(409, 'That address is already on this business')
    Object.assign(c, must(r, 'contact'))
  }
  if (input.is_primary === true) {
    if (c.status !== 'ok') throw b2bError(409, 'Only a usable (ok) contact can be the one we e-mail')
    await setPrimary(db, c)
    c.is_primary = true
  }
  await ensurePrimary(db, c.prospect_id)
  await syncContactFlag(db, [c.prospect_id])
  return c
}

/** "Contacts to add" for a campaign: addresses found on websites waiting to be accepted, and businesses with none. */
export async function campaignContacts(db, campaignId) {
  if (!isUuid(campaignId)) throw b2bError(400, 'campaign id must be a UUID')
  const pros = await pageAll(() => db.from('b2b_prospects').select('id, name, place, status, contact, contacts_checked_at, details').eq('campaign_id', campaignId).in('status', MAILABLE_PROSPECT).order('name'))
  const contacts = await inChunks(pros.map(p => p.id), (ids) => db.from('b2b_contacts').select(CONTACT_FIELDS).in('prospect_id', ids).then(r => must(r, 'contacts')))
  const byP = {}
  for (const c of contacts) (byP[c.prospect_id] || (byP[c.prospect_id] = [])).push(c)
  const suggested = contacts.filter(c => c.status === 'suggested').map(c => ({ ...c, prospect: pros.find(p => p.id === c.prospect_id) && { id: c.prospect_id, name: pros.find(p => p.id === c.prospect_id).name } }))
  const missing = pros.filter(p => !(byP[p.id] || []).some(c => c.status === 'ok' && c.is_primary)).map(p => ({
    id: p.id, name: p.name, place: p.place, website: (p.details || {}).website || null, checked: !!p.contacts_checked_at,
    suggested: (byP[p.id] || []).filter(c => c.status === 'suggested').length,
  }))
  return { suggested, missing, counts: { businesses: pros.length, with_contact: pros.length - missing.length, missing: missing.length, suggested: suggested.length } }
}

/**
 * Cron /api/cron/b2b-contacts: for approved / found businesses not yet checked, read their website and save the
 * addresses (generic -> ok, personal -> suggested). At most `max` businesses a run.
 */
export async function runContacts(db, { max = 12, fetchImpl = fetch, resolveMx, pauseMs = 500, now = new Date() } = {}) {
  const camps = must(await db.from('b2b_campaigns').select('id').is('archived_at', null).in('stage', ['finding', 'words_review', 'golive_review', 'live', 'paused']), 'campaigns')
  const out = { checked: 0, generic: 0, suggested: 0, invalid: 0, errors: [] }
  if (!camps.length) return out
  const todo = must(await db.from('b2b_prospects').select('id, name, details, status').in('campaign_id', camps.map(c => c.id)).in('status', ['approved', 'found', 'queued'])
    .is('contacts_checked_at', null).order('fit', { ascending: false, nullsFirst: false }).limit(max), 'prospects')
  for (const p of todo) {
    try {
      const site = (p.details || {}).website
      const found = site ? await extractFromWebsite(site, { fetchImpl, pauseMs }) : { contacts: [] }
      for (const c of found.contacts) {
        const mx = await hasMx(domainOf(c.email), resolveMx ? { resolveMx, now: now.getTime() } : {})
        const status = c.status === 'ok' && mx === false ? 'invalid' : c.status
        const ins = await db.from('b2b_contacts').insert([{ prospect_id: p.id, email: c.email, type: c.type, status, source: c.source, added_by: 'website', checked_at: mx === null ? null : now.toISOString() }])
        if (ins.error && ins.error.code !== '23505') throw new Error(ins.error.message)
        if (!ins.error) out[status === 'invalid' ? 'invalid' : c.type === 'generic' ? 'generic' : 'suggested']++
      }
      await ensurePrimary(db, p.id)
      await syncContactFlag(db, [p.id])
      out.checked++
    } catch (e) {
      out.errors.push(`${p.name}: ${String(e.message).slice(0, 160)}`)
    }
    await db.from('b2b_prospects').update({ contacts_checked_at: now.toISOString() }).eq('id', p.id)
  }
  return out
}

// ─── suppression ────────────────────────────────────────────────────────────

export async function loadSuppressions(db) {
  const rows = await pageAll(() => db.from('b2b_suppressions').select('email, domain').order('id'))
  const emails = new Set(rows.filter(r => r.email).map(r => r.email))
  const domains = new Set(rows.filter(r => !r.email && r.domain).map(r => r.domain))
  return { emails, domains, suppressed: (email, domain) => emails.has(normEmail(email)) || (!!domain && domains.has(domain)) }
}

export async function suppress(db, { email = null, domain = null, reason, messageId = null, by = 'system' }) {
  const row = { email: email ? normEmail(email) : null, domain: domain ? String(domain).toLowerCase() : (email ? domainOf(email) : null), reason, source_message_id: messageId, created_by: by }
  if (!row.email && !row.domain) return
  if (row.email) {
    const ins = await db.from('b2b_suppressions').insert([row])
    if (ins.error && ins.error.code !== '23505') throw new Error(ins.error.message)
  } else {
    const ins = await db.from('b2b_suppressions').insert([{ ...row, email: null }])
    if (ins.error && ins.error.code !== '23505') throw new Error(ins.error.message)
  }
}

/** Stops everything queued for a business (opt-out, bounce, partner, reply). */
async function stopProspect(db, prospectId, why) {
  await db.from('b2b_messages').update({ status: 'stopped', error: why }).eq('prospect_id', prospectId).eq('status', 'queued')
}

async function addEvent(db, messageId, kind, detail = {}, at = new Date()) {
  must(await db.from('b2b_message_events').insert([{ message_id: messageId, kind, detail, at: at.toISOString() }]), 'event')
}

// ─── the sender ─────────────────────────────────────────────────────────────

function stableIndex(id, n) {
  let h = 0
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return n ? h % n : 0
}

async function loadLive(db) {
  const camps = must(await db.from('b2b_campaigns').select('id, name, stage, channels, market, mailbox_ids, send_gaps, track_opens, approve_daily, words_task_id, owner, created_by, people, business_type_id')
    .eq('stage', 'live').is('archived_at', null), 'campaigns')
  const taskIds = camps.map(c => c.words_task_id).filter(Boolean)
  const tasks = taskIds.length ? must(await db.from('tasks').select('id, decision, artefact, line_decisions').in('id', taskIds), 'words') : []
  for (const c of camps) {
    c.emails = approvedEmails(tasks.find(t => t.id === c.words_task_id))
    c.gaps = Array.isArray(c.send_gaps) && c.send_gaps.length ? c.send_gaps : sendGaps(c.emails)
  }
  return camps.filter(c => c.emails.length && (c.channels || []).includes('email'))
}

/** Domain -> set of campaign ids e-mailed in the last 30 days. */
async function recentDomains(db, now) {
  const since = new Date(now.getTime() - CROSS_CAMPAIGN_DAYS * DAY).toISOString()
  const msgs = await pageAll(() => db.from('b2b_messages').select('campaign_id, contact_id').not('sent_at', 'is', null).gte('sent_at', since).order('id'))
  const contacts = await inChunks(msgs.map(m => m.contact_id), (ids) => db.from('b2b_contacts').select('id, email').in('id', ids).then(r => must(r, 'contacts')))
  const em = Object.fromEntries(contacts.map(c => [c.id, c.email]))
  const out = new Map()
  for (const m of msgs) {
    const d = domainOf(em[m.contact_id])
    if (!d) continue
    if (!out.has(d)) out.set(d, new Set())
    out.get(d).add(m.campaign_id)
  }
  return out
}

/** Prepares a message row (body with a token slot, no token yet). */
function draftRow({ campaign, prospect, contact, mailbox, email, base }) {
  const built = buildMessage({ email, prospect, contact, mailbox, base, token: TOKEN_SLOT, trackOpens: !!campaign.track_opens })
  return { campaign_id: campaign.id, prospect_id: prospect.id, contact_id: contact.id, mailbox_id: mailbox.id, step: email.step, subject: built.subject, body_html: built.html, links: built.links, opens_tracked: !!campaign.track_opens, status: 'queued' }
}

/**
 * Sends one prepared message through Graph: a new draft for step 1 (or when there is no first message to reply to),
 * a threaded reply for steps 2 and 3. The body gets a fresh token; only its hash is stored. Returns the updated row.
 */
async function sendRow(db, client, row, { contact, firstGraphId, now }) {
  const token = newTrackToken()
  const html = String(row.body_html).split(TOKEN_SLOT).join(token)
  const draft = firstGraphId ? await client.createReplyDraft(firstGraphId, { html }) : await client.createDraft({ to: contact.email, toName: [contact.first_name, contact.last_name].filter(Boolean).join(' ') || undefined, subject: row.subject, html })
  await client.send(draft.id)
  const up = must(await db.from('b2b_messages').update({
    status: 'sent', sent_at: now.toISOString(), graph_id: draft.id, internet_message_id: draft.internetMessageId || null, conversation_id: draft.conversationId || null,
    track_token_hash: hashToken(token), error: null,
  }).eq('id', row.id).select('id, campaign_id, prospect_id, step, sent_at').single(), 'sent')
  await addEvent(db, row.id, 'sent', { step: row.step }, now)
  await db.from('b2b_prospects').update({ status: 'contacted' }).eq('id', row.prospect_id).in('status', ['approved', 'found', 'queued'])
  return up
}

async function failRow(db, row, e, now) {
  const msg = String((e && e.message) || e).slice(0, 300)
  if (row.error) return must(await db.from('b2b_messages').update({ status: 'failed', error: msg }).eq('id', row.id), 'failed')
  return must(await db.from('b2b_messages').update({ status: 'queued', error: msg, scheduled_for: new Date(now.getTime() + 5 * 60_000).toISOString() }).eq('id', row.id), 'retry')
}

/**
 * Cron /api/cron/b2b-send (every 10 min). For each warming/active mailbox inside its window with allowance left:
 * queued retries and approved daily-batch lines, then follow-ups, then new businesses (best fit first), each
 * passing every hard rule. Approve-daily campaigns get their pack created here.
 */
export async function runSend(db, { now = new Date(), random = Math.random, sleep = (ms) => new Promise(r => setTimeout(r, ms)), fetchImpl = fetch, deadlineMs = 240_000 } = {}) {
  const started = Date.now()
  const out = { sent: 0, failed: 0, packs: 0, mailboxes: [], errors: [] }
  if (!addressConfirmed()) return { ...out, paused: true, reason: 'The footer\'s registered address / company number is TO CONFIRM (lib/b2bMail/rules.js); nothing is sent until it is set' }
  const cfg = mailConfig()
  if (!cfg.ready) return { ...out, enabled: false, reason: `missing ${cfg.missing.join(', ')}` }
  const mailboxes = must(await db.from('b2b_mailboxes').select('*').in('status', USABLE_MAILBOX), 'mailboxes')
  for (const m of mailboxes) if (shouldActivate(m, now)) { await db.from('b2b_mailboxes').update({ status: 'active' }).eq('id', m.id); m.status = 'active' }
  const campaigns = await loadLive(db)
  if (!campaigns.length || !mailboxes.length) return { ...out, reason: !campaigns.length ? 'no live e-mail campaign with approved words' : 'no usable mailbox' }
  const sup = await loadSuppressions(db)
  const recent = await recentDomains(db, now)
  const usableIds = new Set(mailboxes.map(m => m.id))
  const today = londonMidnight(now).toISOString()

  try { out.packs = await dailyPacks(db, { campaigns, mailboxes, sup, recent, now, cfg }) } catch (e) { out.errors.push(`packs: ${e.message}`) }

  for (const mb of mailboxes) {
    const info = { address: mb.address, sent: 0 }
    out.mailboxes.push(info)
    if (!inWindow(mb, now)) { info.skipped = 'outside the send window'; continue }
    const countRes = await db.from('b2b_messages').select('id', { count: 'exact', head: true }).eq('mailbox_id', mb.id).gte('sent_at', today)
    const already = countRes.count || 0
    const quota = runQuota({ allowance: allowanceFor(mb, now), sentToday: already, runs: runsLeft(mb, now), random })
    info.allowance = allowanceFor(mb, now); info.sent_today = already; info.quota = quota
    if (!quota) continue
    const last = must(await db.from('b2b_messages').select('sent_at').eq('mailbox_id', mb.id).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(1), 'last')[0]
    if (last && now.getTime() - new Date(last.sent_at).getTime() < 3 * 60_000) { info.skipped = 'sent less than 3 minutes ago'; continue }
    const mine = campaigns.filter(c => (c.mailbox_ids || []).includes(mb.id))
    let work
    try { work = await nextWork(db, mb, mine, { quota, sup, recent, usableIds, now, campaigns }) } catch (e) { out.errors.push(`${mb.address}: ${e.message}`); continue }
    if (!work.length) continue
    let client
    try { client = mailboxClient(db, mb, { cfg, fetchImpl }) } catch (e) { out.errors.push(`${mb.address}: ${e.message}`); continue }
    for (const [i, w] of work.entries()) {
      if (Date.now() - started > deadlineMs) break
      if (i) await sleep(jitterMs(20_000, 50_000, random))
      let row = w.row
      try {
        if (!row.id) row = must(await db.from('b2b_messages').insert([row]).select('*').single(), 'queue')
        await sendRow(db, client, row, { contact: w.contact, firstGraphId: w.firstGraphId, now: new Date() })
        out.sent++; info.sent++
      } catch (e) {
        if (e.reconnect) { info.error = await markMailboxError(db, mb, e); break }
        out.failed++
        out.errors.push(`${mb.address}: ${String(e.message).slice(0, 160)}`)
        if (row && row.id) await failRow(db, row, e, now)
      }
    }
  }
  return out
}

/** What one mailbox sends this run: [{ row, contact, firstGraphId }]. */
async function nextWork(db, mb, mine, { quota, sup, recent, usableIds, now, campaigns }) {
  const work = []
  const campById = Object.fromEntries(campaigns.map(c => [c.id, c]))
  // 1) queued: retries (soft bounce, failed once) and approved daily-batch lines.
  const queued = must(await db.from('b2b_messages').select('*').eq('mailbox_id', mb.id).eq('status', 'queued').order('created_at').limit(50), 'queued')
  const packIds = [...new Set(queued.map(q => q.pack_task_id).filter(Boolean))]
  const packs = packIds.length ? Object.fromEntries(must(await db.from('tasks').select('id, decision, line_decisions').in('id', packIds), 'packs').map(t => [t.id, t])) : {}
  for (const q of queued) {
    if (work.length >= quota) break
    const c = campById[q.campaign_id]
    if (!c) continue
    if (q.scheduled_for && new Date(q.scheduled_for).getTime() > now.getTime()) continue
    if (q.pack_task_id) {
      const t = packs[q.pack_task_id]
      if (!t || !t.decision) continue
      const line = (t.line_decisions || {})[q.id]
      const yes = APPROVED_FAMILY.includes(t.decision) && line !== 'rejected' && (line != null || t.decision !== 'partially_approved')
      if (!yes) { await db.from('b2b_messages').update({ status: 'stopped', error: t.decision === 'expired' ? 'Daily batch expired' : 'Not approved in the daily batch' }).eq('id', q.id); continue }
    }
    const contact = q.contact_id ? must(await db.from('b2b_contacts').select(CONTACT_FIELDS).eq('id', q.contact_id).maybeSingle(), 'contact') : null
    const prospect = must(await db.from('b2b_prospects').select('id, status, klaviyo_profile_id').eq('id', q.prospect_id).maybeSingle(), 'prospect')
    if (!contact || contact.status !== 'ok' || sup.suppressed(contact.email, domainOf(contact.email)) || !prospect || !['approved', 'found', 'queued', 'contacted'].includes(prospect.status) || prospect.klaviyo_profile_id) {
      await db.from('b2b_messages').update({ status: 'stopped', error: 'No longer allowed (suppressed, replied or contact changed)' }).eq('id', q.id)
      continue
    }
    let firstGraphId = null
    if (q.step > 1) {
      const first = must(await db.from('b2b_messages').select('graph_id').eq('prospect_id', q.prospect_id).eq('campaign_id', q.campaign_id).eq('step', 1).not('sent_at', 'is', null).limit(1), 'first')[0]
      firstGraphId = first ? first.graph_id : null
    }
    work.push({ row: q, contact, firstGraphId })
  }
  if (work.length >= quota || !mine.length) return work

  // 2) follow-ups for businesses whose first e-mail came from this mailbox.
  const ids = mine.map(c => c.id)
  const sent = await pageAll(() => db.from('b2b_messages').select('id, campaign_id, prospect_id, contact_id, step, sent_at, status, graph_id, mailbox_id').eq('mailbox_id', mb.id).in('campaign_id', ids).not('sent_at', 'is', null).order('id'))
  const byP = {}
  for (const m of sent) (byP[`${m.campaign_id}:${m.prospect_id}`] || (byP[`${m.campaign_id}:${m.prospect_id}`] = [])).push(m)
  const open = Object.values(byP).filter(list => {
    const c = campById[list[0].campaign_id]
    return c && Math.max(...list.map(m => m.step)) < c.emails.length && !list.some(m => ['bounced', 'replied', 'stopped'].includes(m.status))
  })
  if (open.length) {
    const msgIds = open.flat().map(m => m.id)
    const events = await inChunks(msgIds, (chunk) => db.from('b2b_message_events').select('message_id, kind, at').in('message_id', chunk).in('kind', ['reply', 'bounce_hard', 'optout', 'auto_reply']).then(r => must(r, 'events')))
    const pros = await inChunks(open.map(l => l[0].prospect_id), (chunk) => db.from('b2b_prospects').select('id, name, place, status, klaviyo_profile_id').in('id', chunk).then(r => must(r, 'prospects')))
    const contacts = await inChunks(open.map(l => l[0].contact_id), (chunk) => db.from('b2b_contacts').select(CONTACT_FIELDS).in('id', chunk).then(r => must(r, 'contacts')))
    const pending = new Set(must(await db.from('b2b_messages').select('prospect_id').eq('mailbox_id', mb.id).eq('status', 'queued'), 'queued').map(q => q.prospect_id))
    for (const list of open) {
      if (work.length >= quota) break
      const c = campById[list[0].campaign_id]
      const prospect = pros.find(p => p.id === list[0].prospect_id)
      const contact = contacts.find(x => x.id === list[0].contact_id)
      if (!prospect || pending.has(prospect.id) || prospect.klaviyo_profile_id) continue
      const due = followUpDue({ sent: list, events, gaps: c.gaps, steps: c.emails.length, prospect, contact, suppressed: sup.suppressed, now })
      if (!due) continue
      const email = c.emails[due.step - 1]
      const row = draftRow({ campaign: c, prospect, contact, mailbox: mb, email, base: requireConfig().base })
      work.push({ row, contact, firstGraphId: due.first.graph_id })
    }
  }
  if (work.length >= quota) return work

  // 3) new businesses, best fit first, spread round-robin over the campaign's usable mailboxes.
  for (const c of mine.filter(x => !x.approve_daily)) {
    if (work.length >= quota) break
    const picks = await eligibleFirsts(db, c, { limit: quota - work.length, sup, recent, now, mailboxFilter: (p) => {
      const usable = (c.mailbox_ids || []).filter(id => usableIds.has(id))
      return usable[stableIndex(p.id, usable.length)] === mb.id
    } })
    for (const p of picks) work.push({ row: draftRow({ campaign: c, prospect: p.prospect, contact: p.contact, mailbox: mb, email: c.emails[0], base: requireConfig().base }), contact: p.contact, firstGraphId: null })
  }
  return work
}

/** New businesses that pass every hard rule for a campaign: [{ prospect, contact }] (best fit first). */
async function eligibleFirsts(db, c, { limit, sup, recent, now, mailboxFilter = () => true, exclude = new Set() }) {
  if (limit <= 0) return []
  const out = []
  const started = new Set((await pageAll(() => db.from('b2b_messages').select('prospect_id').eq('campaign_id', c.id).in('status', ['queued', 'sent', 'bounced', 'replied']).order('id'))).map(m => m.prospect_id))
  for (let from = 0; from < 5000 && out.length < limit; from += 200) {
    const page = must(await db.from('b2b_prospects').select('id, name, place, status, details, klaviyo_profile_id, contact').eq('campaign_id', c.id).in('status', ['approved', 'found', 'queued'])
      .order('fit', { ascending: false, nullsFirst: false }).order('id').range(from, from + 199), 'prospects')
    const cand = page.filter(p => !started.has(p.id) && !exclude.has(p.id) && p.contact && p.contact.has_contact && mailboxFilter(p))
    if (cand.length) {
      const contacts = must(await db.from('b2b_contacts').select(CONTACT_FIELDS).in('prospect_id', cand.map(p => p.id)).eq('is_primary', true), 'contacts')
      for (const p of cand) {
        if (out.length >= limit) break
        const contact = contacts.find(x => x.prospect_id === p.id)
        if (contact && (!contact.checked_at || new Date(contact.checked_at).getTime() < now.getTime() - 30 * DAY)) {
          const mx = await hasMx(domainOf(contact.email))
          if (mx !== null) {
            contact.checked_at = now.toISOString()
            if (mx === false) contact.status = 'invalid'
            await db.from('b2b_contacts').update({ checked_at: contact.checked_at, ...(mx === false ? { status: 'invalid', is_primary: false } : {}) }).eq('id', contact.id)
            if (mx === false) await syncContactFlag(db, [p.id])
          }
        }
        const dom = contact ? domainOf(contact.email) : null
        const others = dom && recent.get(dom) ? [...recent.get(dom)].filter(id => id !== c.id) : []
        const blocked = firstEmailBlocked({ campaign: c, prospect: p, contact, suppressed: sup.suppressed, otherCampaignWithin30: others.length > 0, partnerDomain: false, stepsSent: 0 })
        if (!blocked) out.push({ prospect: p, contact })
      }
    }
    if (page.length < 200) break
  }
  return out
}

/** Approve-daily campaigns: once a UK day, inside a mailbox window, today's new businesses go out as an outreach pack. */
async function dailyPacks(db, { campaigns, mailboxes, sup, recent, now, cfg }) {
  let made = 0
  const today = londonMidnight(now).toISOString()
  for (const c of campaigns.filter(x => x.approve_daily)) {
    const usable = mailboxes.filter(m => (c.mailbox_ids || []).includes(m.id))
    if (!usable.length || !usable.some(m => inWindow(m, now))) continue
    const exists = must(await db.from('b2b_messages').select('id').eq('campaign_id', c.id).not('pack_task_id', 'is', null).gte('created_at', today).limit(1), 'pack')
    if (exists.length) continue
    const cap = Math.min(25, usable.reduce((t, m) => t + allowanceFor(m, now), 0))
    const picks = await eligibleFirsts(db, c, { limit: cap, sup, recent, now })
    if (!picks.length) continue
    const rows = picks.map((p) => {
      const ok = usable.filter(m => USABLE_MAILBOX.includes(m.status))
      const mb = ok[stableIndex(p.prospect.id, ok.length)]
      return draftRow({ campaign: c, prospect: p.prospect, contact: p.contact, mailbox: mb, email: c.emails[0], base: cfg.base })
    })
    const saved = must(await db.from('b2b_messages').insert(rows).select('id, prospect_id, subject'), 'pack rows')
    const lines = saved.map(s => {
      const p = picks.find(x => x.prospect.id === s.prospect_id)
      return { id: s.id, target: [p.prospect.name, p.prospect.place].filter(Boolean).join(', '), after: s.subject, why: p.contact.type === 'named' ? `Named contact${p.contact.role ? ` (${p.contact.role})` : ''}` : 'Main business e-mail', detail: 'E-mail 1' }
    })
    try {
      const task = await submitForApproval(db, SYSTEM, {
        title: `Today's e-mails: ${c.name} (${lines.length})`, project_id: B2B_PROJECT_ID, artefact_type: 'pack', approval_area: B2B_AREA,
        artefact: { pack_kind: 'outreach', groups: [{ name: c.name, lines }] },
        description: `The first e-mail to ${lines.length} new business${lines.length === 1 ? '' : 'es'} for ${c.name}. Ticked lines send today within the mailboxes' pace; follow-ups to businesses already e-mailed carry on as approved.`,
      })
      must(await db.from('b2b_messages').update({ pack_task_id: task.id }).in('id', saved.map(s => s.id)), 'pack link')
      made++
    } catch (e) {
      await db.from('b2b_messages').update({ status: 'stopped', error: `Daily batch could not be created: ${String(e.message).slice(0, 200)}` }).in('id', saved.map(s => s.id))
      throw e
    }
  }
  return made
}

// ─── go-live ────────────────────────────────────────────────────────────────

/** What PM adds to a go-live card HQ posts: the mailboxes to choose from and the day of each e-mail. */
export async function goliveExtras(db, campaign) {
  const boxes = must(await db.from('b2b_mailboxes').select(MAILBOX_PUBLIC).in('status', USABLE_MAILBOX).order('address'), 'mailboxes')
  const words = campaign.words_task_id ? must(await db.from('tasks').select('id, decision, artefact, line_decisions').eq('id', campaign.words_task_id).maybeSingle(), 'words') : null
  const emails = approvedEmails(words)
  return {
    mailboxes: boxes.map(m => ({ id: m.id, address: m.address, status: m.status, allowance: allowanceFor(m), daily_cap: m.daily_cap })),
    send_gaps: sendGaps(emails),
  }
}

/** On go-live approval: the chosen mailboxes (decision_edits.mailbox_ids) and the gaps go on the campaign. */
export async function applyGolive(db, campaignId, task) {
  const chosen = (task.decision_edits && Array.isArray(task.decision_edits.mailbox_ids) ? task.decision_edits.mailbox_ids : []).filter(isUuid)
  const known = chosen.length ? must(await db.from('b2b_mailboxes').select('id').in('id', chosen), 'mailboxes').map(m => m.id) : []
  const gaps = Array.isArray(task.artefact && task.artefact.send_gaps) ? task.artefact.send_gaps.filter(n => Number.isInteger(n) && n >= 0) : []
  const patch = { mailbox_ids: chosen.filter(id => known.includes(id)) }
  if (gaps.length) patch.send_gaps = gaps
  if (task.decision_edits && typeof task.decision_edits.pace === 'string') patch.pace = task.decision_edits.pace.slice(0, 200)
  must(await db.from('b2b_campaigns').update(patch).eq('id', campaignId), 'go-live settings')
  return patch
}

// ─── the inbox ──────────────────────────────────────────────────────────────

/**
 * Cron /api/cron/b2b-inbox (every 10 min): Inbox delta per mailbox; bounces, auto-replies and replies matched to
 * what PM sent; then mailbox / campaign health and the metrics roll-up.
 */
export async function runInbox(db, { now = new Date(), fetchImpl = fetch, maxPages = 5 } = {}) {
  const out = { mailboxes: [], replies: 0, bounces: 0, auto_replies: 0, paused: [], errors: [] }
  const cfg = mailConfig()
  if (!cfg.ready) return { ...out, enabled: false, reason: `missing ${cfg.missing.join(', ')}` }
  const boxes = must(await db.from('b2b_mailboxes').select('*').in('status', ['warming', 'active', 'paused']), 'mailboxes')
  const touched = new Set()
  for (const mb of boxes) {
    const info = { address: mb.address, seen: 0, matched: 0 }
    out.mailboxes.push(info)
    try {
      const client = mailboxClient(db, mb, { cfg, fetchImpl })
      let link = mb.delta_link || null
      for (let i = 0; i < maxPages; i++) {
        const page = await client.inboxDelta(link, link ? {} : { since: new Date(mb.created_at || now).toISOString() })
        for (const m of page.messages) {
          info.seen++
          const r = await processInbound(db, client, mb, m, now)
          if (r) { info.matched++; out[r.type === 'bounce' ? 'bounces' : r.type === 'auto_reply' ? 'auto_replies' : 'replies']++; touched.add(r.campaign_id) }
        }
        link = page.next || page.delta || link
        if (!page.next) break
      }
      await db.from('b2b_mailboxes').update({ delta_link: link, last_polled_at: now.toISOString() }).eq('id', mb.id)
    } catch (e) {
      if (e.reconnect) info.error = await markMailboxError(db, mb, e)
      else out.errors.push(`${mb.address}: ${String(e.message).slice(0, 200)}`)
    }
  }
  try { out.paused = await healthCheck(db, now) } catch (e) { out.errors.push(`health: ${e.message}`) }
  try {
    const live = must(await db.from('b2b_campaigns').select('id').in('stage', ['live', 'paused', 'done']).is('archived_at', null), 'campaigns').map(c => c.id)
    out.rolled_up = await rollupMetrics(db, live)
  } catch (e) { out.errors.push(`metrics: ${e.message}`) }
  return out
}

async function findSent(db, mb, m, detail, verdict) {
  if (m.conversationId) {
    const hit = must(await db.from('b2b_messages').select('*').eq('mailbox_id', mb.id).eq('conversation_id', m.conversationId).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(1), 'match')[0]
    if (hit) return hit
  }
  const refs = detail ? referencedIds(detail.internetMessageHeaders) : []
  if (refs.length) {
    const hit = must(await db.from('b2b_messages').select('*').in('internet_message_id', refs).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(1), 'match')[0]
    if (hit) return hit
  }
  if (verdict && verdict.type === 'bounce' && detail) {
    const text = `${(detail.body && detail.body.content) || ''}`
    const addrs = [...new Set((text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map(normEmail))].filter(a => a !== mb.address).slice(0, 10)
    if (addrs.length) {
      const cs = must(await db.from('b2b_contacts').select('id').in('email', addrs), 'contacts').map(c => c.id)
      if (cs.length) return must(await db.from('b2b_messages').select('*').eq('mailbox_id', mb.id).in('contact_id', cs).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(1), 'match')[0] || null
    }
  }
  return null
}

const NDR_HINT = /^(postmaster|mailer-daemon|microsoftexchange)/i
const NDR_SUBJ = /^(undeliverable|undelivered|delivery|mail delivery|returned mail|failure notice|non-?delivery)/i

/** One inbound message: returns { type, campaign_id } when it belonged to a PM e-mail, else null. */
export async function processInbound(db, client, mb, m, now = new Date()) {
  const from = normEmail(m.from && m.from.emailAddress && m.from.emailAddress.address)
  if (!from || from === mb.address) return null
  const looksNdr = NDR_HINT.test(from) || NDR_SUBJ.test(String(m.subject || ''))
  let sent = m.conversationId ? await findSent(db, mb, m, null, null) : null
  // Unrelated inbox mail is skipped without reading it; replies from clients that start a new conversation are still
  // found through In-Reply-To / References ("Re:" subjects only).
  if (!sent && !looksNdr && !/^\s*(re|aw|antw|sv|r|ref)\s*:/i.test(String(m.subject || ''))) return null
  if (m.internetMessageId) {
    const dup = must(await db.from('b2b_message_events').select('id').eq('detail->>inbound_id', m.internetMessageId).limit(1), 'dedupe')
    if (dup.length) return null
  }
  const detail = await client.inboundDetail(m.id)
  const text = (detail.uniqueBody && detail.uniqueBody.content) || (detail.body && detail.body.content) || ''
  const verdict = classifyInbound({ from, fromName: m.from && m.from.emailAddress && m.from.emailAddress.name, subject: detail.subject, headers: detail.internetMessageHeaders || [], text: verdictText(detail, text) })
  if (!sent) sent = await findSent(db, mb, m, detail, verdict)
  if (!sent) return null
  const base = { inbound_id: m.internetMessageId || m.id, graph_id: m.id, mailbox_id: mb.id }
  const contact = sent.contact_id ? must(await db.from('b2b_contacts').select(CONTACT_FIELDS).eq('id', sent.contact_id).maybeSingle(), 'contact') : null

  if (verdict.type === 'bounce') {
    let hard = verdict.hard
    if (!hard) {
      const prior = must(await db.from('b2b_messages').select('id').eq('prospect_id', sent.prospect_id).eq('campaign_id', sent.campaign_id), 'msgs').map(x => x.id)
      const soft = prior.length ? must(await db.from('b2b_message_events').select('id').in('message_id', prior).eq('kind', 'bounce_soft').limit(1), 'soft') : []
      if (soft.length) hard = true
    }
    await addEvent(db, sent.id, hard ? 'bounce_hard' : 'bounce_soft', { ...base, code: verdict.code }, now)
    if (hard) {
      await db.from('b2b_messages').update({ status: 'bounced' }).eq('id', sent.id)
      if (contact) {
        await db.from('b2b_contacts').update({ status: 'bounced', is_primary: false }).eq('id', contact.id)
        await suppress(db, { email: contact.email, domain: null, reason: 'bounce', messageId: sent.id })
      }
      await db.from('b2b_prospects').update({ status: 'bounced' }).eq('id', sent.prospect_id).in('status', ['approved', 'found', 'queued', 'contacted'])
      await stopProspect(db, sent.prospect_id, 'Bounced')
      await ensurePrimary(db, sent.prospect_id)
      await syncContactFlag(db, [sent.prospect_id])
    } else {
      // Soft: one retry of the same e-mail after 24 hours (a second soft bounce counts as hard).
      must(await db.from('b2b_messages').insert([{
        campaign_id: sent.campaign_id, prospect_id: sent.prospect_id, contact_id: sent.contact_id, mailbox_id: sent.mailbox_id, step: sent.step,
        subject: sent.subject, body_html: sent.body_html, links: sent.links, opens_tracked: sent.opens_tracked, status: 'queued',
        scheduled_for: new Date(now.getTime() + SOFT_BOUNCE_RETRY_HOURS * 3600_000).toISOString(),
      }]), 'retry')
    }
    return { type: 'bounce', campaign_id: sent.campaign_id }
  }
  if (verdict.type === 'auto_reply') {
    await addEvent(db, sent.id, 'auto_reply', base, now)
    return { type: 'auto_reply', campaign_id: sent.campaign_id }
  }
  // A reply: the sequence stops for this business; a person answers (opt-outs and "not interested" need nobody).
  const c = must(await db.from('b2b_campaigns').select('id, name, people, owner, created_by').eq('id', sent.campaign_id).maybeSingle(), 'campaign')
  const kind = verdict.kind
  const auto = ['negative', 'optout'].includes(kind)
  const want = kind === 'owner' ? ((c.people || {}).calls || (c.people || {}).replies) : (c.people || {}).replies
  const assignee = auto ? null : (want || c.owner || c.created_by || null)
  const reply = must(await db.from('b2b_replies').insert([{
    campaign_id: c.id, prospect_id: sent.prospect_id, kind, summary: redact(verdict.summary).slice(0, 2000), assigned_to: assignee,
    due_at: auto ? null : nextWorkingDay17(now).toISOString(), status: auto ? 'auto' : 'needs_person', message_id: sent.id,
  }]).select('id').single(), 'reply')
  await addEvent(db, sent.id, 'reply', { ...base, kind, reply_id: reply.id }, now)
  await db.from('b2b_messages').update({ status: 'replied' }).eq('id', sent.id)
  await stopProspect(db, sent.prospect_id, 'Replied')
  const status = kind === 'optout' ? 'opted_out' : kind === 'positive' ? 'warm' : 'replied'
  await db.from('b2b_prospects').update({ status }).eq('id', sent.prospect_id).in('status', ['approved', 'found', 'queued', 'contacted', 'replied'])
  if (kind === 'optout' && contact) {
    await suppress(db, { email: contact.email, reason: 'optout', messageId: sent.id })
    await db.from('b2b_contacts').update({ status: 'opted_out', is_primary: false }).eq('id', contact.id)
    await addEvent(db, sent.id, 'optout', { via: 'reply' }, now)
  }
  if (kind === 'negative' && contact) await suppress(db, { email: contact.email, reason: 'negative', messageId: sent.id })
  if (assignee) await notify(db, assignee, { type: 'b2b_reply', task: null, body: `A reply on ${c.name} needs you: ${redact(verdict.summary).slice(0, 200)}`, from: 'doddl PM outreach' })
  return { type: 'reply', kind, campaign_id: sent.campaign_id }
}

function verdictText(detail, text) {
  return `${text}\n${(detail.body && detail.body.content) || ''}`.slice(0, 20000)
}

/** Auto-pause: mailboxes with too many hard bounces, campaigns with too many opt-outs / "not interested". */
async function healthCheck(db, now) {
  const paused = []
  const today = londonMidnight(now).toISOString()
  const boxes = must(await db.from('b2b_mailboxes').select('id, address, connected_by').in('status', USABLE_MAILBOX), 'mailboxes')
  for (const mb of boxes) {
    const last = must(await db.from('b2b_messages').select('id').eq('mailbox_id', mb.id).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(100), 'last')
    const ids = last.map(x => x.id)
    const hardEv = ids.length ? must(await db.from('b2b_message_events').select('message_id, at').in('message_id', ids).eq('kind', 'bounce_hard'), 'bounces') : []
    const hard = new Set(hardEv.map(e => e.message_id))
    const reason = mailboxPauseReason({ last: last.map(x => ({ hard: hard.has(x.id) })), hardToday: hardEv.filter(e => e.at >= today).length })
    if (reason) {
      await db.from('b2b_mailboxes').update({ status: 'paused', status_reason: `Auto-paused: ${reason}` }).eq('id', mb.id)
      paused.push(`${mb.address}: ${reason}`)
      const owners = new Set(must(await db.from('b2b_campaigns').select('owner, created_by, mailbox_ids').eq('stage', 'live'), 'campaigns').filter(c => (c.mailbox_ids || []).includes(mb.id)).map(c => c.owner || c.created_by).filter(Boolean))
      for (const o of owners) await notify(db, o, { type: 'b2b_alert', task: null, body: `Outreach mailbox ${mb.address} was paused: ${reason}. Nothing is sent from it until a PM admin resumes it.`, from: 'doddl PM outreach' })
    }
  }
  const camps = must(await db.from('b2b_campaigns').select('id, name, stage, owner, created_by').eq('stage', 'live'), 'campaigns')
  for (const c of camps) {
    const last = must(await db.from('b2b_messages').select('id').eq('campaign_id', c.id).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(100), 'last')
    if (last.length < 20) continue
    const ids = last.map(x => x.id)
    const ev = must(await db.from('b2b_message_events').select('message_id, kind, detail').in('message_id', ids).in('kind', ['optout', 'reply']), 'events')
    const optouts = new Set(ev.filter(e => e.kind === 'optout').map(e => e.message_id)).size
    const negatives = new Set(ev.filter(e => e.kind === 'reply' && e.detail && e.detail.kind === 'negative').map(e => e.message_id)).size
    const reason = campaignPauseReason({ sends: last.length, optouts, negatives })
    if (reason) {
      await db.from('b2b_campaigns').update({ stage: 'paused', paused_from: 'live' }).eq('id', c.id).eq('stage', 'live')
      paused.push(`${c.name}: ${reason}`)
      const owner = c.owner || c.created_by
      if (owner) await notify(db, owner, { type: 'b2b_alert', task: null, body: `Sending for ${c.name} was paused: ${reason}. Check the words and the list, then resume the campaign.`, from: 'doddl PM outreach' })
    }
  }
  return paused
}

// ─── tracking ───────────────────────────────────────────────────────────────

async function messageByToken(db, token) {
  if (!validToken(token)) return null
  return must(await db.from('b2b_messages').select('id, campaign_id, prospect_id, contact_id, sent_at, links, opens_tracked').eq('track_token_hash', hashToken(token)).maybeSingle(), 'message')
}

async function recentEvent(db, messageId, kind, n, now) {
  let q = db.from('b2b_message_events').select('id').eq('message_id', messageId).eq('kind', kind).gte('at', new Date(now.getTime() - 3600_000).toISOString()).limit(1)
  if (n != null) q = q.eq('detail->>n', String(n))
  return must(await q, 'dedupe').length > 0
}

/** /api/t/c/:token/:n -> the URL stored on that message (null = 404). Scanners are recorded as such. */
export async function trackClick(db, { token, n, method = 'GET', userAgent = '', now = new Date() }) {
  const m = await messageByToken(db, token)
  if (!m) return null
  const url = linkTarget(m.links, n)
  if (!url) return null
  const kind = isScanner({ method, userAgent, sentAt: m.sent_at, now }) ? 'scanner' : 'click'
  if (!(await recentEvent(db, m.id, kind, Number(n), now))) await addEvent(db, m.id, kind, { n: Number(n), url }, now)
  return url
}

/** /api/t/o/:token.gif: records an open only when the campaign switched opens on (and not a scanner/proxy prefetch within 60 s). */
export async function trackOpen(db, { token, userAgent = '', now = new Date() }) {
  const m = await messageByToken(db, token)
  if (!m || !m.opens_tracked) return false
  if (m.sent_at && now.getTime() - new Date(m.sent_at).getTime() < 60_000) return false
  if (!(await recentEvent(db, m.id, 'open', null, now))) await addEvent(db, m.id, 'open', userAgent ? { ua: String(userAgent).slice(0, 120) } : {}, now)
  return true
}

/** What the opt-out page shows: { ok, business } (no e-mail address on the page). */
export async function optOutInfo(db, token) {
  const m = await messageByToken(db, token)
  if (!m) return { ok: false }
  const p = must(await db.from('b2b_prospects').select('name').eq('id', m.prospect_id).maybeSingle(), 'prospect')
  return { ok: true, business: p ? p.name : null }
}

/** POST /api/t/u/:token: suppress the address (and, by choice, the whole business) and stop every sequence. */
export async function optOut(db, token, { wholeBusiness = false, now = new Date() } = {}) {
  const m = await messageByToken(db, token)
  if (!m) return { ok: false }
  const contact = m.contact_id ? must(await db.from('b2b_contacts').select('id, email, prospect_id').eq('id', m.contact_id).maybeSingle(), 'contact') : null
  if (contact) {
    await suppress(db, { email: contact.email, reason: 'optout', messageId: m.id, by: 'opt-out link' })
    await db.from('b2b_contacts').update({ status: 'opted_out', is_primary: false }).eq('id', contact.id)
  }
  if (wholeBusiness) {
    const all = must(await db.from('b2b_contacts').select('id, email').eq('prospect_id', m.prospect_id), 'contacts')
    for (const c of all) await suppress(db, { email: c.email, reason: 'optout', messageId: m.id, by: 'opt-out link' })
    if (contact) await suppress(db, { domain: domainOf(contact.email), reason: 'optout', messageId: m.id, by: 'opt-out link' })
    await db.from('b2b_contacts').update({ status: 'opted_out', is_primary: false }).eq('prospect_id', m.prospect_id).neq('status', 'rejected')
  }
  await db.from('b2b_prospects').update({ status: 'opted_out' }).eq('id', m.prospect_id).neq('status', 'partner')
  await stopProspect(db, m.prospect_id, 'Opted out')
  if (!(await recentEvent(db, m.id, 'optout', null, now))) await addEvent(db, m.id, 'optout', { via: 'link', whole_business: !!wholeBusiness }, now)
  await syncContactFlag(db, [m.prospect_id])
  return { ok: true }
}

// ─── warm lead -> partner (Klaviyo) ─────────────────────────────────────────

/**
 * POST /api/b2b/replies/:id/partner { wants: trade_pack|prices|samples|call, first_name?, last_name? } (a person):
 * Klaviyo profile + "B2B partners" list, prospect -> partner, all sending to it stops.
 */
export async function makePartner(db, actor, replyId, input = {}, { fetchImpl = fetch, now = new Date() } = {}) {
  if (!isUuid(replyId)) throw b2bError(400, 'reply id must be a UUID')
  const wants = input.wants || 'trade_pack'
  if (!PARTNER_WANTS[wants]) throw b2bError(400, `wants must be one of ${Object.keys(PARTNER_WANTS).join(', ')}`)
  const cfg = klaviyoConfig()
  if (!cfg.ready) throw b2bError(503, `Klaviyo is not set up for B2B partners yet: ${cfg.missing.join(', ')} missing in the Vercel environment`)
  const r = must(await db.from('b2b_replies').select('id, campaign_id, prospect_id, message_id, kind, created_at').eq('id', replyId).maybeSingle(), 'reply')
  if (!r) throw b2bError(404, `No reply ${replyId}`)
  if (['optout', 'negative', 'bounce'].includes(r.kind)) throw b2bError(409, 'This reply opted out or said no; it cannot become a partner lead')
  const msg = r.message_id ? must(await db.from('b2b_messages').select('id, contact_id').eq('id', r.message_id).maybeSingle(), 'message') : null
  const contact = msg && msg.contact_id ? must(await db.from('b2b_contacts').select(CONTACT_FIELDS).eq('id', msg.contact_id).maybeSingle(), 'contact') : null
  if (!contact) throw b2bError(409, 'No e-mail address is linked to this reply')
  const p = must(await db.from('b2b_prospects').select('id, name, place, status').eq('id', r.prospect_id).maybeSingle(), 'prospect')
  const c = must(await db.from('b2b_campaigns').select('id, name, market, business_type_id').eq('id', r.campaign_id).maybeSingle(), 'campaign')
  const type = c.business_type_id ? must(await db.from('b2b_business_types').select('name').eq('id', c.business_type_id).maybeSingle(), 'type') : null
  const first = cleanName(input.first_name, 'first_name') || contact.first_name
  const last = cleanName(input.last_name, 'last_name') || contact.last_name
  const repliedOn = localParts(r.created_at || now).date
  const profileId = await upsertPartnerProfile(cfg, {
    email: contact.email, first_name: first, last_name: last, business: p.name, place: p.place, country: (c.market || {}).country || null,
    campaign: c.name, business_type: type ? type.name : null, wants, prospect_id: p.id, replied_on: repliedOn,
  }, { fetchImpl })
  await subscribeToPartnerList(cfg, { email: contact.email, consentedAt: new Date(r.created_at || now).toISOString() }, { fetchImpl })
  if ((first && first !== contact.first_name) || (last && last !== contact.last_name)) {
    await db.from('b2b_contacts').update({ first_name: first, last_name: last, type: first ? 'named' : contact.type }).eq('id', contact.id)
  }
  must(await db.from('b2b_prospects').update({ status: 'partner', klaviyo_profile_id: profileId }).eq('id', p.id), 'prospect')
  await suppress(db, { email: contact.email, reason: 'partner', messageId: r.message_id, by: actor })
  await suppress(db, { domain: domainOf(contact.email), reason: 'partner', messageId: r.message_id, by: actor })
  await stopProspect(db, p.id, 'Now a partner (Klaviyo)')
  return { prospect_id: p.id, status: 'partner', klaviyo_profile_id: profileId, wants }
}

/** POST /api/b2b/replies/:id/draft: a reply draft in the trade mailbox for the person to finish and send in Outlook. */
export async function draftInOutlook(db, actor, replyId, { fetchImpl = fetch } = {}) {
  if (!isUuid(replyId)) throw b2bError(400, 'reply id must be a UUID')
  const r = must(await db.from('b2b_replies').select('id, draft, message_id').eq('id', replyId).maybeSingle(), 'reply')
  if (!r || !r.message_id) throw b2bError(404, 'No e-mail is linked to this reply')
  const ev = must(await db.from('b2b_message_events').select('detail').eq('message_id', r.message_id).eq('kind', 'reply').eq('detail->>reply_id', r.id).limit(1), 'event')[0]
  if (!ev || !ev.detail || !ev.detail.graph_id) throw b2bError(404, 'The incoming e-mail could not be found')
  const mb = must(await db.from('b2b_mailboxes').select('*').eq('id', ev.detail.mailbox_id).maybeSingle(), 'mailbox')
  if (!mb || !mb.token_enc) throw b2bError(409, 'The trade mailbox is not connected')
  const client = mailboxClient(db, mb, { fetchImpl })
  const d = await client.createReplyForPerson(ev.detail.graph_id, { text: r.draft || '' })
  return { draft_id: d.id, web_link: d.webLink, mailbox: mb.address }
}

// ─── report and metrics ─────────────────────────────────────────────────────

/** GET /api/b2b/report?campaign_id=&mailbox_id=&by=day|week|all */
export async function outreachReport(db, { campaign_id = null, mailbox_id = null, by = 'all' } = {}) {
  if (campaign_id && !isUuid(campaign_id)) throw b2bError(400, 'campaign_id must be a UUID')
  if (mailbox_id && !isUuid(mailbox_id)) throw b2bError(400, 'mailbox_id must be a UUID')
  const grain = ['day', 'week', 'all'].includes(by) ? by : 'all'
  let cq = db.from('b2b_campaigns').select('id, name, stage, track_opens, mailbox_ids').is('archived_at', null).in('stage', ['live', 'paused', 'done', 'golive_review'])
  if (campaign_id) cq = db.from('b2b_campaigns').select('id, name, stage, track_opens, mailbox_ids').eq('id', campaign_id)
  const camps = must(await cq, 'campaigns')
  const ids = camps.map(c => c.id)
  const messages = ids.length ? await pageAll(() => {
    let q = db.from('b2b_messages').select('id, campaign_id, prospect_id, mailbox_id, step, sent_at, status, opens_tracked').in('campaign_id', ids).order('id')
    if (mailbox_id) q = q.eq('mailbox_id', mailbox_id)
    return q
  }) : []
  const sentIds = messages.filter(m => m.sent_at).map(m => m.id)
  const events = await inChunks(sentIds, (chunk) => db.from('b2b_message_events').select('message_id, kind, at').in('message_id', chunk).then(r => must(r, 'events')))
  const replies = ids.length ? (await pageAll(() => db.from('b2b_replies').select('kind, created_at, message_id, prospect_id, campaign_id').in('campaign_id', ids).order('id')))
    .filter(r => !mailbox_id || sentIds.includes(r.message_id)) : []
  const report = buildReport({ messages, events, replies, by: grain })
  const prospects = ids.length ? await pageAll(() => db.from('b2b_prospects').select('id, campaign_id, status, contact').in('campaign_id', ids).order('id')) : []
  const emailed = new Set(messages.filter(m => m.sent_at).map(m => m.prospect_id))
  const repliedP = new Set(replies.map(r => r.prospect_id))
  const fun = funnel({ prospects, emailedIds: emailed, repliedIds: repliedP })
  const started = new Set(messages.map(m => m.prospect_id))
  const mailable = prospects.filter(p => MAILABLE_PROSPECT.includes(p.status))
  const partnerCount = (await db.from('b2b_prospects').select('id', { count: 'exact', head: true }).not('klaviyo_profile_id', 'is', null)).count || 0
  const boxes = must(await db.from('b2b_mailboxes').select('id, address, status').order('address'), 'mailboxes')
  return {
    ...report,
    funnel: fun,
    still_to_send: mailable.filter(p => p.contact && p.contact.has_contact && !started.has(p.id)).length,
    contacts_missing: mailable.filter(p => !(p.contact && p.contact.has_contact)).length,
    klaviyo_partners: partnerCount,
    campaigns: camps.map(c => ({ id: c.id, name: c.name, stage: c.stage, track_opens: c.track_opens })),
    mailboxes: boxes,
  }
}

/** b2b_campaigns.metrics from PM's own records (merged; HQ's approved / meetings / orders stay). */
export async function rollupMetrics(db, campaignIds) {
  let n = 0
  for (const id of campaignIds) {
    const c = must(await db.from('b2b_campaigns').select('id, metrics, track_opens').eq('id', id).maybeSingle(), 'campaign')
    if (!c) continue
    const prospects = await pageAll(() => db.from('b2b_prospects').select('id, status, contact').eq('campaign_id', id).order('id'))
    const msgs = await pageAll(() => db.from('b2b_messages').select('id, prospect_id, sent_at, opens_tracked').eq('campaign_id', id).not('sent_at', 'is', null).order('id'))
    const events = await inChunks(msgs.map(m => m.id), (chunk) => db.from('b2b_message_events').select('message_id, kind').in('message_id', chunk).in('kind', ['bounce_hard', 'open', 'click', 'reply', 'optout']).then(r => must(r, 'events')))
    const pOf = Object.fromEntries(msgs.map(m => [m.id, m.prospect_id]))
    const set = (kind) => new Set(events.filter(e => e.kind === kind).map(e => pOf[e.message_id]))
    const emailed = new Set(msgs.map(m => m.prospect_id))
    const bounced = set('bounce_hard')
    const fun = funnel({ prospects, emailedIds: emailed, repliedIds: set('reply') })
    const opensMeasured = c.track_opens || msgs.some(m => m.opens_tracked)
    const metrics = {
      ...(c.metrics || {}),
      found: fun.found, contactable: fun.contactable, emailed: emailed.size, delivered: [...emailed].filter(p => !bounced.has(p)).length, bounced: bounced.size,
      opened: opensMeasured ? set('open').size : null, clicked: set('click').size, replied: fun.replied, optouts: set('optout').size, warm: fun.warm, partners: fun.partner,
    }
    must(await db.from('b2b_campaigns').update({ metrics }).eq('id', id), 'metrics')
    n++
  }
  return n
}
