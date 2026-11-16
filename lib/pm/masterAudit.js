// The daily master check (migration 36). Jon 2026-11-16: "I want EVERY SINGLE attribute to match on every ASIN", and
// once changes have been pushed, compare what is live on Amazon with what should be live and "flag this agent to fix /
// create case". Runs after HQ reads Amazon each day (cron /api/cron/master-audit) and writes one listing_audit row per
// listing. Every difference says what fixes it:
//   send       sending the master to this market fixes it (the agent's job once the master is approved)
//   approve    the same, but the master has to be approved first
//   translate  waiting on an approved translation for this market
//   manual     a value with several parts: change it in Seller Central
//   extra      Amazon has an attribute the master does not: add it to the master or mark it to remove
//   waiting    sent, inside Amazon's 72 hours
//   approval   already waiting for an approval
//   case       sent, Amazon still shows something else after 72 hours: a draft Seller Support case is raised
import { approvalError as fail } from './approvals'
import { planMarket, PER_MARKET, MARKETS } from './masterSend'
import { liveChecks, IMAGE_ATTR } from './liveCheck'
import { buildListingCase } from './cases'

function must(r, what) { if (r.error) throw fail(500, `${what}: ${r.error.message}`); return r.data }

const COPY_ATTRS = new Set(['item_name', 'bullet_point', 'product_description', 'generic_keyword'])
// Groups that are per market by nature (price and stock, images, the variation structure): never scored.
const NOT_SCORED_GROUPS = new Set(['offer', 'images', 'variations'])
const WHY = [
  [/already waiting for approval/, 'approval'],
  [/already live/, null],
  [/already sent/, 'waiting'],
  [/several parts/, 'manual'],
  [/translat/, 'translate'],
]

function groupsOf(ptd) {
  const by = {}
  for (const [key, g] of Object.entries((ptd && ptd.groups) || {})) for (const n of g.names || []) by[n] = key
  return by
}

/** One listing against its master. Pure. */
export function auditMarket({ master, market, product, fields, edits = [], events = [], ptd = null, now = new Date() }) {
  const items = []
  const plan = planMarket({ master, market, product, fields, held: edits })
  const approved = master.status === 'approved'
  for (const c of plan.changes) items.push({ kind: c.image ? 'image' : c.kind === 'field' ? 'copy' : 'attribute', name: c.name, label: c.label, live: c.from ?? null, should: c.remove ? '(remove)' : c.to, action: approved ? 'send' : 'approve' })
  for (const s of plan.skipped) {
    const hit = WHY.find(([re]) => re.test(s.why))
    const action = hit ? hit[1] : 'manual'
    if (action) items.push({ kind: 'note', name: s.name, label: s.name, live: null, should: null, action, why: s.why })
  }
  // Sent and still not what Amazon shows after its 72 hours: a case.
  for (const p of liveChecks({ edits: edits.filter(e => e.status === 'sent'), product, fields, events, now }).filter(c => c.state === 'problem')) {
    items.push({ kind: 'sent', name: p.label, label: p.label, live: p.page ?? p.ours ?? null, should: p.sent ?? null, action: 'case', why: p.why, edit_id: p.id })
  }
  // Attributes Amazon has that the master does not (scored ones only).
  const inMaster = new Set((master.attributes || []).map(a => a.name))
  const groups = groupsOf(ptd)
  const seen = new Set()
  for (const a of (product.attributes || [])) {
    if (seen.has(a.name)) continue
    seen.add(a.name)
    if (inMaster.has(a.name) || COPY_ATTRS.has(a.name) || PER_MARKET.has(a.name) || IMAGE_ATTR.test(a.name) || NOT_SCORED_GROUPS.has(groups[a.name])) continue
    if (a.value == null || String(a.value).trim() === '') continue
    items.push({ kind: 'attribute', name: a.name, label: a.name.replace(/_/g, ' '), live: a.value, should: null, action: 'extra' })
  }
  const count = (k) => items.filter(i => i.action === k).length
  const compared = 8 + (master.attributes || []).filter(a => !PER_MARKET.has(a.name)).length + (((master.images || {})[market]) || []).length
  const open = items.filter(i => ['send', 'approve', 'translate', 'manual', 'case'].includes(i.action)).length
  return {
    asin: master.asin, marketplace: market, master: master.status || null,
    matches: Math.max(0, compared - open - count('waiting') - count('approval')),
    to_send: count('send') + count('approve'), translate: count('translate'), manual: count('manual'), extra: count('extra'),
    waiting: count('waiting') + count('approval'), problems: count('case'), items,
  }
}

/** Every listing with a master, checked and stored; a draft case is raised where Amazon has not applied what was sent. */
export async function runMasterAudit(db, { now = new Date() } = {}) {
  const masters = must(await db.from('listing_masters').select('*'), 'listing masters')
  if (!masters.length) return { checked: 0, listings: 0 }
  const asins = masters.map(m => m.asin)
  const [products, fields, edits, events, ptds, cases] = await Promise.all([
    db.from('listing_products').select('asin, marketplace, sku, attributes, checked_at').in('asin', asins).limit(5000),
    db.from('listing_fields').select('asin, marketplace, field, live').in('asin', asins).limit(50000),
    db.from('listing_edits').select('id, asin, marketplace, kind, name, status, value, live, sent_at, hq_at').in('asin', asins).limit(50000),
    db.from('listing_events').select('asin, marketplace, at, text').in('asin', asins).gte('at', new Date(now - 14 * 864e5).toISOString()).limit(50000),
    db.from('listing_ptd').select('product_type, marketplace, groups'),
    db.from('listing_cases').select('id, asin, marketplace, status').in('status', ['draft', 'filed']),
  ])
  const P = must(products, 'listings'), F = must(fields, 'listing fields'), E = must(edits, 'listing edits'), V = must(events, 'listing events')
  const PT = must(ptds, 'listing definitions'), K = must(cases, 'listing cases')
  const key = (a, m) => `${a}|${m}`
  const by = (rows) => { const o = {}; for (const r of rows) (o[key(r.asin, r.marketplace)] || (o[key(r.asin, r.marketplace)] = [])).push(r); return o }
  const Fb = by(F), Eb = by(E), Vb = by(V)
  const out = []
  let raised = 0
  for (const m of masters) {
    for (const p of P.filter(x => x.asin === m.asin && MARKETS.includes(x.marketplace))) {
      const k = key(p.asin, p.marketplace)
      const ptd = PT.find(d => d.product_type === m.product_type && d.marketplace === p.marketplace) || PT.find(d => d.product_type === m.product_type && d.marketplace === 'UK') || null
      const a = auditMarket({ master: m, market: p.marketplace, product: p, fields: Fb[k] || [], edits: Eb[k] || [], events: Vb[k] || [], ptd, now })
      let caseId = (K.find(c => c.asin === p.asin && c.marketplace === p.marketplace) || {}).id || null
      if (a.problems && !caseId) {
        try { caseId = (await buildListingCase(db, { name: 'Doddl HQ' }, { asin: p.asin, marketplace: p.marketplace })).id; raised++ } catch { /* nothing a case can be built from yet */ }
      }
      out.push({ ...a, case_id: caseId, checked_at: now.toISOString() })
    }
  }
  for (let i = 0; i < out.length; i += 200) must(await db.from('listing_audit').upsert(out.slice(i, i + 200), { onConflict: 'asin,marketplace' }), 'listing audit')
  const sum = (k) => out.reduce((n, r) => n + r[k], 0)
  return { checked: masters.length, listings: out.length, matching: out.filter(r => !(r.to_send + r.translate + r.manual + r.extra + r.problems)).length, to_send: sum('to_send'), translate: sum('translate'), manual: sum('manual'), extra: sum('extra'), problems: sum('problems'), cases_raised: raised }
}

/** GET /api/listings/audit: the latest check, per listing. */
export async function getMasterAudit(db, { asin } = {}) {
  let q = db.from('listing_audit').select('*').order('asin').limit(5000)
  if (asin) q = q.eq('asin', String(asin).toUpperCase())
  return { audit: must(await q, 'listing audit') }
}
