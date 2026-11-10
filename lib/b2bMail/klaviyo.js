// Warm lead -> partner: hand a B2B partner to Klaviyo (docs/b2b-campaigns/OUTREACH-MAIL.md "Warm lead → partner").
// Klaviyo is NEVER used for cold e-mail: a business arrives here only after it replied asking for more, and that
// consent is recorded on the profile (doddl_b2b_consent) and on the list subscription (consented_at).
//
// Same REST style as Documents/doddl-crm/kv.py: https://a.klaviyo.com/api, header "Authorization: Klaviyo-API-Key …",
// revision 2025-10-15, JSON:API bodies. Env: KLAVIYO_API_KEY, B2B_KLAVIYO_LIST_ID (the "B2B partners" list, made
// once by scripts/b2b-klaviyo-setup.mjs).
import { mailError } from './crypto'

export const KLAVIYO_BASE = 'https://a.klaviyo.com/api'
export const KLAVIYO_REVISION = '2025-10-15'
export const PARTNER_WANTS = { trade_pack: 'the trade pack', prices: 'prices', samples: 'samples', call: 'a call' }
export const PARTNER_STATUS = { trade_pack: 'trade_pack_requested', prices: 'prices_requested', samples: 'samples_requested', call: 'call_requested' }

export function klaviyoConfig(env = process.env) {
  const missing = []
  if (!env.KLAVIYO_API_KEY) missing.push('KLAVIYO_API_KEY')
  if (!env.B2B_KLAVIYO_LIST_ID) missing.push('B2B_KLAVIYO_LIST_ID')
  return { key: env.KLAVIYO_API_KEY || '', listId: env.B2B_KLAVIYO_LIST_ID || '', missing, ready: !missing.length }
}

export function klaviyoHeaders(key, revision = KLAVIYO_REVISION) {
  return { authorization: `Klaviyo-API-Key ${key}`, revision, accept: 'application/vnd.api+json', 'content-type': 'application/vnd.api+json' }
}

export async function klaviyoCall(cfg, method, path, body, { fetchImpl = fetch, ok = [200, 201, 202, 204] } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetchImpl(`${KLAVIYO_BASE}${path}`, { method, headers: klaviyoHeaders(cfg.key), body: body ? JSON.stringify(body) : undefined })
    if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, Math.min(8000, 500 * 2 ** attempt))); continue }
    const text = await r.text()
    if (!ok.includes(r.status)) throw mailError(502, `Klaviyo ${method} ${path} -> ${r.status}: ${text.slice(0, 300)}`)
    return text ? JSON.parse(text) : {}
  }
  throw mailError(502, `Klaviyo ${method} ${path}: gave up after retries`)
}

/**
 * The profile attributes for a partner. p: { email, first_name, last_name, business, place, country, campaign,
 * business_type, wants, prospect_id, replied_on (YYYY-MM-DD) }.
 */
export function partnerProfile(p) {
  const wants = PARTNER_WANTS[p.wants] ? p.wants : 'trade_pack'
  const attrs = {
    email: String(p.email).toLowerCase(),
    organization: p.business || undefined,
    first_name: p.first_name || undefined,
    last_name: p.last_name || undefined,
    location: (p.place || p.country) ? { city: p.place || undefined, country: p.country || undefined } : undefined,
    properties: {
      doddl_record_type: 'b2b_partner',
      doddl_b2b_campaign: p.campaign || null,
      doddl_b2b_business_type: p.business_type || null,
      doddl_b2b_partner_status: PARTNER_STATUS[wants],
      doddl_b2b_consent: `replied to doddl trade e-mail on ${p.replied_on} asking for ${PARTNER_WANTS[wants]}`,
      doddl_pm_prospect_id: p.prospect_id,
    },
  }
  for (const k of Object.keys(attrs)) if (attrs[k] === undefined) delete attrs[k]
  return attrs
}

/** Create or update (by e-mail) and return the profile id. */
export async function upsertPartnerProfile(cfg, p, opts = {}) {
  const j = await klaviyoCall(cfg, 'POST', '/profile-import', { data: { type: 'profile', attributes: partnerProfile(p) } }, opts)
  const id = j && j.data && j.data.id
  if (!id) throw mailError(502, 'Klaviyo did not return a profile id')
  return id
}

/** Subscribe to the "B2B partners" list with e-mail marketing consent and the date they asked (historical import keeps consented_at). */
export async function subscribeToPartnerList(cfg, { email, consentedAt }, opts = {}) {
  return klaviyoCall(cfg, 'POST', '/profile-subscription-bulk-create-jobs', {
    data: {
      type: 'profile-subscription-bulk-create-job',
      attributes: {
        custom_source: 'doddl PM B2B partner',
        historical_import: true,
        profiles: { data: [{ type: 'profile', attributes: { email: String(email).toLowerCase(), subscriptions: { email: { marketing: { consent: 'SUBSCRIBED', consented_at: consentedAt } } } } }] },
      },
      relationships: { list: { data: { type: 'list', id: cfg.listId } } },
    },
  }, opts)
}
