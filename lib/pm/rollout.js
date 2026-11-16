// Amazon rollout (Jon 2026-11-16): "I need to see what is created and what needs to be pushed to Amazon - only when the
// image is LIVE on amazon should this be complete." One screen per product: every store x every piece (copy, keywords,
// attributes, each image slot, A+) in one of these stages:
//   todo      not started (the rollout has not been started, or waits for the master)
//   made      the agent is making it (translation, keywords from Brand Analytics, a translated image)
//   you       needs a person: approve the master, a translation, a translated image, an HQ approval card, a manual change
//   approved  approved and ready to push to Amazon (or pushed and waiting for HQ to send it)
//   sent      sent to Amazon, inside Amazon's 72 hours
//   live      Amazon shows it (the daily read): the only stage that counts as done
//   problem   Amazon rejected it or still shows something else after 72 hours (a Seller Support case is drafted)
import { approvalError as fail } from './approvals'
import { planMarket, MARKETS, ENGLISH, LANGUAGE, PER_MARKET, marketImages, masterImages, sendMaster } from './masterSend'
import { liveChecks, labelOf } from './liveCheck'

function must(r, what) { if (r.error) throw fail(500, `${what}: ${r.error.message}`); return r.data }
export const STAGES = ['problem', 'you', 'made', 'todo', 'approved', 'sent', 'live']
export const worst = (list) => list.filter(Boolean).sort((a, b) => STAGES.indexOf(a) - STAGES.indexOf(b))[0] || null
const COPY = ['Title', 'Bullet 1', 'Bullet 2', 'Bullet 3', 'Bullet 4', 'Bullet 5', 'Description']
const imgLabel = (i) => (i === 0 ? 'Main image' : `Image ${i}`)
export const PER_IMAGE_USD = 0.03
export const PER_TRANSLATION_USD = 0.06

/** One store's pieces for one master. Pure. */
export function rolloutMarket({ master, market, product, fields = [], edits = [], events = [], translations = [], aplus = null, now = new Date() }) {
  const started = !!(master.rollout && master.rollout.started_at)
  const approvedMaster = master.status === 'approved'
  const english = ENGLISH.includes(market)
  const plan = planMarket({ master, market, product, fields, held: edits, translations })
  if (plan.blocked) return { market, sold: false }
  const variant = english ? null : (master.variants || {})[market] || null
  const problems = new Map(liveChecks({ edits, product, fields, events, now }).filter(c => c.state === 'problem').map(c => [c.label, c]))
  const changes = new Map(plan.changes.map(c => [c.label, c]))
  const skipped = new Map(plan.skipped.map(s => [s.name, s]))
  const waitingFor = english ? null : !variant ? (started && approvedMaster ? 'made' : 'todo') : variant.status !== 'approved' ? 'you' : null

  const state = (label) => {
    if (problems.has(label)) return { stage: 'problem', why: problems.get(label).why }
    if (changes.has(label)) return approvedMaster ? { stage: 'approved', why: 'Ready to push to Amazon' } : { stage: 'todo', why: 'Waits for the master to be approved' }
    const s = skipped.get(label)
    if (s) {
      if (/already live/.test(s.why)) return { stage: 'live', why: 'Amazon shows it' }
      if (/already sent/.test(s.why)) return { stage: 'sent', why: s.why }
      if (/waiting for approval/.test(s.why)) {
        const e = edits.find(x => ['submitted', 'in_approval'].includes(x.status) && labelOf(x) === label)
        return e && e.status === 'submitted' ? { stage: 'approved', why: 'Pushed: Doddl HQ is checking it' } : { stage: 'you', why: 'Waiting for your approval in Doddl HQ' }
      }
      if (/several parts/.test(s.why)) return { stage: 'you', why: 'Change it in Seller Central' }
      if (/not translated yet|no translation/.test(s.why)) return { stage: waitingFor || 'made', why: started ? 'The agent is translating it' : 'Not started' }
      if (/translation not approved/.test(s.why)) return { stage: 'you', why: 'Approve the translation' }
      return { stage: 'you', why: s.why }
    }
    return { stage: 'live', why: 'Matches the master' }
  }

  // Copy and keywords
  const copyStates = COPY.map(l => ({ label: l, ...state(l) }))
  const kwState = { label: 'Search terms', ...state('Search terms') }
  const kwInfo = english ? { basis: 'master' } : variant && variant.keywords ? variant.keywords : null
  // Attributes (one row, worst of them)
  const attrNames = (master.attributes || []).filter(a => !PER_MARKET.has(a.name)).map(a => a.name)
  const attrStates = attrNames.map(n => ({ label: n, ...state(n) }))
  // Images, slot by slot
  const want = marketImages(master, market, translations)
  const byUrl = new Map(translations.filter(t => t.locale === market).map(t => [t.source_url, t]))
  const images = want.map((w, i) => {
    const label = imgLabel(i)
    if (!w.ready) {
      const t = byUrl.get(w.source)
      const st = !t ? (started && approvedMaster ? 'made' : 'todo') : ['read', 'rendered'].includes(t.status) ? 'made' : 'you'
      const why = !t ? (started ? 'The agent is translating it' : 'Not started') : t.status === 'checked' ? 'Approve the translated image' : t.status === 'problem' ? 'The check found a problem: approve or redo' : t.status === 'over_photo' ? 'Text over the photo: needs a designer' : t.status === 'rejected' ? 'Rejected: redo it' : 'The agent is translating it'
      return { slot: w.slot, label, stage: st, why, master: w.source, made: t && t.url ? t.url : null, translation_id: t ? t.id : null, translation: t ? t.status : null }
    }
    const s = state(label)
    const l = (((fields || []).find(x => x.field === 'Images') || {}).live || []).filter(x => x && x.slot !== 'SWCH')[i]
    return { slot: w.slot, label, ...s, master: w.source, made: w.url !== w.source ? w.url : null, live: l ? l.url : null, translation: w.translation }
  })
  // A+
  let aplusState = null
  if (aplus) {
    const send = (aplus.sends || {})[market]
    const v = english ? null : (aplus.variants || {})[market]
    if (send && send.status === 'live') aplusState = { stage: 'live', why: 'Amazon shows it' }
    else if (send && ['refused', 'rejected'].includes(send.status)) aplusState = { stage: 'problem', why: send.note || 'Amazon did not take it' }
    else if (send && send.status === 'sent') aplusState = { stage: 'sent', why: 'Sent: waiting for Amazon' }
    else if (send && send.status === 'in_approval') aplusState = { stage: 'you', why: 'Waiting for your approval in Doddl HQ' }
    else if (send && send.status === 'submitted') aplusState = { stage: 'approved', why: 'Pushed: Doddl HQ is checking it' }
    else if (aplus.status !== 'approved') aplusState = { stage: 'you', why: 'Approve the A+ page' }
    else if (!english && !v) aplusState = { stage: started ? 'made' : 'todo', why: started ? 'The agent is translating it' : 'Not started' }
    else if (!english && v.status !== 'approved') aplusState = { stage: 'you', why: 'Approve the A+ translation' }
    else aplusState = { stage: 'approved', why: 'Ready to push to Amazon' }
  }

  const copy = { stage: worst(copyStates.map(x => x.stage)), items: copyStates }
  const attributes = { stage: worst(attrStates.map(x => x.stage)) || 'live', items: attrStates.filter(x => x.stage !== 'live') }
  const all = [copy.stage, kwState.stage, attributes.stage, ...images.map(x => x.stage), aplusState && aplusState.stage].filter(Boolean)
  const count = (st) => all.filter(x => x === st).length
  const pieces = { live: count('live'), total: all.length, you: count('you'), made: count('made'), todo: count('todo'), approved: count('approved'), sent: count('sent'), problem: count('problem') }
  const next = pieces.problem ? `${pieces.problem} Amazon problem${pieces.problem === 1 ? '' : 's'}: case drafted`
    : pieces.you ? `${pieces.you} need${pieces.you === 1 ? 's' : ''} you`
    : pieces.made ? 'The agent is working on it'
    : pieces.todo ? (approvedMaster ? 'Start the rollout' : 'Waits for the master to be approved')
    : pieces.approved ? `${pieces.approved} ready to push to Amazon`
    : pieces.sent ? `${pieces.sent} sent, waiting for Amazon`
    : 'Everything live'
  return {
    market, sold: true, sku: product.sku, language: english ? 'English: the master as it is' : LANGUAGE[market],
    copy, keywords: { ...kwState, info: kwInfo, value: english ? (master.copy || {}).search_terms || '' : variant ? (variant.copy || {}).search_terms || '' : '' },
    attributes, images, aplus: aplusState, pieces, done: pieces.total > 0 && pieces.live === pieces.total, next,
    to_push: plan.changes.length && approvedMaster ? plan.changes.length : 0,
  }
}

async function load(db, asins) {
  const q = (t, cols) => db.from(t).select(cols).in('asin', asins)
  const [masters, products, fields, edits, events, trans, aplus] = await Promise.all([
    q('listing_masters', '*'),
    q('listing_products', 'asin, marketplace, sku, product, attributes, checked_at').limit(5000),
    q('listing_fields', 'asin, marketplace, field, live').limit(50000),
    q('listing_edits', 'id, asin, marketplace, kind, name, status, value, live, sent_at, hq_at').limit(50000),
    q('listing_events', 'asin, marketplace, at, text').gte('at', new Date(Date.now() - 14 * 864e5).toISOString()).limit(50000),
    q('image_translations', 'id, asin, locale, source_url, status, url, cost_usd, layout, check_result, note, updated_at').limit(20000),
    q('listing_aplus', 'asin, status, variants, sends').limit(500),
  ])
  return {
    masters: must(masters, 'listing masters'), products: must(products, 'listings'), fields: must(fields, 'listing fields'), edits: must(edits, 'listing edits'),
    events: must(events, 'listing events'), trans: must(trans, 'image translations'), aplus: must(aplus, 'A+ pages'),
  }
}

function forMaster(d, m, now) {
  const of = (rows, mk) => rows.filter(r => r.asin === m.asin && r.marketplace === mk)
  const markets = MARKETS.map(mk => rolloutMarket({
    master: m, market: mk, product: d.products.find(p => p.asin === m.asin && p.marketplace === mk) || null, fields: of(d.fields, mk), edits: of(d.edits, mk), events: of(d.events, mk),
    translations: d.trans.filter(t => t.asin === m.asin), aplus: d.aplus.find(a => a.asin === m.asin) || null, now,
  })).filter(x => x.sold)
  const sum = (k) => markets.reduce((n, x) => n + x.pieces[k], 0)
  const r = m.rollout || {}
  return {
    asin: m.asin, product: m.product, master_sku: m.master_sku, master: m.status, approved_at: m.approved_at,
    images: masterImages(m).map(x => x.url), rollout: r.started_at ? r : null,
    markets, live_markets: markets.filter(x => x.done).length, you: sum('you'), sent: sum('sent'), problems: sum('problem'), approved: sum('approved'), made: sum('made'),
  }
}

/** GET /api/listings/rollout?asin=: one product in full, or (no asin) every product's summary. */
export async function getRollout(db, { asin } = {}) {
  const now = new Date()
  if (asin) {
    const A = String(asin).toUpperCase()
    const d = await load(db, [A])
    const m = d.masters[0]
    if (!m) throw fail(404, `No master for ${A}`)
    return { product: forMaster(d, m, now), estimate: estimate(m, d.products.filter(p => p.asin === A).map(p => p.marketplace), d.trans.filter(t => t.asin === A), d.aplus.find(a => a.asin === A)) }
  }
  const ms = must(await db.from('listing_masters').select('asin').limit(500), 'listing masters')
  const d = await load(db, ms.map(x => x.asin))
  const list = d.masters.map(m => forMaster(d, m, now)).map(p => ({ ...p, markets: p.markets.map(x => ({ market: x.market, done: x.done, pieces: x.pieces, next: x.next })) }))
  const sold = new Set(must(await db.from('listing_products').select('asin').limit(10000), 'listings').map(p => p.asin))
  return { products: list.sort((a, b) => (b.you - a.you) || String(a.product || '').localeCompare(String(b.product || ''))), without_master: [...sold].filter(a => !d.masters.some(m => m.asin === a)).length }
}

/** What the agent would spend on one master (before it starts). Pure. */
export function estimate(master, soldMarkets, translations = [], aplus = null) {
  const langs = soldMarkets.filter(mk => LANGUAGE[mk])
  const imgs = masterImages(master).slice(1).filter(x => x && x.url)
  let images = 0, copy = 0, aplusN = 0
  for (const mk of langs) {
    images += imgs.filter(x => !translations.some(t => t.locale === mk && t.source_url === x.url)).length
    if (!(master.variants || {})[mk]) copy++
    if (aplus && aplus.status === 'approved' && !(aplus.variants || {})[mk]) aplusN++
  }
  const usd = images * PER_IMAGE_USD + (copy + aplusN) * PER_TRANSLATION_USD
  return { markets: langs, images, translations: copy, aplus: aplusN, usd: Math.round(usd * 100) / 100, budget: Math.max(1, Math.ceil(usd * 1.5)) }
}

/** POST /api/listings/rollout { op: start | stop | push, asin, budget?, markets? } */
export async function rolloutOp(db, user, b = {}) {
  const A = String(b.asin || '').toUpperCase()
  if (!/^[A-Z0-9]{10}$/.test(A)) throw fail(400, 'asin must be a 10-character ASIN')
  const who = (user && user.name) || 'unknown'
  const m = must(await db.from('listing_masters').select('*').eq('asin', A).maybeSingle(), 'listing master')
  if (!m) throw fail(404, `No master for ${A}`)
  if (b.op === 'start') {
    if (m.status !== 'approved') throw fail(400, 'Approve the master first: the agent works from the approved master')
    if (!masterImages(m).length) throw fail(400, 'Set the master images first')
    const budget = Number(b.budget)
    if (!(budget > 0 && budget <= 25)) throw fail(400, 'budget must be between $0.01 and $25')
    const r = { ...(m.rollout || {}), started_at: new Date().toISOString(), started_by: who, budget_usd: budget, spent_usd: Number((m.rollout || {}).spent_usd || 0), paused: false, last_note: 'Started: the agent picks this up within 10 minutes' }
    return { rollout: must(await db.from('listing_masters').update({ rollout: r }).eq('asin', A).select('rollout').single(), 'listing master').rollout }
  }
  if (b.op === 'stop') {
    const r = { ...(m.rollout || {}), paused: true, last_note: `Paused by ${who}` }
    return { rollout: must(await db.from('listing_masters').update({ rollout: r }).eq('asin', A).select('rollout').single(), 'listing master').rollout }
  }
  if (b.op === 'push') {
    const list = (Array.isArray(b.markets) && b.markets.length ? b.markets : MARKETS).filter(x => MARKETS.includes(x))
    return sendMaster(db, user, { asin: A, markets: list })
  }
  throw fail(400, 'op must be start, stop or push')
}
