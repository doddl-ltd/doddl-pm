// B2B contacts: PM's website extractor (docs/b2b-campaigns/OUTREACH-MAIL.md "Contacts"). Deterministic code, no model.
// For one business: fetch its own website's home page and /contact, /contact-us, /about (robots.txt honoured,
// 5 s timeout, at most 2 pages a second), keep e-mail addresses on the business's own domain; role addresses
// (info@, office@ …) are "generic" and usable, anything that looks personal is "suggested" for a person to accept.
import { promises as dnsPromises } from 'node:dns'
import { domainOf, normEmail, validEmail } from './rules'

export const PAGES = ['/', '/contact', '/contact-us', '/about']
export const ROLE_PREFIXES = ['info', 'office', 'hello', 'enquiries', 'enquiry', 'inquiries', 'admin', 'contact', 'manager', 'nursery', 'bookings',
  'booking', 'reception', 'mail', 'team', 'sales', 'shop', 'orders', 'accounts', 'help', 'support', 'general', 'post', 'school', 'head', 'headteacher',
  'principal', 'buying', 'buyer', 'purchasing', 'trade', 'wholesale', 'care', 'kitchen', 'cafe', 'events', 'hr', 'jobs', 'careers', 'marketing']
const NEVER = /^(noreply|no-reply|donotreply|do-not-reply|postmaster|mailer-daemon|abuse|webmaster|privacy|gdpr|dpo|unsubscribe|bounce|root)$/
const USER_AGENT = 'doddl-pm-contact-finder/1.0 (+https://doddl.com)'
const BOT_NAMES = ['doddl-pm-contact-finder', '*']

/** Is this local part a role (generic) address? info, office, hello, info.leeds, bookings2 … */
export function isRoleAddress(email) {
  const local = normEmail(email).split('@')[0] || ''
  const head = local.split(/[._+-]/)[0].replace(/\d+$/, '')
  return ROLE_PREFIXES.includes(head) || ROLE_PREFIXES.includes(local.replace(/\d+$/, ''))
}

/** The business's own domain also matches its subdomains (and the site's domain matches mail on the bare domain). */
export function ownDomain(email, siteDomain) {
  const d = domainOf(email)
  const s = String(siteDomain || '').replace(/^www\./, '')
  return !!d && !!s && (d === s || d.endsWith(`.${s}`) || s.endsWith(`.${d}`))
}

function decodeEntities(html) {
  return String(html || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&(commat|#64);/gi, '@').replace(/&period;/gi, '.').replace(/&amp;/gi, '&').replace(/&nbsp;/gi, ' ')
}

/** Every address in a page (mailto: links and plain text, entity-encoded and "[at]" forms too), lower-case, de-duplicated. */
export function emailsInHtml(html) {
  const s = decodeEntities(html)
    .replace(/\s*(?:\[|\()\s*at\s*(?:\]|\))\s*/gi, '@')
    .replace(/\s*(?:\[|\()\s*dot\s*(?:\]|\))\s*/gi, '.')
  const found = new Set()
  for (const m of s.matchAll(/mailto:([^"'?<>\s]+)/gi)) found.add(normEmail(decodeURIComponent(m[1])))
  for (const m of s.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) found.add(normEmail(m[0]))
  return [...found].filter(e => validEmail(e) && !/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(e) && !/@(example\.|sentry|wixpress|.*\.wix)/i.test(e))
}

/**
 * The contacts a set of pages yields for a business: [{ email, type: generic|named, status: ok|suggested, source }].
 * pages: [{ url, html }]. Only addresses on the site's own domain; system addresses (noreply, privacy …) left out.
 */
export function contactsFromPages(pages, siteDomain) {
  const out = new Map()
  for (const p of pages || []) {
    for (const email of emailsInHtml(p.html)) {
      if (!ownDomain(email, siteDomain) || out.has(email)) continue
      const local = email.split('@')[0]
      if (NEVER.test(local)) continue
      const generic = isRoleAddress(email)
      out.set(email, { email, type: generic ? 'generic' : 'named', status: generic ? 'ok' : 'suggested', source: `website:${p.url}` })
    }
  }
  return [...out.values()].sort((a, b) => (a.type === b.type ? 0 : a.type === 'generic' ? -1 : 1))
}

/** robots.txt -> may we fetch this path? Honours the groups for our agent name and "*" (Allow / Disallow, longest match wins). */
export function robotsAllows(robotsTxt, path) {
  if (!robotsTxt) return true
  const groups = []
  let cur = null
  for (const raw of String(robotsTxt).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    const m = /^(user-agent|allow|disallow)\s*:\s*(.*)$/i.exec(line)
    if (!m) continue
    const k = m[1].toLowerCase(), v = m[2].trim()
    if (k === 'user-agent') {
      if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur) }
      cur.agents.push(v.toLowerCase())
    } else if (cur) cur.rules.push({ allow: k === 'allow', path: v })
  }
  const pick = groups.find(g => g.agents.some(a => a !== '*' && BOT_NAMES[0].startsWith(a))) || groups.find(g => g.agents.includes('*'))
  if (!pick) return true
  let best = null
  for (const r of pick.rules) {
    if (!r.path) continue
    const re = new RegExp(`^${r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`)
    if (re.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r
  }
  return !best || best.allow
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function getText(url, fetchImpl, timeoutMs) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html,text/plain' }, redirect: 'follow', signal: ac.signal })
    if (!r.ok) return null
    const type = r.headers && r.headers.get ? String(r.headers.get('content-type') || '') : ''
    if (type && !/text|html|xml/i.test(type)) return null
    return (await r.text()).slice(0, 2_000_000)
  } catch { return null } finally { clearTimeout(t) }
}

/**
 * Fetches a business's site and returns { domain, pages_read, contacts, blocked? }. website: the prospect's
 * details.website. fetchImpl / pauseMs / timeoutMs are injectable for tests.
 */
export async function extractFromWebsite(website, { fetchImpl = fetch, timeoutMs = 5000, pauseMs = 500 } = {}) {
  const domain = domainOf(website)
  if (!domain) return { domain: null, pages_read: 0, contacts: [], note: 'no website' }
  let origin
  try { origin = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).origin } catch { return { domain, pages_read: 0, contacts: [], note: 'bad website address' } }
  const robots = await getText(`${origin}/robots.txt`, fetchImpl, timeoutMs)
  const pages = []
  let blocked = 0
  for (const path of PAGES) {
    if (!robotsAllows(robots, path)) { blocked++; continue }
    if (pages.length || blocked) await sleep(pauseMs)
    const html = await getText(`${origin}${path}`, fetchImpl, timeoutMs)
    if (html) pages.push({ url: `${origin}${path}`, html })
  }
  return { domain, pages_read: pages.length, contacts: contactsFromPages(pages, domain), blocked }
}

/** Does the domain receive mail (an MX record)? Cached per process for an hour. resolver injectable for tests. */
const mxCache = new Map()
export async function hasMx(domain, { resolveMx = (d) => dnsPromises.resolveMx(d), now = Date.now() } = {}) {
  const d = String(domain || '').toLowerCase()
  if (!d) return false
  const hit = mxCache.get(d)
  if (hit && hit.at > now - 3600_000) return hit.ok
  let ok
  try { ok = (await resolveMx(d)).some(r => r && r.exchange) } catch (e) { ok = e && ['ENODATA', 'ENOTFOUND', 'NXDOMAIN'].includes(e.code) ? false : null }
  if (ok !== null) mxCache.set(d, { ok, at: now })
  return ok
}
