// doddl HQ data in the PM tool (docs/approvals-v2/CONTRACT.md): the creative studio and content calendar
// (content_items), "Give HQ an idea" (ideas) and Amazon listings (listing_products / _fields / _events).
// Agents write through /api/agent/* and MCP; people read through /api/studio, /api/calendar, /api/listings
// and write ideas through /api/ideas. Validation is pure and unit-tested (test/hq.test.mjs).

import { approvalError as fail, londonParts, dueAt } from './approvals'

export const CONTENT_TYPES = ['ad', 'video', 'social', 'email', 'listing', 'amazon_ads', 'website', 'outreach', 'recipe']
export const STAGES = ['brief', 'make', 'check', 'ready', 'scheduled', 'live', 'done', 'dropped']
export const TONES = ['ok', 'warn', 'bad', 'info', 'muted']
export const IDEA_STATUSES = ['new', 'picked_up', 'briefed', 'declined']
export const FIELD_STATUSES = ['match', 'drift', 'proposed', 'in_flight', 'problem', 'na']
export const EVENT_KINDS = ['amazon_change', 'our_change', 'check', 'suppressed']
export const LISTING_FIELDS = ['Title', 'Bullet 1', 'Bullet 2', 'Bullet 3', 'Bullet 4', 'Bullet 5', 'Description', 'Search terms',
  'Images', 'A+ content', 'Price', 'Variations', 'Category', 'Age range', 'Safety documents', 'Buy Box']
/** Where each content type is approved (the studio's last table). */
export const TYPE_AREA = {
  ad: 'paid_media', video: 'paid_media', social: 'organic_social', email: 'email', listing: 'amazon_listings',
  amazon_ads: 'amazon_ads', website: 'website', outreach: 'outreach', recipe: 'app_recipes',
}
const MAX_BATCH = 500

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v)
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const isTime = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v))
const HOUR = 3600_000

function must(result, what) {
  if (result.error) throw fail(result.error.code === '23503' || result.error.code === '23514' ? 400 : 500, `${what}: ${result.error.message}`)
  return result.data
}

function strList(v, what) {
  if (v == null) return undefined
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) throw fail(400, `${what} must be an array of strings`)
  return v.map(x => x.trim()).filter(Boolean).slice(0, 50)
}

function text(v, what, max = 2000) {
  if (v == null) return v
  if (typeof v !== 'string') throw fail(400, `${what} must be a string`)
  return v.slice(0, max)
}

/** Groups rows by their key set, so a partial upsert never nulls the columns a row left out. */
export function groupByKeys(rows) {
  const groups = new Map()
  for (const r of rows) {
    const k = Object.keys(r).sort().join(',')
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(r)
  }
  return [...groups.values()]
}

async function upsertGrouped(db, table, rows, onConflict, select) {
  const out = []
  for (const group of groupByKeys(rows)) {
    const r = await db.from(table).upsert(group, { onConflict }).select(select)
    out.push(...must(r, table))
  }
  return out
}

// ─── content items ──────────────────────────────────────────────────────────

/** One content item from an agent: validated, only the supplied columns. */
export function cleanContentItem(raw, i = 0) {
  const at = `items[${i}]`
  if (!isObj(raw)) throw fail(400, `${at} must be an object`)
  const ref = typeof raw.external_ref === 'string' ? raw.external_ref.trim() : ''
  if (!ref) throw fail(400, `${at}.external_ref is required`)
  const out = { external_ref: ref.slice(0, 300) }
  if (raw.type !== undefined) { if (!CONTENT_TYPES.includes(raw.type)) throw fail(400, `${at}.type must be one of ${CONTENT_TYPES.join(', ')}`); out.type = raw.type }
  if (raw.title !== undefined) { const t = String(raw.title || '').trim(); if (!t) throw fail(400, `${at}.title must not be empty`); out.title = t.slice(0, 300) }
  if (raw.stage !== undefined) { if (!STAGES.includes(raw.stage)) throw fail(400, `${at}.stage must be one of ${STAGES.join(', ')}`); out.stage = raw.stage }
  if (raw.status_tone !== undefined) { if (raw.status_tone !== null && !TONES.includes(raw.status_tone)) throw fail(400, `${at}.status_tone must be one of ${TONES.join(', ')}`); out.status_tone = raw.status_tone }
  if (raw.markets !== undefined) out.markets = strList(raw.markets, `${at}.markets`) || []
  for (const k of ['channel', 'owner', 'approver', 'status_text', 'format', 'thumb_url']) if (raw[k] !== undefined) out[k] = text(raw[k], `${at}.${k}`)
  if (raw.approval_task_id !== undefined) { if (raw.approval_task_id !== null && !isUuid(raw.approval_task_id)) throw fail(400, `${at}.approval_task_id must be a task UUID`); out.approval_task_id = raw.approval_task_id }
  for (const k of ['stage_since', 'scheduled_at', 'live_at']) {
    if (raw[k] !== undefined) { if (raw[k] !== null && !isTime(raw[k])) throw fail(400, `${at}.${k} must be an ISO date-time`); out[k] = raw[k] }
  }
  if (raw.stage_sla_hours !== undefined) {
    const n = raw.stage_sla_hours === null ? null : Number(raw.stage_sla_hours)
    if (n !== null && (!Number.isFinite(n) || n <= 0)) throw fail(400, `${at}.stage_sla_hours must be a positive number`)
    out.stage_sla_hours = n
  }
  for (const k of ['results', 'brief']) {
    if (raw[k] !== undefined) { if (raw[k] !== null && !isObj(raw[k])) throw fail(400, `${at}.${k} must be an object`); out[k] = raw[k] }
  }
  return out
}

/** PUT /api/agent/content-items: bulk upsert on external_ref. Moving stage resets stage_since (DB trigger). */
export async function upsertContentItems(db, body) {
  const list = Array.isArray(body) ? body : body && body.items
  if (!Array.isArray(list) || !list.length) throw fail(400, 'Send { items: [...] } with at least one item')
  if (list.length > MAX_BATCH) throw fail(400, `At most ${MAX_BATCH} items per call`)
  const rows = list.map(cleanContentItem)
  const refs = [...new Set(rows.map(r => r.external_ref))]
  if (refs.length !== rows.length) throw fail(400, 'Each external_ref may appear only once per call')
  const existing = new Set()
  for (let i = 0; i < refs.length; i += 200) {
    for (const r of must(await db.from('content_items').select('external_ref').in('external_ref', refs.slice(i, i + 200)), 'content lookup')) existing.add(r.external_ref)
  }
  for (const r of rows) {
    if (!existing.has(r.external_ref) && (!r.type || !r.title)) throw fail(400, `New item ${r.external_ref} needs type and title`)
  }
  // New rows are inserted; existing rows are updated with only the columns sent (an upsert would still
  // check NOT NULL columns the caller left out).
  const fresh = rows.filter(r => !existing.has(r.external_ref))
  const SELECT = 'id, external_ref, type, stage, stage_since, updated_at'
  const saved = fresh.length ? await upsertGrouped(db, 'content_items', fresh, 'external_ref', SELECT) : []
  for (const r of rows.filter(x => existing.has(x.external_ref))) {
    const { external_ref, ...patch } = r
    if (!Object.keys(patch).length) {
      saved.push(must(await db.from('content_items').select(SELECT).eq('external_ref', external_ref).single(), 'content item'))
      continue
    }
    saved.push(must(await db.from('content_items').update(patch).eq('external_ref', external_ref).select(SELECT).single(), 'content item'))
  }
  return { upserted: saved.length, created: fresh.length, items: saved }
}

export function isStuck(item, now = new Date()) {
  if (!item.stage_sla_hours || ['done', 'dropped', 'live'].includes(item.stage)) return false
  return new Date(now).getTime() - new Date(item.stage_since).getTime() > Number(item.stage_sla_hours) * HOUR
}

async function approvalsFor(db, ids) {
  const out = {}
  const list = [...new Set(ids.filter(Boolean))]
  for (let i = 0; i < list.length; i += 200) {
    const rows = must(await db.from('tasks').select('id, created_at, expires_at, decision, decision_by, assigned_to, approvers, escalated_to, approval_area').in('id', list.slice(i, i + 200)), 'approvals')
    for (const t of rows) out[t.id] = { ...t, due_at: t.decision ? null : dueAt(t).toISOString() }
  }
  return out
}

/** GET /api/studio: the pipeline board (brief → make → check → ready → scheduled → live), stuck list, where each type is approved. */
export async function studio(db, { type, include_done = false, now = new Date() } = {}) {
  let q = db.from('content_items').select('*').order('stage_since', { ascending: true }).limit(1000)
  if (!include_done) q = q.not('stage', 'in', '(done,dropped)')
  if (type) { if (!CONTENT_TYPES.includes(type)) throw fail(400, `type must be one of ${CONTENT_TYPES.join(', ')}`); q = q.eq('type', type) }
  const items = must(await q, 'content items')
  const approvals = await approvalsFor(db, items.map(i => i.approval_task_id))
  const rows = items.map(i => ({
    ...i,
    hours_in_stage: Math.round((new Date(now).getTime() - new Date(i.stage_since).getTime()) / HOUR),
    stuck: isStuck(i, now),
    approval: i.approval_task_id ? approvals[i.approval_task_id] || null : null,
  }))
  const counts = Object.fromEntries(CONTENT_TYPES.map(t => [t, rows.filter(r => r.type === t).length]))
  const rules = must(await db.from('approval_rules').select('area, label, approver, backup, second_approver, batch_mode, batch_day, reply_by').order('position'), 'approval rules')
  const byArea = Object.fromEntries(rules.map(r => [r.area, r]))
  return {
    stages: STAGES.filter(s => include_done || !['done', 'dropped'].includes(s)),
    items: rows,
    counts: { all: rows.length, ...counts },
    stuck: rows.filter(r => r.stuck),
    approved_where: CONTENT_TYPES.map(t => ({ type: t, area: TYPE_AREA[t], ...(byArea[TYPE_AREA[t]] ? { label: byArea[TYPE_AREA[t]].label, approver: byArea[TYPE_AREA[t]].approver, backup: byArea[TYPE_AREA[t]].backup, second_approver: byArea[TYPE_AREA[t]].second_approver, batch_mode: byArea[TYPE_AREA[t]].batch_mode, batch_day: byArea[TYPE_AREA[t]].batch_day, reply_by: byArea[TYPE_AREA[t]].reply_by } : {}) })),
  }
}

/** Monday..Sunday (UK) around `now`, as YYYY-MM-DD. */
export function weekRange(now = new Date()) {
  const today = londonParts(now).date
  const d = new Date(`${today}T12:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dow)
  const from = d.toISOString().slice(0, 10)
  d.setUTCDate(d.getUTCDate() + 6)
  return { from, to: d.toISOString().slice(0, 10) }
}

/** Calendar state of one item: live, scheduled (approved), waiting (approval pending) or planned. */
export function calendarState(item, approval) {
  if (item.stage === 'live' || item.stage === 'done') return 'live'
  if (approval && !approval.decision) return 'waiting'
  if (item.stage === 'scheduled') return 'scheduled'
  return 'planned'
}

/** GET /api/calendar?from&to (YYYY-MM-DD, inclusive; default this UK week). */
export async function calendar(db, { from, to, now = new Date() } = {}) {
  const wk = weekRange(now)
  const f = from || wk.from
  const t = to || (from ? f : wk.to)
  for (const [k, v] of [['from', f], ['to', t]]) if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw fail(400, `${k} must be YYYY-MM-DD`)
  if (t < f) throw fail(400, 'to must not be before from')
  const end = new Date(`${t}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 2) // widen for UK offset; trimmed below
  const start = new Date(`${f}T00:00:00Z`); start.setUTCDate(start.getUTCDate() - 1)
  const a = start.toISOString(), b = end.toISOString()
  const items = must(await db.from('content_items').select('*')
    .or(`and(scheduled_at.gte.${a},scheduled_at.lt.${b}),and(live_at.gte.${a},live_at.lt.${b})`)
    .neq('stage', 'dropped').limit(2000), 'calendar')
  const approvals = await approvalsFor(db, items.map(i => i.approval_task_id))
  const rows = []
  for (const i of items) {
    const at = i.scheduled_at || i.live_at
    const day = londonParts(at).date
    if (day < f || day > t) continue
    const approval = i.approval_task_id ? approvals[i.approval_task_id] || null : null
    const p = londonParts(at)
    rows.push({ ...i, at, day, time: `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`, state: calendarState(i, approval), approval })
  }
  rows.sort((x, y) => new Date(x.at) - new Date(y.at))
  return { from: f, to: t, channels: [...new Set(rows.map(r => r.channel).filter(Boolean))], items: rows }
}

// ─── ideas ──────────────────────────────────────────────────────────────────

/** "Give HQ an idea": six questions, only the first (text) required. */
export function cleanIdea(raw) {
  if (!isObj(raw)) throw fail(400, 'Send the idea as an object')
  const t = String(raw.text || '').trim()
  if (!t) throw fail(400, 'text is required: what is the idea?')
  const out = { text: t.slice(0, 5000) }
  for (const k of ['persona', 'timing', 'offer', 'must_include', 'must_avoid', 'measure']) if (raw[k] != null && raw[k] !== '') out[k] = text(raw[k], k)
  for (const k of ['age_stages', 'channels', 'markets']) if (raw[k] != null) out[k] = strList(raw[k], k)
  return out
}

export async function createIdea(db, author, raw) {
  return must(await db.from('ideas').insert([{ ...cleanIdea(raw), created_by: author }]).select('*').single(), 'idea')
}

export async function listIdeas(db, { status, created_by, limit = 100 } = {}) {
  let q = db.from('ideas').select('*').order('created_at', { ascending: false }).limit(Math.min(500, Number(limit) || 100))
  const statuses = [].concat(status || []).flatMap(s => String(s).split(',')).filter(Boolean)
  if (statuses.length) {
    const bad = statuses.filter(s => !IDEA_STATUSES.includes(s))
    if (bad.length) throw fail(400, `status must be one of ${IDEA_STATUSES.join(', ')}`)
    q = q.in('status', statuses)
  }
  if (created_by) q = q.ilike('created_by', created_by)
  return { ideas: must(await q, 'ideas') }
}

/** PATCH /api/agent/ideas/:id — HQ picks an idea up, briefs it or declines it, and replies. */
export async function replyIdea(db, principal, id, raw = {}, { notify } = {}) {
  if (!isUuid(id)) throw fail(400, 'id must be an idea UUID')
  const patch = {}
  if (raw.status !== undefined) { if (!IDEA_STATUSES.includes(raw.status)) throw fail(400, `status must be one of ${IDEA_STATUSES.join(', ')}`); patch.status = raw.status }
  if (raw.hq_reply !== undefined) patch.hq_reply = text(raw.hq_reply, 'hq_reply', 5000)
  if (raw.brief_ref !== undefined) patch.brief_ref = text(raw.brief_ref, 'brief_ref', 300)
  if (!Object.keys(patch).length) throw fail(400, 'Send status, hq_reply and/or brief_ref')
  patch.replied_by = principal ? principal.actor : 'agent'
  patch.replied_at = new Date().toISOString()
  const row = must(await db.from('ideas').update(patch).eq('id', id).select('*').maybeSingle(), 'idea')
  if (!row) throw fail(404, `No idea ${id}`)
  if (notify && (patch.hq_reply || patch.status)) {
    const label = { picked_up: 'picked up', briefed: 'briefed', declined: 'declined', new: 'reopened' }[patch.status] || 'replied to'
    await notify(db, row.created_by, { type: 'idea_reply', task: null, body: `HQ ${label} your idea "${row.text.slice(0, 80)}"${patch.hq_reply ? `: ${patch.hq_reply}` : ''}` })
  }
  return row
}

// ─── Amazon listings ────────────────────────────────────────────────────────

const canonicalField = (f) => LISTING_FIELDS.find(x => x.toLowerCase() === String(f || '').trim().toLowerCase())

function key(raw, at) {
  const asin = typeof raw.asin === 'string' ? raw.asin.trim().toUpperCase() : ''
  const marketplace = typeof raw.marketplace === 'string' ? raw.marketplace.trim() : ''
  if (!asin || !marketplace) throw fail(400, `${at} needs asin and marketplace`)
  return { asin, marketplace }
}

/** Validates a listings snapshot { products[], fields[], events[] }. Pure. */
export function cleanSnapshot(body) {
  if (!isObj(body)) throw fail(400, 'Send { products: [], fields: [], events: [] }')
  const products = (body.products || []).map((p, i) => {
    const at = `products[${i}]`
    if (!isObj(p)) throw fail(400, `${at} must be an object`)
    const out = key(p, at)
    for (const k of ['sku', 'product', 'colour', 'parent_asin', 'listing_status', 'buy_box', 'should_source']) if (p[k] !== undefined) out[k] = text(p[k], `${at}.${k}`, 500)
    if (p.category !== undefined) out.category = p.category === null ? null : text(p.category, `${at}.category`, 500)
    if (p.variations !== undefined) { if (p.variations !== null && !isObj(p.variations)) throw fail(400, `${at}.variations must be an object`); out.variations = p.variations }
    for (const k of ['attributes', 'aplus']) {
      if (p[k] === undefined) continue
      if (p[k] !== null && (!Array.isArray(p[k]) || p[k].some(x => !isObj(x)))) throw fail(400, `${at}.${k} must be an array of objects`)
      if (p[k] && JSON.stringify(p[k]).length > 400000) throw fail(400, `${at}.${k} is too large`)
      out[k] = p[k]
    }
    out.checked_at = p.checked_at && isTime(p.checked_at) ? p.checked_at : new Date().toISOString()
    return out
  })
  const fields = (body.fields || []).map((f, i) => {
    const at = `fields[${i}]`
    if (!isObj(f)) throw fail(400, `${at} must be an object`)
    const field = canonicalField(f.field)
    if (!field) throw fail(400, `${at}.field must be one of ${LISTING_FIELDS.join(', ')}`)
    const out = { ...key(f, at), field, position: Number.isInteger(f.position) ? f.position : LISTING_FIELDS.indexOf(field) + 1 }
    if (f.status !== undefined) { if (!FIELD_STATUSES.includes(f.status)) throw fail(400, `${at}.status must be one of ${FIELD_STATUSES.join(', ')}`); out.status = f.status }
    for (const k of ['limit_text', 'should_meta', 'live_meta', 'note']) if (f[k] !== undefined) out[k] = text(f[k], `${at}.${k}`)
    for (const k of ['should', 'live']) {
      if (f[k] === undefined) continue
      if (field === 'Images' && f[k] !== null) {
        if (!Array.isArray(f[k]) || f[k].some(x => !isObj(x))) throw fail(400, `${at}.${k} must be an array of {slot, label, url, px} for Images`)
      }
      out[k] = f[k]
    }
    out.checked_at = f.checked_at && isTime(f.checked_at) ? f.checked_at : new Date().toISOString()
    return out
  })
  const events = (body.events || []).map((e, i) => {
    const at = `events[${i}]`
    if (!isObj(e)) throw fail(400, `${at} must be an object`)
    if (!EVENT_KINDS.includes(e.kind)) throw fail(400, `${at}.kind must be one of ${EVENT_KINDS.join(', ')}`)
    const t = String(e.text || '').trim()
    if (!t) throw fail(400, `${at}.text is required`)
    if (e.at !== undefined && !isTime(e.at)) throw fail(400, `${at}.at must be an ISO date-time`)
    return { ...key(e, at), kind: e.kind, text: t.slice(0, 2000), at: e.at ? new Date(e.at).toISOString() : new Date().toISOString() }
  })
  if (!products.length && !fields.length && !events.length) throw fail(400, 'The snapshot is empty')
  if (products.length + fields.length + events.length > 5000) throw fail(400, 'At most 5,000 rows per snapshot')
  return { products, fields, events }
}

/** POST /api/agent/listings/snapshot: bulk upsert. Products first, so fields and events have their listing. */
export async function postListingSnapshot(db, body) {
  const s = cleanSnapshot(body)
  const products = s.products.length ? await upsertGrouped(db, 'listing_products', s.products, 'asin,marketplace', 'asin, marketplace') : []
  const fields = s.fields.length ? await upsertGrouped(db, 'listing_fields', s.fields, 'asin,marketplace,field', 'asin, marketplace, field, status') : []
  let events = 0
  if (s.events.length) {
    const r = await db.from('listing_events').upsert(s.events, { onConflict: 'asin,marketplace,at,text', ignoreDuplicates: true }).select('id')
    events = must(r, 'listing events').length
  }
  return { products: products.length, fields: fields.length, events_added: events }
}

/** Overall state of one listing from its field statuses (the matrix's last column). */
export function listingOverall(statuses) {
  if (statuses.includes('problem')) return 'problem'
  if (statuses.includes('drift')) return 'drift'
  if (statuses.includes('in_flight')) return 'in_flight'
  if (statuses.includes('proposed')) return 'proposed'
  return 'match'
}

/** GET /api/listings: every listing × field, with an overall state and counts. */
export async function listListings(db, { marketplace } = {}) {
  let pq = db.from('listing_products').select('asin, marketplace, sku, product, colour, parent_asin, listing_status, buy_box, should_source, checked_at, category').order('product').order('marketplace').limit(2000)
  let fq = db.from('listing_fields').select('asin, marketplace, field, position, status, note, checked_at').limit(20000)
  if (marketplace) { pq = pq.eq('marketplace', marketplace); fq = fq.eq('marketplace', marketplace) }
  const [products, fields] = [must(await pq, 'listings'), must(await fq, 'listing fields')]
  // The live title (for search) and the open edits per listing.
  let tq = db.from('listing_fields').select('asin, marketplace, live').eq('field', 'Title').limit(5000)
  let eq = db.from('listing_edits').select('asin, marketplace, kind, name').eq('status', 'proposed').limit(20000)
  if (marketplace) { tq = tq.eq('marketplace', marketplace); eq = eq.eq('marketplace', marketplace) }
  const titles = Object.fromEntries(must(await tq, 'listing titles').map(t => [`${t.asin}|${t.marketplace}`, typeof t.live === 'string' ? t.live : null]))
  const editsBy = {}
  for (const e of must(await eq, 'listing edits')) (editsBy[`${e.asin}|${e.marketplace}`] || (editsBy[`${e.asin}|${e.marketplace}`] = [])).push(e)
  const byKey = {}
  for (const f of fields) (byKey[`${f.asin}|${f.marketplace}`] || (byKey[`${f.asin}|${f.marketplace}`] = [])).push(f)
  const rows = products.map(p => {
    const fs = (byKey[`${p.asin}|${p.marketplace}`] || []).sort((a, b) => (a.position || 0) - (b.position || 0))
    const cells = Object.fromEntries(fs.map(f => [f.field, f.status]))
    const ed = editsBy[`${p.asin}|${p.marketplace}`] || []
    for (const e of ed) if (e.kind === 'field' && cells[e.name] !== 'problem') cells[e.name] = 'proposed'
    const counted = fs.map(f => f.status)
    return { ...p, title: titles[`${p.asin}|${p.marketplace}`] || null, edits: ed.length, cells, overall: listingOverall(counted), drifted: counted.filter(s => s === 'drift').length }
  })
  const count = (k) => rows.filter(r => r.overall === k).length
  return {
    fields: LISTING_FIELDS,
    marketplaces: [...new Set(rows.map(r => r.marketplace))],
    counts: { match: count('match'), drift: count('drift'), in_flight: count('in_flight'), proposed: count('proposed'), problem: count('problem') },
    listings: rows,
  }
}

/** GET /api/listings/:asin/:marketplace: one listing field by field, its history and open change approvals. */
export async function getListing(db, asin, marketplace) {
  const A = String(asin || '').trim().toUpperCase()
  const M = String(marketplace || '').trim()
  if (!A || !M) throw fail(400, 'asin and marketplace are required')
  const product = must(await db.from('listing_products').select('*').eq('asin', A).eq('marketplace', M).maybeSingle(), 'listing')
  if (!product) throw fail(404, `No listing ${A} on ${M}`)
  const [fields, events, edits, approvals] = await Promise.all([
    db.from('listing_fields').select('*').eq('asin', A).eq('marketplace', M).order('position'),
    db.from('listing_events').select('id, at, text, kind').eq('asin', A).eq('marketplace', M).order('at', { ascending: false }).limit(100),
    db.from('listing_edits').select('*').eq('asin', A).eq('marketplace', M).in('status', ['proposed', 'in_approval', 'sent']).order('updated_at', { ascending: false }),
    db.from('tasks').select('id, title, decision, decision_at, created_at, expires_at, assigned_to, approvers, escalated_to, line_decisions')
      .eq('artefact_type', 'listing_change').eq('artefact->>asin', A).eq('artefact->>marketplace', M).is('archived_at', null)
      .order('created_at', { ascending: false }).limit(20),
  ])
  return { product, fields: must(fields, 'listing fields'), events: must(events, 'listing events'), edits: must(edits, 'listing edits'), approvals: must(approvals, 'listing approvals') }
}

// ─── Amazon listing edits (migration 29) ────────────────────────────────────
// Edits made on the listing screen are saved in PM as proposed changes. Nothing here sends anything to Amazon: a
// change reaches Amazon only through a listing_change approval and the listing executor.

export const EDITABLE_FIELDS = ['Title', 'Bullet 1', 'Bullet 2', 'Bullet 3', 'Bullet 4', 'Bullet 5', 'Description', 'Search terms']
const EDIT_KINDS = ['field', 'attribute']

/** Validates one edit { asin, marketplace, kind, name, value, live?, note? }. Pure. */
export function cleanListingEdit(raw) {
  if (!isObj(raw)) throw fail(400, 'Send { asin, marketplace, kind, name, value }')
  const out = key(raw, 'edit')
  if (!EDIT_KINDS.includes(raw.kind)) throw fail(400, `kind must be one of ${EDIT_KINDS.join(', ')}`)
  out.kind = raw.kind
  const name = String(raw.name || '').trim()
  if (raw.kind === 'field') {
    const f = EDITABLE_FIELDS.find(x => x.toLowerCase() === name.toLowerCase())
    if (!f) throw fail(400, `name must be one of ${EDITABLE_FIELDS.join(', ')}`)
    out.name = f
  } else {
    if (!/^[a-z0-9_]{1,100}$/.test(name)) throw fail(400, 'name must be an Amazon attribute name (lower case, letters, digits and _)')
    out.name = name
  }
  if (typeof raw.value !== 'string') throw fail(400, 'value must be text')
  const value = raw.value.replace(/\r\n/g, '\n').trim()
  if (value.length > 10000) throw fail(400, 'value is longer than 10,000 characters')
  out.value = value
  if (raw.live !== undefined) {
    if (raw.live !== null && JSON.stringify(raw.live).length > 20000) throw fail(400, 'live is too large')
    out.live = raw.live
  }
  if (raw.note !== undefined) out.note = text(raw.note, 'note', 1000)
  return out
}

/** POST /api/listings/edits: save (or replace) the proposed edit for one field or attribute. */
export async function saveListingEdit(db, user, raw) {
  const e = cleanListingEdit(raw)
  const listing = must(await db.from('listing_products').select('asin').eq('asin', e.asin).eq('marketplace', e.marketplace).maybeSingle(), 'listing')
  if (!listing) throw fail(404, `No listing ${e.asin} on ${e.marketplace}`)
  const who = (user && user.name) || 'unknown'
  const held = must(await db.from('listing_edits').select('id, status').eq('asin', e.asin).eq('marketplace', e.marketplace).eq('kind', e.kind).eq('name', e.name).maybeSingle(), 'listing edit')
  if (held && ['in_approval', 'sent'].includes(held.status)) throw fail(409, `${e.name} already has a change ${held.status === 'sent' ? 'sent to Amazon' : 'waiting for approval'}`)
  const row = { ...e, status: 'proposed', updated_by: who, ...(held ? {} : { created_by: who }) }
  const r = held
    ? await db.from('listing_edits').update(row).eq('id', held.id).select('*').single()
    : await db.from('listing_edits').insert(row).select('*').single()
  return must(r, 'listing edit')
}

/** PATCH /api/listings/edits?id=: withdraw a proposed edit (kept as history, never deleted). */
export async function withdrawListingEdit(db, user, id) {
  if (!isUuid(id)) throw fail(400, 'id must be an edit UUID')
  const row = must(await db.from('listing_edits').update({ status: 'withdrawn', updated_by: (user && user.name) || 'unknown' })
    .eq('id', id).eq('status', 'proposed').select('*').maybeSingle(), 'listing edit')
  if (!row) throw fail(404, 'No proposed edit with that id')
  return row
}
