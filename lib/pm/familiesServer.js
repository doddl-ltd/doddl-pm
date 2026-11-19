// Server side of Amazon listings by family (migration 43): derive + store the families from the live listings, the
// overview, one family's page, and the small edits (slot map, own keywords, clean-up status, sign-off).
// Nothing here writes to Amazon.
import { approvalError as fail } from './approvals'
import { deriveFamilies, keywordFocus, seoScore, slotsOf, composeImages, covers, SLOTS, STORES, DEFAULT_SLOT_MAP } from './families'

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
    const { copy } = copyFrom(master, lf)
    const ukAsins = new Set(mine.filter(m => m.marketplace === 'UK').map(m => m.asin))
    const focus = keywordFocus(kw.filter(k => ukAsins.has(k.asin)), copy, f.own_keywords)
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
    inChunks(asins, (c) => db.from('listing_masters').select('asin, master_sku, product, status, copy, images, variants').in('asin', c), 'masters'),
  ])
  const lead = masters.find(m => m.asin === f.lead_asin) || null
  const leadFields = must(await db.from('listing_fields').select('field, live, status').eq('asin', f.lead_asin).eq('marketplace', 'UK'), 'listing fields')
  const { copy, source } = copyFrom(lead, leadFields)
  const ukAsins = members.filter(m => m.marketplace === 'UK' && m.role !== 'parent').map(m => m.asin)
  const kw = ukAsins.length ? await inChunks([...ukAsins, '*'], (c) => db.from('listing_keywords').select('asin, search_query, query_volume, asin_impressions, asin_clicks, asin_purchases, is_brand_term, period_from, period_to').eq('marketplace', 'UK').in('asin', c), 'keywords') : []
  const own = kw.filter(k => k.asin !== '*')
  const focus = keywordFocus(own, copy, f.own_keywords)
  const nouns = new Set((`${f.name} ${copy.title || ''}`.toLowerCase().match(NOUNS) || []))
  const have = new Set(focus.map(k => k.search_query.toLowerCase()))
  const suggested = [
    ...focus.filter(k => k.where === 'Missing' && k.query_volume),
    ...kw.filter(k => k.asin === '*' && !k.is_brand_term && !have.has(k.search_query.toLowerCase()) && [...nouns].some(n => k.search_query.toLowerCase().includes(n)))
      .map(k => ({ search_query: k.search_query, query_volume: k.query_volume, store_wide: true })),
  ].sort((a, b) => (b.query_volume || 0) - (a.query_volume || 0)).slice(0, 12)
  const img = leadFields.find(x => x.field === 'Images')
  const ap = leadFields.find(x => x.field === 'A+ content')
  const aplusLive = ap && ap.live && (!Array.isArray(ap.live) || ap.live.length) ? ap.live : null
  const probs = cleanup.filter(c => c.status === 'open')
  const seo = seoScore({ copy, keywords: focus, images: Array.isArray(img && img.live) ? img.live.filter(x => x.slot !== 'SWCH').length : 0, aplusLive: !!aplusLive, familyOk: !probs.some(c => c.marketplace === 'UK' && c.fix_kind === 'relink') })

  // images: the master set (lead master's MASTER set, else the live UK set) and each UK colour's own set
  const masterSet = slotsOf((lead && lead.images && (lead.images.MASTER || lead.images.UK)) || (img && img.live) || [])
  const ukKids = members.filter(m => m.marketplace === 'UK' && m.role === 'child' && !m.is_pack)
  const kidFields = ukKids.length ? must(await db.from('listing_fields').select('asin, live').eq('marketplace', 'UK').eq('field', 'Images').in('asin', ukKids.map(k => k.asin)), 'images') : []
  const colourSets = ukKids.map(k => {
    const mm = masters.find(m => m.asin === k.asin)
    const own = slotsOf((mm && mm.images && (mm.images.MASTER || mm.images.UK)) || (kidFields.find(x => x.asin === k.asin) || {}).live || [])
    return { asin: k.asin, colour: k.colour || k.sku, sku: k.sku, images: own }
  })
  const images = { slot_map: { ...DEFAULT_SLOT_MAP, ...(f.slot_map || {}) }, master: masterSet, colours: composeImages(f.slot_map, masterSet, colourSets), sets: colourSets }

  const [aplus, ranks, reviews, evidence] = await Promise.all([
    db.from('listing_aplus').select('asin, status, brief, modules, house, updated_at').eq('asin', f.lead_asin).maybeSingle().then(r => must(r, 'A+')),
    inChunks(asins, (c) => db.from('listing_categories').select('marketplace, asin, node, title, sales_rank, read_on').in('asin', c), 'ranks'),
    inChunks(asins, (c) => db.from('listing_reviews_daily').select('*').in('asin', c).gte('date', new Date(Date.now() - 35 * 864e5).toISOString().slice(0, 10)).order('date', { ascending: false }), 'reviews'),
    inChunks(asins, (c) => db.from('listing_evidence').select('*').in('asin', c).order('taken_at', { ascending: false }).limit(200), 'evidence'),
  ])
  const pmap = new Map(products.map(p => [`${p.asin}|${p.marketplace}`, p]))
  return {
    family: f,
    members: members.map(m => ({ ...m, product: (pmap.get(`${m.asin}|${m.marketplace}`) || {}).product || null, listing_status: (pmap.get(`${m.asin}|${m.marketplace}`) || {}).listing_status || null })),
    parents, cleanup,
    master: lead ? { asin: lead.asin, master_sku: lead.master_sku, status: lead.status, languages: Object.keys(lead.variants || {}) } : null,
    copy, copy_source: source,
    keywords: { focus: focus.slice(0, 40), suggested, period_from: own[0] && own[0].period_from, period_to: own[0] && own[0].period_to, basis: own.length ? 'family' : kw.length ? 'store' : 'none' },
    seo, images, aplus: { draft: aplus || null, live: aplusLive }, ranks, reviews, evidence,
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
  if (op === 'keyword_add' || op === 'keyword_remove') {
    const q = String(body.query || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    if (!q) throw fail(400, 'Type a keyword')
    const list = (f.own_keywords || []).filter(x => x.toLowerCase() !== q.toLowerCase())
    if (op === 'keyword_add') { if (list.length >= 50) throw fail(400, 'Up to 50 own keywords per family'); list.push(q) }
    return save({ own_keywords: list })
  }
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
  throw fail(400, 'op must be sync, slot, keyword_add, keyword_remove, signoff or cleanup')
}

/** The clean-up list across every family. */
export async function listCleanup(db) {
  const [rows, fams] = await Promise.all([all(() => db.from('listing_cleanup').select('*').order('wave').order('family_code'), 'clean-up'), db.from('listing_families').select('family_code, name').then(r => must(r, 'families'))])
  const name = new Map(fams.map(f => [f.family_code, f.name]))
  return { items: rows.map(r => ({ ...r, family: name.get(r.family_code) || r.family_code })) }
}
export { covers }
