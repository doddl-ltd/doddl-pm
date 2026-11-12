// What is live on Amazon, against what we sent (Jon 2026-11-12: "send them & then tell what is live & what is a
// problem ... once pushed, if Amazon live does not match we need to build a case for Amazon to step in").
//
// Every edit HQ has patched on Amazon (status 'sent') is the baseline for its field. Each read from Amazon after the
// send is compared with it:
//   live      Amazon shows what we sent
//   waiting   sent, but Amazon has not been read since, or it is still inside Amazon's processing window
//   problem   Amazon still shows something else after the window, or Amazon reported an error on the field
// Pure: used by the listing screen (client) and by the case builder (server).

export const WAIT_HOURS = 72
const H = 3600 * 1000

const norm1 = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
const norm = (v) => String(v ?? '').split(' | ').map(norm1).sort().join(' | ')
const same = (a, b) => norm(a) === norm(b)
const empty = (v) => v == null || (Array.isArray(v) ? !v.length : String(v).trim() === '')

export const IMAGE_ATTR = /^(main|other)_product_image_locator(_(\d))?$/
export function imageSlot(name) {
  const m = IMAGE_ATTR.exec(String(name || ''))
  if (!m) return null
  return m[1] === 'main' ? 0 : Number(m[3] || 0)
}
export function imageLabel(name) { const i = imageSlot(name); return i === 0 ? 'Main image' : `Image ${i}` }

// The Amazon attribute behind each copy field (Amazon names it in its issue messages).
const COPY_ATTR = { Title: 'item_name', Description: 'product_description', 'Search terms': 'generic_keyword' }
export function attrOf(edit) {
  if (edit.kind === 'attribute') return edit.name
  if (/^Bullet \d$/.test(edit.name)) return 'bullet_point'
  return COPY_ATTR[edit.name] || edit.name
}
export function labelOf(edit) {
  if (edit.kind === 'field') return edit.name
  if (imageSlot(edit.name) != null) return imageLabel(edit.name)
  return edit.name
}

function attrValues(product, name) {
  const r = {}
  for (const a of (product && product.attributes) || []) if (a.name === name) r[a.source === 'page' ? 'page' : 'ours'] = a.value
  return r
}
const pageImages = (fields) => {
  const f = (fields || []).find(x => x.field === 'Images')
  return (f && Array.isArray(f.live) ? f.live : []).filter(x => x && x.slot !== 'SWCH')
}

/** What Amazon shows now for this edit's field: { page, ours } (page = the detail page, ours = our listing's value). */
export function liveOf(edit, product, fields) {
  if (edit.kind === 'field') { const f = (fields || []).find(x => x.field === edit.name); return { page: f ? f.live : null, ours: null } }
  const i = imageSlot(edit.name)
  if (i != null) {
    const p = pageImages(fields)[i]
    const o = attrValues(product, edit.name).ours
    return { page: p ? p.url : null, ours: o == null ? null : String(o).replace(/^media_location:\s*/, '') }
  }
  const v = attrValues(product, edit.name)
  return { page: v.page ?? null, ours: v.ours ?? null }
}

/** Amazon's error messages about this field, read after the send (from the listing's history lines). */
export function issuesFor(edit, events, since) {
  const attr = attrOf(edit)
  return (events || []).filter(e => e && typeof e.text === 'string' && /^Amazon error/i.test(e.text) && (!since || !e.at || e.at >= since) && e.text.includes(attr)).map(e => e.text)
}

/** The live check for one edit. Returns null for an edit that has not been sent. */
export function liveCheck(edit, { product, fields, events, now = new Date() } = {}) {
  if (!edit || edit.status !== 'sent') return null
  const sentAt = edit.sent_at || edit.hq_at || null
  const read = product && product.checked_at ? product.checked_at : null
  const live = liveOf(edit, product, fields)
  const base = { id: edit.id, label: labelOf(edit), sent: edit.value, before: edit.live ?? null, page: live.page, ours: live.ours, sent_at: sentAt, read_at: read }
  if (!sentAt) return { ...base, state: 'waiting', why: 'Sent, but HQ did not record when' }
  if (!read || read < sentAt) return { ...base, state: 'waiting', why: 'Sent. Waiting for the next read from Amazon' }

  const image = imageSlot(edit.name) != null
  const removal = empty(edit.value)
  let match, accepted = false
  if (removal) match = empty(live.page) && empty(live.ours)
  else if (image) {
    accepted = !empty(live.ours) && live.ours === edit.value
    // Amazon re-hosts images, so the page link differs from the link we sent: live when the page slot changed from
    // what was there before the send while our listing holds our image, or when the page shows the link itself.
    match = live.page === edit.value || (accepted && !empty(live.page) && live.page !== edit.live)
  } else match = same(live.page ?? live.ours, edit.value) || (live.page == null && same(live.ours, edit.value))

  if (match) return { ...base, state: 'live', why: 'Amazon shows what we sent' }
  const hours = Math.max(0, (new Date(now).getTime() - new Date(sentAt).getTime()) / H)
  const issues = issuesFor(edit, events, sentAt)
  if (issues.length) return { ...base, state: 'problem', why: issues[0].slice(0, 300), issues }
  const days = Math.floor(hours / 24)
  if (hours < WAIT_HOURS) {
    return { ...base, state: 'waiting', why: image && accepted ? 'Amazon accepted the image. The page has not changed yet' : `Amazon can take up to ${WAIT_HOURS / 24} days to show a change` }
  }
  const ago = days >= 1 ? `${days} day${days === 1 ? '' : 's'}` : `${Math.round(hours)} hours`
  if (image && accepted) return { ...base, state: 'problem', why: `Amazon accepted our image ${ago} ago but the page still shows the old one` }
  if (removal) return { ...base, state: 'problem', why: `Removal sent ${ago} ago; Amazon still shows a value` }
  return { ...base, state: 'problem', why: `Sent ${ago} ago; Amazon still shows something else` }
}

/** Every sent edit on one listing, checked. */
export function liveChecks({ edits, product, fields, events, now }) {
  return (edits || []).filter(e => e.status === 'sent').map(e => liveCheck(e, { product, fields, events, now })).filter(Boolean)
}

// ─── The case for Amazon ─────────────────────────────────────────────────────

const SC = { UK: 'amazon.co.uk', IE: 'amazon.co.uk', DE: 'amazon.de', FR: 'amazon.fr', ES: 'amazon.es', IT: 'amazon.it', NL: 'amazon.nl', BE: 'amazon.com.be', PL: 'amazon.pl', SE: 'amazon.se', US: 'amazon.com', CA: 'amazon.ca' }
const STORE = { UK: 'Amazon.co.uk', IE: 'Amazon.ie', DE: 'Amazon.de', FR: 'Amazon.fr', ES: 'Amazon.es', IT: 'Amazon.it', NL: 'Amazon.nl', BE: 'Amazon.com.be', PL: 'Amazon.pl', SE: 'Amazon.se', US: 'Amazon.com', CA: 'Amazon.ca' }
export const contactUrl = (m) => `https://sellercentral.${SC[m] || 'amazon.co.uk'}/cu/contact-us`
export const storeName = (m) => STORE[m] || `Amazon ${m}`

const when = (t) => t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'unknown'
const shown = (v) => empty(v) ? '(nothing)' : String(v).length > 600 ? String(v).slice(0, 600) + '…' : String(v)

/** The case text for Seller Support from a listing's problem checks. Pure. */
export function caseText({ product, marketplace, problems }) {
  const asin = product.asin, sku = product.sku || 'unknown'
  const title = product.product || asin
  const subject = `Detail page not showing accepted listing updates: ASIN ${asin}, SKU ${sku.split(',')[0].trim()} (${storeName(marketplace)})`
  const lines = [
    'Hello Seller Support,',
    '',
    `We are doddl, the brand owner and seller of this product. We updated the listing below through the Selling Partner API (Listings Items API). The submission was accepted, but the detail page on ${storeName(marketplace)} does not show the change.`,
    '',
    `Product: ${title}`,
    `ASIN: ${asin}`,
    `SKU: ${sku}`,
    `Marketplace: ${storeName(marketplace)}`,
    '',
    'What we sent and what the page shows:',
  ]
  problems.forEach((p, i) => {
    lines.push('', `${i + 1}. ${p.label}`)
    lines.push(`   We sent (${when(p.sent_at)}): ${empty(p.sent) ? 'remove this value' : shown(p.sent)}`)
    lines.push(`   The page shows (read ${when(p.read_at)}): ${shown(p.page ?? p.ours)}`)
    if (p.before != null && !empty(p.before)) lines.push(`   Before our update: ${shown(p.before)}`)
    if (p.issues && p.issues.length) lines.push(`   Amazon's message: ${p.issues[0].replace(/^Amazon error\s*/i, '').slice(0, 400)}`)
  })
  lines.push('', 'Please update the detail page to show the values we submitted, or tell us what is stopping them from showing (for example another contributor\'s data taking priority) so we can fix it.', '', 'Thank you,', 'doddl')
  return { subject, body: lines.join('\n') }
}
