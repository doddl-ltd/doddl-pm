// Cases for Amazon Seller Support (migration 33). Built from a listing's live-check problems; a person files the text in
// Seller Central (there is no API for cases) and records Amazon's case ID here.
import { approvalError as fail } from './approvals'
import { caseText, liveChecks } from './liveCheck'
import { MARKETS } from './hq'

function must(r, what) { if (r.error) throw fail(500, `${what}: ${r.error.message}`); return r.data }
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const STATUSES = ['draft', 'filed', 'resolved', 'closed']

/** POST /api/listings/cases { op: 'build', asin, marketplace }: a draft case from the listing's problems. */
export async function buildListingCase(db, user, { asin, marketplace }) {
  const A = String(asin || '').trim().toUpperCase(), M = String(marketplace || '').trim()
  if (!/^[A-Z0-9]{10}$/.test(A) || !MARKETS.includes(M)) throw fail(400, 'asin and marketplace are required')
  const product = must(await db.from('listing_products').select('*').eq('asin', A).eq('marketplace', M).maybeSingle(), 'listing')
  if (!product) throw fail(404, `No listing ${A} on ${M}`)
  const [fields, events, edits] = await Promise.all([
    db.from('listing_fields').select('field, live').eq('asin', A).eq('marketplace', M),
    db.from('listing_events').select('at, text').eq('asin', A).eq('marketplace', M).order('at', { ascending: false }).limit(200),
    db.from('listing_edits').select('*').eq('asin', A).eq('marketplace', M).eq('status', 'sent'),
  ])
  const problems = liveChecks({ edits: must(edits, 'listing edits'), product, fields: must(fields, 'listing fields'), events: must(events, 'listing events') }).filter(c => c.state === 'problem')
  if (!problems.length) throw fail(400, 'Nothing on this listing is a problem: a case is built only when Amazon does not show what was sent')
  const { subject, body } = caseText({ product, marketplace: M, problems })
  const who = (user && user.name) || 'unknown'
  return must(await db.from('listing_cases').insert({ asin: A, marketplace: M, kind: 'listing', status: 'draft', subject, body, edit_ids: problems.map(p => p.id), created_by: who, updated_by: who }).select('*').single(), 'listing case')
}

/** POST /api/listings/cases { op: 'update', id, status?, amazon_case_id?, note?, body? }: filed, resolved, closed. */
export async function updateListingCase(db, user, raw) {
  if (!isUuid(raw.id)) throw fail(400, 'id must be a case UUID')
  const patch = { updated_by: (user && user.name) || 'unknown', updated_at: new Date().toISOString() }
  if (raw.status !== undefined) {
    if (!STATUSES.includes(raw.status)) throw fail(400, `status must be one of ${STATUSES.join(', ')}`)
    patch.status = raw.status
    if (raw.status === 'filed') patch.filed_at = patch.updated_at
    if (raw.status === 'resolved') patch.resolved_at = patch.updated_at
  }
  if (raw.amazon_case_id !== undefined) {
    const c = String(raw.amazon_case_id || '').trim()
    if (c && !/^[A-Za-z0-9-]{4,40}$/.test(c)) throw fail(400, 'amazon_case_id must be Amazon\'s case number')
    patch.amazon_case_id = c || null
  }
  if (raw.note !== undefined) patch.note = String(raw.note || '').slice(0, 4000) || null
  if (raw.body !== undefined) { if (typeof raw.body !== 'string' || !raw.body.trim()) throw fail(400, 'body must be text'); patch.body = raw.body.slice(0, 20000) }
  if (patch.status === 'filed' && !(patch.amazon_case_id || raw.amazon_case_id)) {
    const cur = must(await db.from('listing_cases').select('amazon_case_id').eq('id', raw.id).maybeSingle(), 'listing case')
    if (!cur) throw fail(404, 'No such case')
    if (!cur.amazon_case_id) throw fail(400, 'Add Amazon\'s case number when you mark it filed')
  }
  const r = must(await db.from('listing_cases').update(patch).eq('id', raw.id).select('*').maybeSingle(), 'listing case')
  if (!r) throw fail(404, 'No such case')
  return r
}
