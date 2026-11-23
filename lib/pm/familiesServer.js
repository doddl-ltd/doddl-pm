// Server side of Amazon listings by family (migration 43): derive + store the families from the live listings, the
// overview, one family's page, and the small edits (slot map, own keywords, clean-up status, sign-off).
// Nothing here writes to Amazon.
import { approvalError as fail } from './approvals'
import { signShots } from './pageCapture'
import { deriveFamilies, keywordFocus, keywordKey, keywordBulk, KEYWORD_CHOICES, seoScore, slotsOf, composeImages, covers, gapMap, COMPETITORS, SLOTS, STORES, DEFAULT_SLOT_MAP } from './families'
import { loadMaster, masterOp, writeSeoCopy, STANDARD_COLOURS } from './familyMaster'

function must(r, what) { if (r.error) throw fail(500, `${what}: ${r.error.message}`); return r.data }
// PostgREST stops at 1000 rows: page through.
async function all(make, what) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const rows = must(await make().range(from, from + 999), what)
    out.push(...rows)
    if (rows.length < 1000) return out
  }
}
const chunks = (a, n = 200) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }
async function inChunks(ids, make, what) { const out = []; for (const c of chunks([...new Set(ids)])) out.push(...await all(() => make(c), what)); return out }
const PRODUCT_COLS = 'asin, marketplace, sku, product, colour, parent_asin, listing_status, variations, buy_box'
const COPY_FIELDS = { Title: 'title', 'Bullet 1': 'bullet_1', 'Bullet 2': 'bullet_2', 'Bullet 3': 'bullet_3', 'Bullet 4': 'bullet_4', 'Bullet 5': 'bullet_5', Description: 'description', 'Search terms': 'search_terms' }

/** Re-derive every family from the live listings and store it. Keeps sign-off, slot maps, own keywords and clean-up
 * decisions; a clean-up item that is no longer found is marked fixed. */
export async function syncFamilies(db, by = 'system') {
  const products = await all(() => db.from('listing_products').select(PRODUCT_COLS).order('asin').order('marketplace'), 'listing products')
  const d = deriveFamilies(products)
  const at = new Date().toISOString()
  if (d.families.length) must(await db.from('listing_families').upsert(d.families.map(f => ({ ...f, derived_at: at, updated_at: at })), { onConflict: 'family_code' }), 'families')
  const oldM = await all(() => db.from('listing_family_members').select('asin, marketplace'), 'family members')
  const keepM = new Set(d.members.map(m => `${m.asin}|${m.marketplace}`))
  for (const c of chunks(d.members, 500)) must(await db.from('listing_family_members').upsert(c.map(m => ({ ...m, derived_at: at })), { onConflict: 'asin,marketplace' }), 'family members')
  for (const m of oldM.filter(m => !keepM.has(`${m.asin}|${m.marketplace}`))) must(await db.from('listing_family_members').delete().eq('asin', m.asin).eq('marketplace', m.marketplace), 'family members')
  const oldP = await all(() => db.from('listing_family_parents').select('family_code, marketplace, parent_asin'), 'family parents')
  const keepP = new Set(d.parents.map(p => `${p.family_code}|${p.marketplace}|${p.parent_asin}`))
  if (d.parents.length) must(await db.from('listing_family_parents').upsert(d.parents.map(p => ({ ...p, derived_at: at })), { onConflict: 'family_code,marketplace,parent_asin' }), 'family parents')
  for (const p of oldP.filter(p => !keepP.has(`${p.family_code}|${p.marketplace}|${p.parent_asin}`))) must(await db.from('listing_family_parents').delete().eq('family_code', p.family_code).eq('marketplace', p.marketplace).eq('parent_asin', p.parent_asin), 'family parents')
  const oldC = await all(() => db.from('listing_cleanup').select('family_code, marketplace, problem_key, status'), 'clean-up')
  const keepC = new Set(d.cleanup.map(c => `${c.family_code}|${c.marketplace}|${c.problem_key}`))
  if (d.cleanup.length) must(await db.from('listing_cleanup').upsert(d.cleanup.map(c => ({ ...c, derived_at: at })), { onConflict: 'family_code,marketplace,problem_key' }), 'clean-up')
  // gone from the live listings = fixed on Amazon; reopened if it ever comes back (status stays as set otherwise)
  for (const c of oldC.filter(c => !keepC.has(`${c.family_code}|${c.marketplace}|${c.problem_key}`) && c.status !== 'fixed')) must(await db.from('listing_cleanup').update({ status: 'fixed', updated_at: at, updated_by: 'refresh' }).eq('family_code', c.family_code).eq('marketplace', c.marketplace).eq('problem_key', c.problem_key), 'clean-up')
  for (const c of oldC.filter(c => keepC.has(`${c.family_code}|${c.marketplace}|${c.problem_key}`) && c.status === 'fixed')) must(await db.from('listing_cleanup').update({ status: 'open', updated_at: at, updated_by: 'refresh' }).eq('family_code', c.family_code).eq('marketplace', c.marketplace).eq('problem_key', c.problem_key), 'clean-up')
  return { families: d.families.length, members: d.members.length, parents: d.parents.length, cleanup: d.cleanup.length, by, at }
}

function copyFrom(master, liveFields) {
  const m = master && master.copy && master.copy.title ? master.copy : null
  if (m) return { copy: m, source: 'master' }
  const copy = {}
  for (const f of liveFields || []) if (COPY_FIELDS[f.field] && typeof f.live === 'string') copy[COPY_FIELDS[f.field]] = f.live
  return { copy, source: 'live' }
}
const isLive = (s) => /active|buyable/i.test(String(s || '')) || /buyable/i.test(String(s || ''))
const SHORT = { split: 'Split parents', empty_parent: 'Empty parent', one_child: '1-colour parent', outside: 'Outside family', no_family: 'No family', packs: 'Packs mixed in', colour_names: 'Colour names', same_colour: 'Same colour name' }
const DECISIONS = (rows) => [...new Set(rows.filter(c => c.decision_needed && c.status === 'open').map(c => c.decision_needed))]

/** The listings overview: one row per family with each store's state, master, SEO (UK) and what needs you. */
export async function listFamilies(db) {
  let families = must(await db.from('listing_families').select('*').order('name'), 'families')
  if (!families.length) { await syncFamilies(db, 'first view'); families = must(await db.from('listing_families').select('*').order('name'), 'families') }
  const members = await all(() => db.from('listing_family_members').select('*'), 'family members')
  const cleanup = await all(() => db.from('listing_cleanup').select('*'), 'clean-up')
  const products = await all(() => db.from('listing_products').select('asin, marketplace, listing_status'), 'listing products')
  const status = new Map(products.map(p => [`${p.asin}|${p.marketplace}`, p.listing_status]))
  const leads = families.map(f => f.lead_asin).filter(Boolean)
  const masters = leads.length ? must(await db.from('listing_masters').select('asin, status, copy').in('asin', leads), 'masters') : []
  const fms = must(await db.from('listing_family_master').select('family_code, copy, status'), 'family masters')
  const fields = await inChunks(leads, (c) => db.from('listing_fields').select('asin, field, live').eq('marketplace', 'UK').in('asin', c).in('field', [...Object.keys(COPY_FIELDS), 'Images', 'A+ content']), 'listing fields')
  const kw = await inChunks(members.filter(m => m.marketplace === 'UK').map(m => m.asin), (c) => db.from('listing_keywords').select('asin, search_query, query_volume, asin_impressions, asin_clicks, asin_purchases, is_brand_term').eq('marketplace', 'UK').in('asin', c), 'keywords')
  const rows = families.map(f => {
    const mine = members.filter(m => m.family_code === f.family_code)
    const probs = cleanup.filter(c => c.family_code === f.family_code && c.status === 'open')
    const stores = {}
    for (const s of STORES) {
      const here = mine.filter(m => m.marketplace === s && m.role !== 'parent')
      if (!here.length) { stores[s] = { state: 'none' }; continue }
      const p = probs.filter(c => c.marketplace === s).sort((a, b) => b.wave - a.wave)[0]
      stores[s] = p ? { state: 'problem', label: SHORT[p.problem_key] || 'To fix', title: p.problem, wave: p.wave } : { state: here.some(m => isLive(status.get(`${m.asin}|${s}`))) ? 'live' : 'listed' }
    }
    const master = masters.find(m => m.asin === f.lead_asin)
    const lf = fields.filter(x => x.asin === f.lead_asin)
    const fmRow = fms.find(x => x.family_code === f.family_code)
    const { copy } = fmRow && fmRow.copy && fmRow.copy.title ? { copy: fmRow.copy } : copyFrom(master, lf)
    const ukAsins = new Set(mine.filter(m => m.marketplace === 'UK').map(m => m.asin))
    const focus = keywordFocus(kw.filter(k => ukAsins.has(k.asin)), copy, f.own_keywords, f.keyword_choices)
    const img = lf.find(x => x.field === 'Images')
    const ap = lf.find(x => x.field === 'A+ content')
    const seo = ukAsins.size ? seoScore({ copy, keywords: focus, images: Array.isArray(img && img.live) ? img.live.filter(x => x.slot !== 'SWCH').length : 0, aplusLive: !!(ap && ap.live && (!Array.isArray(ap.live) || ap.live.length)), familyOk: !probs.some(c => c.marketplace === 'UK' && c.fix_kind === 'relink') }) : null
    // colour names as the English stores show them (UK first), so translations don't count as extra colours
    const named = (m) => m.role !== 'parent' && !m.is_pack && m.colour
    const pick = ['UK', 'US', 'CA', 'IE'].map(s => mine.filter(m => m.marketplace === s && named(m))).find(l => l.length) || mine.filter(named)
    const colours = [...new Set(pick.map(m => m.colour.trim()))]
    return {
      family_code: f.family_code, name: f.name, lead_asin: f.lead_asin,
      colours: colours.length, colour_names: colours.slice(0, 4),
      products: new Set(mine.filter(m => m.role !== 'parent').map(m => m.asin)).size,
      master: master ? master.status : null, signoff: f.signoff || {},
      stores, seo: seo ? seo.score : null, problems: probs.length, decisions: DECISIONS(probs),
    }
  })
  const open = cleanup.filter(c => c.status === 'open')
  return { families: rows, stores: STORES, counts: { all: rows.length, problems: rows.filter(r => r.problems).length, decisions: rows.filter(r => r.decisions.length).length, cleanup_open: open.length, cleanup_fixed: cleanup.filter(c => c.status === 'fixed').length } }
}

const NOUNS = /plate|bowl|cutlery|spoon|fork|knife|kit|case|utensil|weaning|suction/g
// other brands' names: never suggested (a listing must not use another brand's name)
const OTHER_BRAND = COMPETITORS
/** One family's page: members per store, parents, clean-up, master copy, keyword focus + SEO, images, A+, rank,
 * reviews and evidence. */
export async function getFamily(db, code) {
  const f = must(await db.from('listing_families').select('*').eq('family_code', code).maybeSingle(), 'family')
  if (!f) throw fail(404, `No family ${code}`)
  const members = must(await db.from('listing_family_members').select('*').eq('family_code', code), 'family members')
  const asins = [...new Set(members.map(m => m.asin))]
  const [parents, cleanup, products, masters] = await Promise.all([
    db.from('listing_family_parents').select('*').eq('family_code', code).then(r => must(r, 'family parents')),
    db.from('listing_cleanup').select('*').eq('family_code', code).order('wave').then(r => must(r, 'clean-up')),
    inChunks(asins, (c) => db.from('listing_products').select(PRODUCT_COLS).in('asin', c), 'listing products'),
    inChunks(asins, (c) => db.from('listing_masters').select('asin, master_sku, product, status, copy, images, variants, attributes').in('asin', c), 'masters'),
  ])
  const lead = masters.find(m => m.asin === f.lead_asin) || null
  const leadFields = must(await db.from('listing_fields').select('field, live, status').eq('asin', f.lead_asin).eq('marketplace', 'UK'), 'listing fields')
  const { fm, target } = await loadMaster(db, code)
  const { copy, source } = fm && Object.values(fm.copy || {}).some(Boolean) ? { copy: { ...fm.copy }, source: 'family' } : copyFrom(lead, leadFields)
  const ukAsins = members.filter(m => m.marketplace === 'UK' && m.role !== 'parent').map(m => m.asin)
  const kw = ukAsins.length ? await inChunks([...ukAsins, '*'], (c) => db.from('listing_keywords').select('asin, search_query, query_volume, asin_impressions, asin_clicks, asin_purchases, is_brand_term, period_from, period_to').eq('marketplace', 'UK').in('asin', c), 'keywords') : []
  const own = kw.filter(k => k.asin !== '*')
  const focus = keywordFocus(own, copy, f.own_keywords, f.keyword_choices)
  const outKeys = new Set(Object.entries(f.keyword_choices || {}).filter(([, v]) => v === 'out').map(([k]) => k))
  const nouns = new Set((`${f.name} ${copy.title || ''}`.toLowerCase().match(NOUNS) || []))
  const have = new Set(focus.map(k => k.search_query.toLowerCase()))
  const suggested = [
    ...focus.filter(k => k.where === 'Missing' && k.query_volume && k.choice === 'auto'),
    ...kw.filter(k => k.asin === '*' && !k.is_brand_term && !have.has(k.search_query.toLowerCase()) && [...nouns].some(n => k.search_query.toLowerCase().includes(n)))
      .map(k => ({ search_query: k.search_query, query_volume: k.query_volume, store_wide: true })),
  ].filter(k => !OTHER_BRAND.test(k.search_query) && !outKeys.has(keywordKey(k.search_query))).sort((a, b) => (b.query_volume || 0) - (a.query_volume || 0)).slice(0, 12)
  const img = leadFields.find(x => x.field === 'Images')
  const ap = leadFields.find(x => x.field === 'A+ content')
  const aplusLive = ap && ap.live && (!Array.isArray(ap.live) || ap.live.length) ? ap.live : null
  const probs = cleanup.filter(c => c.status === 'open')

  // images: the family master's sets once edited there; until then the lead master's MASTER set (else the live UK set)
  // and each colour's own set (the target's colours, else the UK children that are not packs)
  const fmIm = (fm && fm.images) || {}
  const edited = Object.keys(fmIm.master || {}).length || Object.keys(fmIm.colours || {}).length
  const masterSet = edited ? { ...(fmIm.master || {}) } : slotsOf((lead && lead.images && (lead.images.MASTER || lead.images.UK)) || (img && img.live) || [])
  const nameOf = new Map(((fm && fm.colours) || []).map(c => [c.asin, c.name]))
  const kidAsins = target && (target.children || []).length ? target.children : [...new Set(members.filter(m => m.marketplace === 'UK' && m.role === 'child' && !m.is_pack).map(m => m.asin))]
  const kidFields = kidAsins.length ? must(await db.from('listing_fields').select('asin, live').eq('marketplace', 'UK').eq('field', 'Images').in('asin', kidAsins), 'images') : []
  const colourSets = kidAsins.map(a => {
    const k = members.find(m => m.asin === a && m.marketplace === 'UK') || members.find(m => m.asin === a) || { asin: a }
    const mm = masters.find(m => m.asin === a)
    const own = edited ? { ...((fmIm.colours || {})[a] || {}) } : slotsOf((mm && mm.images && (mm.images.MASTER || mm.images.UK)) || (kidFields.find(x => x.asin === a) || {}).live || [])
    return { asin: a, colour: nameOf.get(a) || k.colour || k.sku || a, sku: k.sku, images: own }
  })
  const composed = composeImages(f.slot_map, masterSet, colourSets)
  const images = { slot_map: { ...DEFAULT_SLOT_MAP, ...(f.slot_map || {}) }, master: masterSet, colours: composed, sets: colourSets, edited: !!edited }
  const imagesMissing = composed.reduce((s, c) => s + c.slots.filter(x => x.missing).length, 0)
  const attributes = fm ? (fm.attributes || []) : ((lead && Array.isArray(lead.attributes)) ? lead.attributes.filter(a => a && a.name && a.keep !== false).map(a => ({ name: a.name, value: a.value })) : [])
  const scoreInputs = {
    images: composed.length ? Math.min(...composed.map(c => c.slots.filter(x => !x.missing).length)) : (Array.isArray(img && img.live) ? img.live.filter(x => x.slot !== 'SWCH').length : 0),
    aplusLive: !!aplusLive, familyOk: !probs.some(c => c.marketplace === 'UK' && c.fix_kind === 'relink'), attributesOk: attributes.length >= 5,
  }
  const seo = seoScore({ copy, keywords: focus, ...scoreInputs })
  const ukFields = {}
  for (const x of leadFields) if (COPY_FIELDS[x.field] && typeof x.live === 'string') ukFields[COPY_FIELDS[x.field]] = x.live
  const gaps = target ? gapMap({ target, master: { copy, colours: (fm && fm.colours) || [], attributes, images_missing: imagesMissing }, members, parents, products, ukFields, aplusLive: !!aplusLive }) : null

  const [aplus, ranks, reviews, evidence, rankHistory] = await Promise.all([
    db.from('listing_aplus').select('asin, status, brief, modules, house, updated_at').eq('asin', f.lead_asin).maybeSingle().then(r => must(r, 'A+')),
    inChunks(asins, (c) => db.from('listing_categories').select('marketplace, asin, node, title, sales_rank, read_on').in('asin', c), 'ranks'),
    inChunks(asins, (c) => db.from('listing_reviews_daily').select('*').in('asin', c).gte('date', new Date(Date.now() - 35 * 864e5).toISOString().slice(0, 10)).order('date', { ascending: false }), 'reviews'),
    inChunks(asins, (c) => db.from('listing_evidence').select('*').in('asin', c).order('taken_at', { ascending: false }).limit(200), 'evidence'),
    // rank per day (migration 47), same 35 days as the reviews
    inChunks(asins, (c) => db.from('listing_rank_daily').select('marketplace, asin, node, date, title, sales_rank').in('asin', c).gte('date', new Date(Date.now() - 35 * 864e5).toISOString().slice(0, 10)).order('date', { ascending: false }).order('node'), 'rank history'),
  ])
  const shots = await signShots(db, [...evidence.map(e => e.screenshot_key), ...reviews.map(r => r.screenshot_key)])
  for (const e of evidence) e.screenshot_url = shots[e.screenshot_key] || null
  for (const r of reviews) r.screenshot_url = shots[r.screenshot_key] || null
  const pmap = new Map(products.map(p => [`${p.asin}|${p.marketplace}`, p]))
  return {
    family: f,
    members: members.map(m => ({ ...m, product: (pmap.get(`${m.asin}|${m.marketplace}`) || {}).product || null, listing_status: (pmap.get(`${m.asin}|${m.marketplace}`) || {}).listing_status || null })),
    parents, cleanup,
    master: lead ? {
      asin: lead.asin, master_sku: lead.master_sku, status: lead.status, languages: Object.keys(lead.variants || {}),
      attributes: attrSummary(lead.attributes),
      translations: Object.entries(lead.variants || {}).map(([locale, v]) => ({ locale, status: (v && v.status) || 'draft', reviewed_by: (v && (v.reviewed_by || v.language_reviewed_by)) || null, copy: { title: v && v.copy && v.copy.title, bullet_1: v && v.copy && v.copy.bullet_1, search_terms: v && v.copy && v.copy.search_terms } })),
    } : null,
    copy, copy_source: source,
    family_master: fm ? { status: fm.status, approvals: fm.approvals || {}, colours: fm.colours || [], attributes, updated_by: fm.updated_by, updated_at: fm.updated_at } : null,
    target, gaps, score_inputs: scoreInputs, standard_colours: STANDARD_COLOURS, attributes,
    keywords: { focus: focus.filter(k => k.choice !== 'out').slice(0, 60), removed: focus.filter(k => k.choice === 'out'), suggested, period_from: own[0] && own[0].period_from, period_to: own[0] && own[0].period_to, basis: own.length ? 'family' : kw.length ? 'store' : 'none' },
    seo, images, aplus: { draft: aplus || null, live: aplusLive }, ranks, rank_history: rankHistory, reviews, evidence,
  }
}

// A short, readable list of the master's shared attributes (Amazon's JSON shape: name -> [{ value | ... }]).
const ATTR_SKIP = /item_name|bullet_point|product_description|generic_keyword|identifier|merchant|image|offer|fulfillment|list_price|purchasable|child_parent|parentage|variation_theme|gpsr|compliance|dsa_|skip_offer/
function attrValue(v) {
  if (v == null) return null
  if (typeof v !== 'object') return String(v)
  if (Array.isArray(v)) return v.map(attrValue).filter(Boolean).join(', ')
  if ('value' in v) return attrValue(v.value) + (v.unit ? ` ${String(v.unit).replace(/_/g, ' ')}` : '')
  const first = Object.values(v).map(attrValue).find(Boolean)
  return first || null
}
// Masters store attributes as [{ name, value, keep }]; older rows may hold Amazon's object shape.
function attrSummary(attrs) {
  if (!attrs || typeof attrs !== 'object') return []
  const pairs = Array.isArray(attrs) ? attrs.filter(a => a && a.name && a.keep !== false).map(a => [a.name, a.value]) : Object.entries(attrs)
  const nice = (v) => (v === 'true' ? 'Yes' : v === 'false' ? 'No' : v)
  return pairs.filter(([k]) => !ATTR_SKIP.test(k) && !/^(color|colour|batteries_required|externally_assigned)/.test(k))
    .map(([k, v]) => [k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()), nice(attrValue(v))])
    .filter(([, v]) => v && v.length <= 80).slice(0, 12)
}

/** Every child ASIN in the four review stores: best rank, stars, reviews, change on a week, status and alerts. */
const REVIEW_STORES = ['UK', 'DE', 'FR', 'US']
export async function listRankAll(db) {
  const since = new Date(Date.now() - 35 * 864e5).toISOString().slice(0, 10)
  const [members, fams, ranks, reviews] = await Promise.all([
    all(() => db.from('listing_family_members').select('family_code, asin, marketplace, sku, colour, role, is_pack').in('marketplace', REVIEW_STORES).neq('role', 'parent'), 'family members'),
    db.from('listing_families').select('family_code, name').then(r => must(r, 'families')),
    all(() => db.from('listing_categories').select('marketplace, asin, title, sales_rank, read_on').in('marketplace', REVIEW_STORES), 'ranks'),
    all(() => db.from('listing_reviews_daily').select('asin, marketplace, date, rating, reviews, status, screenshot_key').in('marketplace', REVIEW_STORES).gte('date', since).order('date', { ascending: false }), 'reviews'),
  ])
  const name = new Map(fams.map(f => [f.family_code, f.name]))
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)
  const rows = members.map(m => {
    const rv = reviews.filter(r => r.asin === m.asin && r.marketplace === m.marketplace)
    const ok = rv.filter(r => r.reviews != null)
    const now = rv[0] || null
    const prev = ok[1] || null
    const week = ok.find(r => r.date <= weekAgo) || null
    const best = ranks.filter(r => r.asin === m.asin && r.marketplace === m.marketplace && r.sales_rank).sort((a, b) => a.sales_rank - b.sales_rank)[0] || null
    return {
      family_code: m.family_code, family: name.get(m.family_code) || m.family_code, asin: m.asin, marketplace: m.marketplace, sku: m.sku, colour: m.colour, is_pack: m.is_pack,
      rank: best ? { sales_rank: best.sales_rank, title: best.title, read_on: best.read_on } : null,
      rating: ok[0] ? ok[0].rating : null, reviews: ok[0] ? ok[0].reviews : null, date: now ? now.date : null, status: now ? now.status : null,
      week_change: ok[0] && week ? ok[0].reviews - week.reviews : null,
      alerts: [
        ok[0] && prev && ok[0].reviews < prev.reviews ? `Reviews fell ${prev.reviews} → ${ok[0].reviews}` : null,
        ok[0] && week && ok[0].rating != null && week.rating != null && week.rating - ok[0].rating >= 0.1 ? `Stars fell ${week.rating} → ${ok[0].rating}` : null,
      ].filter(Boolean),
      screenshot_key: now ? now.screenshot_key : null,
    }
  })
  // A colour whose count differs from the rest of its family in the same store: the first sign of a split.
  for (const r of rows) {
    if (r.reviews == null || r.is_pack) continue
    const sibs = rows.filter(x => x.family_code === r.family_code && x.marketplace === r.marketplace && x !== r && x.reviews != null && !x.is_pack)
    if (sibs.length && sibs.every(x => x.reviews !== r.reviews) && sibs.some(x => x.reviews > r.reviews)) r.alerts.push('Fewer reviews than its family: split?')
  }
  const shots = await signShots(db, rows.map(r => r.screenshot_key))
  for (const r of rows) r.screenshot_url = shots[r.screenshot_key] || null
  rows.sort((a, b) => REVIEW_STORES.indexOf(a.marketplace) - REVIEW_STORES.indexOf(b.marketplace) || a.family.localeCompare(b.family) || String(a.colour || a.sku).localeCompare(String(b.colour || b.sku)))
  return { rows, stores: REVIEW_STORES, families: fams.filter(f => rows.some(r => r.family_code === f.family_code)), latest: reviews[0] ? reviews[0].date : null }
}

/** Every evidence snapshot, newest first, filtered; screenshots as short-lived links. */
export async function listEvidenceAll(db, { store, asin, reason, from, to } = {}) {
  let qy = db.from('listing_evidence').select('*').order('taken_at', { ascending: false }).limit(400)
  if (store) qy = qy.eq('marketplace', store)
  if (asin) qy = qy.eq('asin', String(asin).toUpperCase())
  if (reason) qy = qy.eq('reason', reason)
  if (from) qy = qy.gte('taken_at', from)
  if (to) qy = qy.lte('taken_at', `${to}T23:59:59Z`)
  const [rows, members, fams] = await Promise.all([
    qy.then(r => must(r, 'evidence')),
    all(() => db.from('listing_family_members').select('family_code, asin, marketplace, colour').neq('role', 'parent'), 'family members'),
    db.from('listing_families').select('family_code, name').then(r => must(r, 'families')),
  ])
  const name = new Map(fams.map(f => [f.family_code, f.name]))
  const mem = new Map(members.map(m => [`${m.asin}|${m.marketplace}`, m]))
  const shots = await signShots(db, rows.map(r => r.screenshot_key), 6 * 3600)
  return {
    rows: rows.map(r => { const m = mem.get(`${r.asin}|${r.marketplace}`); return { ...r, family: m ? name.get(m.family_code) || m.family_code : null, colour: m ? m.colour : null, screenshot_url: shots[r.screenshot_key] || null } }),
  }
}

const ACTORS = ['Jon', 'Laura']
/** Small edits from the family page. */
export async function familyOp(db, user, body = {}) {
  const op = String(body.op || '')
  if (op === 'sync') return syncFamilies(db, user.name)
  const code = String(body.family_code || '')
  const f = must(await db.from('listing_families').select('*').eq('family_code', code).maybeSingle(), 'family')
  if (!f) throw fail(404, `No family ${code}`)
  const at = new Date().toISOString()
  const save = async (patch) => { must(await db.from('listing_families').update({ ...patch, updated_at: at }).eq('family_code', code), 'family'); return { ok: true } }
  if (op === 'slot') {
    if (!SLOTS.includes(body.slot) || !['master', 'colour'].includes(body.from)) throw fail(400, 'slot must be MAIN or PT01–PT06 and from master or colour')
    return save({ slot_map: { ...(f.slot_map || {}), [body.slot]: body.from } })
  }
  if (op === 'keyword_bulk') {
    // Several searches at once (Jon, 23 Nov 2026: multi-select). items: [{ query, choice }], choice one of
    // focus | watch | out | auto, or add (becomes one of your own keywords) / remove (drops one of your own).
    const items = Array.isArray(body.items) ? body.items.slice(0, 300) : []
    if (!items.length) throw fail(400, 'Tick at least one keyword')
    if (items.some(it => ![...KEYWORD_CHOICES, 'auto', 'add', 'remove'].includes(it && it.choice))) throw fail(400, 'choice must be focus, watch, out, auto, add or remove')
    const { choices, own } = keywordBulk(f.keyword_choices, f.own_keywords, items)
    if (own.length > 50) throw fail(400, 'Up to 50 own keywords per family')
    return save({ keyword_choices: choices, own_keywords: own })
  }
  if (op === 'keyword_choice') {
    const q = String(body.query || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    if (!q) throw fail(400, 'Which keyword?')
    if (body.choice !== 'auto' && !KEYWORD_CHOICES.includes(body.choice)) throw fail(400, 'choice must be focus, watch, out or auto')
    const choices = { ...(f.keyword_choices || {}) }
    if (body.choice === 'auto') delete choices[keywordKey(q)]; else choices[keywordKey(q)] = body.choice
    const patch = { keyword_choices: choices }
    if (body.choice === 'out') patch.own_keywords = (f.own_keywords || []).filter(x => x.toLowerCase() !== q.toLowerCase())
    return save(patch)
  }
  if (op === 'keyword_add' || op === 'keyword_remove') {
    const q = String(body.query || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    if (!q) throw fail(400, 'Type a keyword')
    const list = (f.own_keywords || []).filter(x => x.toLowerCase() !== q.toLowerCase())
    if (op === 'keyword_add') { if (list.length >= 50) throw fail(400, 'Up to 50 own keywords per family'); list.push(q) }
    return save({ own_keywords: list })
  }
  if (['master_save', 'master_approve', 'image_set', 'target_pack'].includes(op)) return masterOp(db, user, code, body)
  if (op === 'write_seo') {
    // one draft from the weighted words; nothing saved
    const d = await getFamily(db, code)
    return writeSeoCopy({ name: f.name, copy: d.copy, attributes: (d.family_master && d.family_master.attributes) || [], colours: (d.family_master && d.family_master.colours) || [], keywords: d.keywords.focus, scoreInputs: d.score_inputs })
  }
  if (op === 'signoff' && (await loadMaster(db, code)).fm) return masterOp(db, user, code, { ...body, op: 'master_approve' })
  if (op === 'signoff') {
    const who = ACTORS.find(a => String(user.name || '').toLowerCase().startsWith(a.toLowerCase()))
    if (!who) throw fail(403, 'Only Jon and Laura sign off a family master')
    return save({ signoff: { ...(f.signoff || {}), [who]: body.undo ? null : at } })
  }
  if (op === 'cleanup') {
    const status = String(body.status || '')
    if (!['open', 'agreed', 'in_progress', 'fixed', 'wont_fix'].includes(status)) throw fail(400, 'status must be open, agreed, in_progress, fixed or wont_fix')
    must(await db.from('listing_cleanup').update({ status, note: body.note == null ? undefined : String(body.note).slice(0, 500), updated_at: at, updated_by: user.name }).eq('family_code', code).eq('marketplace', String(body.marketplace || '')).eq('problem_key', String(body.problem_key || '')), 'clean-up')
    return { ok: true }
  }
  throw fail(400, 'op must be sync, slot, keyword_add, keyword_remove, keyword_choice, keyword_bulk, master_save, master_approve, image_set, target_pack, write_seo, signoff or cleanup')
}

/** The clean-up list across every family. */
export async function listCleanup(db) {
  const [rows, fams] = await Promise.all([all(() => db.from('listing_cleanup').select('*').order('wave').order('family_code'), 'clean-up'), db.from('listing_families').select('family_code, name').then(r => must(r, 'families'))])
  const name = new Map(fams.map(f => [f.family_code, f.name]))
  return { items: rows.map(r => ({ ...r, family: name.get(r.family_code) || r.family_code })) }
}
export { covers }
