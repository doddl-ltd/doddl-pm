// Amazon listings by family (migration 43). Jon 2026-11-19: one family per product, the parent in each store mapped to
// one doddlHQ family code (each store keeps its own parent SKU and ASIN; map only), a clean-up list across stores, an
// SEO score per family, images composed per colour from the master set + the colour's own set, rank + reviews daily.
// The pure parts (deriveFamilies, seoScore, composeImages, keywordFocus) run in the browser and in tests too.

export const STORES = ['UK', 'US', 'CA', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'IE', 'PL', 'SE']
export const SLOTS = ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06']
// Which slots show the product's colour by default (the canvas): MAIN and the lifestyle shot; the rest are the same
// picture on every colour.
export const DEFAULT_SLOT_MAP = { MAIN: 'colour', PT01: 'master', PT02: 'master', PT03: 'colour', PT04: 'master', PT05: 'master', PT06: 'master' }
// The colour names doddl uses. A child's colour that is not one of these (typo, pack wording, blank) is a clean-up item.
export const STANDARD_COLOURS = ['Dusky Rose', 'Fresh Green', 'Aqua', 'Indigo', 'Magenta']

// Product families by doddl product code (the DOD number in the seller SKU). A family's code is doddlHQ-only.
export const FAMILY_BY_DOD = {
  DOD001: ['P-3PC-CUTLERY', '3-piece Toddler Cutlery'], DOD002: ['P-3PC-CUTLERY', '3-piece Toddler Cutlery'],
  DOD003: ['P-3PC-CUTLERY', '3-piece Toddler Cutlery'], DOD050: ['P-3PC-CUTLERY', '3-piece Toddler Cutlery'],
  DOD004: ['P-2PC-CUTLERY', '2-piece Toddler Cutlery'], DOD005: ['P-2PC-CUTLERY', '2-piece Toddler Cutlery'],
  DOD006: ['P-2PC-CUTLERY', '2-piece Toddler Cutlery'], DOD051: ['P-2PC-CUTLERY', '2-piece Toddler Cutlery'],
  DOD008: ['P-BABY-CUTLERY', 'Baby Cutlery'], DOD052: ['P-BABY-CUTLERY', 'Baby Cutlery'],
  DOD007: ['P-KNIFE', 'Toddler Knife'], DOD009: ['P-TRAVEL-CASE', 'Cutlery Travel Case'],
  DOD010: ['P-TODDLER-PLATE', 'Toddler Plate'], DOD011: ['P-2IN1-BOWL', '2-in-1 Bowl'], DOD054: ['P-2IN1-BOWL', '2-in-1 Bowl'],
  DOD015: ['P-MINI-CHEF-KIT', 'Mini Chef Kit'], DOD017: ['P-2IN1-PLATE', '2-in-1 Suction Plate'], DOD053: ['P-2IN1-PLATE', '2-in-1 Suction Plate'],
  DOD041: ['P-MEALTIME-KIT', 'Mealtime Kit'], DOD042: ['P-MEALTIME-KIT', 'Mealtime Kit'],
}
// Families made only of bundles: named from the parent's title.
const BY_TITLE = [
  [/confident eater/i, 'P-CONFIDENT-EATER', 'Confident Eater Set'],
  [/bowl\s*&\s*plate bundle|plate\s*&\s*bowl/i, 'P-PLATE-BOWL-BUNDLE', 'Plate & Bowl Bundle'],
  [/12\s*[-–]\s*24 months/i, 'P-CUTLERY-BOWL-BUNDLE', 'Cutlery + Bowl Bundle (12–24m)'],
]

const dodOf = (s) => { const m = String(s || '').toUpperCase().match(/DOD\d{3}/); return m ? m[0] : null }
// A pack or bundle: DOD + more than 3 digits (DOD001010), xN, or a 2-pack SKU.
export const isPack = (sku) => /DOD\d{4,}|x\d\b|_\d_PK|twin pack/i.test(String(sku || ''))
const isParentRow = (p) => !p.parent_asin && p.variations && Array.isArray(p.variations.child_asins) && p.variations.child_asins.length > 0 && /parent/i.test(`${p.listing_status || ''} ${p.product || ''}`)
const cleanName = (t) => String(t || '').replace(/^Parent\s*·\s*/i, '').replace(/^DOD\d+\s*·\s*/i, '').trim()
const firstSku = (s) => String(s || '').split(',')[0].trim()

/**
 * Families from the live listings (listing_products rows across every store). Pure.
 * Children in the same parent anywhere, and the same ASIN in different stores, end up in one family.
 * Returns { families, members, parents, cleanup }.
 */
export function deriveFamilies(products = []) {
  const rows = products.filter(p => p && p.asin && p.marketplace)
  // union-find over ASINs
  const up = new Map()
  const find = (a) => { if (!up.has(a)) up.set(a, a); let r = a; while (up.get(r) !== r) r = up.get(r); up.set(a, r); return r }
  const join = (a, b) => { const x = find(a), y = find(b); if (x !== y) up.set(x < y ? y : x, x < y ? x : y) }
  for (const p of rows) {
    find(p.asin)
    if (p.parent_asin) join(p.asin, p.parent_asin)
    if (isParentRow(p)) for (const c of p.variations.child_asins) {
      // a child listed under this parent only counts if that child names this parent too (stale lists otherwise)
      const child = rows.find(r => r.asin === c && r.marketplace === p.marketplace)
      if (!child || child.parent_asin === p.asin) join(p.asin, c)
    }
  }
  const groups = new Map()
  for (const p of rows) { const r = find(p.asin); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p) }
  // A parent whose colours all moved away (they name another parent now) still belongs to their family: an empty
  // parent to clear up, not a family of its own.
  for (const [r, list] of [...groups]) {
    if (list.some(p => !isParentRow(p))) continue
    const kids = list.flatMap(p => p.variations.child_asins)
    const home = kids.map(a => find(a)).find(x => x !== r && groups.has(x))
    if (home) { groups.get(home).push(...list); groups.delete(r) }
  }
  // The same product sold on its own (no parent, a different ASIN) belongs to its product's family too: groups whose
  // single items are the same doddl product family are one family.
  const famOf = (list) => {
    const v = new Map()
    for (const p of list) if (!isParentRow(p) && !isPack(p.sku)) { const f = FAMILY_BY_DOD[dodOf(firstSku(p.sku)) || dodOf(p.product)]; if (f) v.set(f[0], (v.get(f[0]) || 0) + 1) }
    return [...v].sort((a, b) => b[1] - a[1])[0]?.[0] || null
  }
  const byCode = new Map()
  for (const [r, list] of [...groups]) {
    const c = famOf(list)
    if (!c) continue
    if (byCode.has(c)) { groups.get(byCode.get(c)).push(...list); groups.delete(r) } else byCode.set(c, r)
  }

  const families = [], members = [], parents = [], cleanup = []
  const used = new Set()
  for (const list of groups.values()) {
    const sold = list.filter(p => !isParentRow(p))
    const parentRows = list.filter(isParentRow)
    // name: the most common family of the single items, else the parent title, else the first product
    const votes = new Map()
    for (const p of sold) if (!isPack(p.sku)) { const f = FAMILY_BY_DOD[dodOf(firstSku(p.sku)) || dodOf(p.product)]; if (f) votes.set(f[0], [f, (votes.get(f[0]) || [f, 0])[1] + 1]) }
    let code, name
    const best = [...votes.values()].sort((a, b) => b[1] - a[1])[0]
    if (best) [code, name] = best[0]
    else {
      const title = (parentRows[0] && parentRows[0].product) || (sold[0] && sold[0].product) || ''
      const hit = BY_TITLE.find(([re]) => re.test(title))
      if (hit) [, code, name] = hit
      else {
        const f = FAMILY_BY_DOD[dodOf(firstSku(sold[0] && sold[0].sku)) || dodOf(title)]
        if (f && !sold.some(p => !isPack(p.sku))) { code = `${f[0]}-PACKS`; name = `${f[1]} packs` }
        else { name = cleanName(title).split(/\s[|–-]\s|[|,]/)[0].trim().slice(0, 40) || list[0].asin; code = 'P-' + name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) }
      }
    }
    let c = code, n = 2
    while (used.has(c)) c = `${code}-${n++}`
    used.add(c)
    code = c
    const uk = sold.filter(p => p.marketplace === 'UK' && !isPack(p.sku))
    const lead = (uk[0] || sold.find(p => !isPack(p.sku)) || sold[0] || list[0]).asin
    const theme = (parentRows.find(p => p.variations && p.variations.theme) || {}).variations?.theme || null
    families.push({ family_code: code, name, theme, lead_asin: lead })

    for (const p of sold) members.push({ family_code: code, asin: p.asin, marketplace: p.marketplace, role: p.parent_asin ? 'child' : 'standalone', sku: firstSku(p.sku) || null, colour: p.colour || null, parent_asin: p.parent_asin || null, is_pack: isPack(p.sku) })
    for (const p of parentRows) {
      const kids = sold.filter(s => s.marketplace === p.marketplace && s.parent_asin === p.asin)
      members.push({ family_code: code, asin: p.asin, marketplace: p.marketplace, role: 'parent', sku: firstSku(p.sku) || null, colour: null, parent_asin: null, is_pack: false })
      parents.push({ family_code: code, marketplace: p.marketplace, parent_asin: p.asin, parent_sku: firstSku(p.sku) || null, children: kids.length, status: 'mapped' })
    }
    cleanup.push(...familyProblems(code, list.filter(p => !isParentRow(p)), parents.filter(x => x.family_code === code)))
  }
  // a family's status per store: rebuild where the clean-up says relink
  for (const pr of parents) if (cleanup.some(c => c.family_code === pr.family_code && c.marketplace === pr.marketplace && c.fix_kind === 'relink')) pr.status = 'rebuild'
  families.sort((a, b) => a.name.localeCompare(b.name))
  return { families, members, parents, cleanup }
}

const ENGLISH = ['UK', 'US', 'CA', 'IE']
/** The clean-up items for one family: one per store per problem. Pure. */
export function familyProblems(code, sold, parents) {
  const out = []
  const add = (marketplace, problem_key, problem, fix_kind, fix, wave, decision_needed = null) => out.push({ family_code: code, marketplace, problem_key, problem, fix_kind, fix, wave, decision_needed })
  const stores = [...new Set([...sold.map(p => p.marketplace), ...parents.map(p => p.marketplace)])]
  for (const m of stores) {
    const here = sold.filter(p => p.marketplace === m)
    const ps = parents.filter(p => p.marketplace === m)
    const live = ps.filter(p => p.children > 0)
    const empty = ps.filter(p => p.children === 0)
    if (live.length > 1) add(m, 'split', `Colours split under ${live.length} parents (${live.map(p => p.parent_sku || p.parent_asin).join(', ')})`, 'relink', 'Move every colour under one parent', 3, 'Which parent to keep')
    if (empty.length) add(m, 'empty_parent', `Parent with no colours left (${empty.map(p => p.parent_sku || p.parent_asin).join(', ')})`, 'in_place', 'Delete the empty parent in Seller Central', 1)
    if (live.length === 1 && live[0].children === 1) add(m, 'one_child', 'Parent with only one colour', 'relink', 'Join a family or stand alone', 3, 'One-child parents')
    const outside = here.filter(p => !p.parent_asin && !isPack(p.sku))
    if (live.length && outside.length) add(m, 'outside', `${outside.length} sold outside the family (${outside.map(p => firstSku(p.sku)).join(', ')})`, 'join', 'Join the existing parent', 2)
    if (!live.length && here.filter(p => !isPack(p.sku)).length >= 2) add(m, 'no_family', `No family here: ${here.length} single listings`, 'join', 'New parent in this store, colours join', 4)
    const kids = here.filter(p => p.parent_asin)
    if (kids.some(p => isPack(p.sku)) && kids.some(p => !isPack(p.sku))) add(m, 'packs', 'Single items and packs in one family', 'relink', 'Packs to their own family, or a colour + size theme', 3, 'Twin packs')
    if (ENGLISH.includes(m)) {
      const odd = kids.filter(p => !p.colour || !STANDARD_COLOURS.includes(String(p.colour).trim()))
      if (odd.length) add(m, 'colour_names', `Colour names to check: ${odd.map(p => `${firstSku(p.sku)} ${p.colour ? `"${p.colour}"` : '(none read)'}`).join(', ')}`, 'in_place', 'Set each colour from the standard list', 1, odd.some(p => /aqua|green|lime/i.test(p.colour || '')) ? 'Fresh Green or Aqua' : null)
      const names = kids.map(p => String(p.colour || '').trim().toLowerCase()).filter(Boolean)
      if (new Set(names).size < names.length) add(m, 'same_colour', 'Two or more colours share one colour name', 'in_place', 'Give each child its real colour', 1)
    }
  }
  return out
}

// ─── keyword focus + SEO score ────────────────────────────────────────────────────────────────────────────────────
const RANK = { focus: 0, auto: 1, watch: 2, out: 3 }
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9äöüßéèàçñ ]+/g, ' ').replace(/\s+/g, ' ').trim()
// Every word of the search appears in the text (in any order), so "suction plate toddler" matches a title with all three.
export const covers = (text, search) => { const t = ` ${norm(text)} `; const w = norm(search).split(' ').filter(x => x.length > 1); return w.length > 0 && w.every(x => t.includes(` ${x} `) || t.includes(` ${x}s `)) }

/** Brand Analytics rows for every ASIN in the family, merged per search (volume is the search's; doddl's numbers summed). Pure. */
/** Jon's choice per search (listing_families.keyword_choices, migration 45): focus = scored + written for, watch = shown
 * only, out = not relevant (hidden, never scored, never offered to the copy writer). No choice = auto (top 20 by volume). */
export const KEYWORD_CHOICES = ['focus', 'watch', 'out']
export const keywordKey = (s) => norm(s)

/** Apply several keyword choices at once. choice: focus | watch | out | auto, or add / remove (own keywords). Pure. */
export function keywordBulk(choicesIn = {}, ownIn = [], items = []) {
  const choices = { ...(choicesIn || {}) }
  let own = [...(ownIn || [])]
  const same = (a, b) => a.toLowerCase() === b.toLowerCase()
  for (const it of items) {
    const q = String((it && it.query) || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    const c = it && it.choice
    if (!q) continue
    const key = norm(q)
    if (c === 'add') { if (!own.some(x => same(x, q))) own.push(q); if (choices[key] === 'out') delete choices[key] }
    else if (c === 'remove') own = own.filter(x => !same(x, q))
    else if (c === 'auto') delete choices[key]
    else if (KEYWORD_CHOICES.includes(c)) { choices[key] = c; if (c === 'out') own = own.filter(x => !same(x, q)) }
  }
  return { choices, own }
}
export function keywordFocus(rows = [], copy = {}, own = [], choices = {}) {
  const by = new Map()
  for (const r of rows) {
    if (!r || r.is_brand_term) continue
    const k = norm(r.search_query)
    if (!k) continue
    const x = by.get(k) || { search_query: r.search_query, query_volume: 0, impressions: 0, clicks: 0, purchases: 0, own: false }
    x.query_volume = Math.max(x.query_volume, r.query_volume || 0)
    x.impressions += r.asin_impressions || 0; x.clicks += r.asin_clicks || 0; x.purchases += r.asin_purchases || 0
    by.set(k, x)
  }
  for (const o of own || []) { const k = norm(o); if (k && !by.has(k)) by.set(k, { search_query: o, query_volume: null, impressions: 0, clicks: 0, purchases: 0, own: true }); else if (k) by.get(k).own = true }
  const bullets = [copy.bullet_1, copy.bullet_2, copy.bullet_3, copy.bullet_4, copy.bullet_5, copy.description].filter(Boolean).join(' ')
  return [...by.values()].map(x => ({
    ...x,
    where: covers(copy.title, x.search_query) ? 'Title' : covers(bullets, x.search_query) ? 'Bullets' : covers(copy.search_terms, x.search_query) ? 'Terms' : 'Missing',
    conversion: x.clicks ? x.purchases / x.clicks : null,
    choice: (choices || {})[norm(x.search_query)] || (x.own ? 'focus' : 'auto'),
  })).sort((a, b) => RANK[a.choice] - RANK[b.choice] || (b.query_volume || 0) - (a.query_volume || 0) || (b.own ? 1 : 0) - (a.own ? 1 : 0))
}

/**
 * The 100-point SEO score agreed with Jon (2026-11-19). Pure.
 *   Keywords 55: the top 20 searches by volume, weighted by volume: in the title 30, in bullets/description 15, in the
 *   search terms 10. Completeness 35: space used 10, images 15 (7 slots, none rejected), A+ live 5, family + attributes 5.
 *   Penalties come off (title over 200, search terms over 249 bytes, brand words in search terms).
 */
export function seoScore({ copy = {}, keywords = [], images = 0, imageErrors = 0, aplusLive = false, familyOk = true, attributesOk = true } = {}) {
  // Searches Jon put in focus are the scored set; otherwise the top 20 by volume. Watch and not-relevant never count.
  const live = keywords.filter(k => k.choice !== 'out' && k.choice !== 'watch')
  const chosen = live.filter(k => k.choice === 'focus')
  const vols = live.map(k => k.query_volume || 0).filter(v => v > 0)
  const floor = vols.length ? Math.min(...vols) : 1
  const top = (chosen.length ? chosen : live.filter(k => (k.query_volume || 0) > 0 && !k.own))
    .map(k => ({ ...k, query_volume: k.query_volume || floor })).sort((a, b) => b.query_volume - a.query_volume).slice(0, 20)
  const total = top.reduce((s, k) => s + k.query_volume, 0)
  const bullets = [copy.bullet_1, copy.bullet_2, copy.bullet_3, copy.bullet_4, copy.bullet_5, copy.description].filter(Boolean).join(' ')
  const share = (text) => (total ? top.filter(k => covers(text, k.search_query)).reduce((s, k) => s + k.query_volume, 0) / total : 0)
  const parts = {}
  parts.title = Math.round(30 * share(copy.title))
  parts.bullets = Math.round(15 * share(bullets))
  parts.terms = Math.round(10 * share(`${copy.title || ''} ${bullets} ${copy.search_terms || ''}`))
  const len = (s) => String(s || '').length
  const bytes = (s) => (typeof Buffer !== 'undefined' ? Buffer.byteLength(String(s || '')) : new TextEncoder().encode(String(s || '')).length)
  const space = Math.min(1, len(copy.title) / 180) * 3 + Math.min(1, [1, 2, 3, 4, 5].filter(i => len(copy[`bullet_${i}`]) >= 150).length / 5) * 3 + Math.min(1, len(copy.description) / 1000) * 2 + Math.min(1, bytes(copy.search_terms) / 200) * 2
  parts.space = Math.round(space)
  parts.images = Math.max(0, Math.round(15 * Math.min(images, 7) / 7) - 2 * imageErrors)
  parts.aplus = aplusLive ? 5 : 0
  parts.family = (familyOk ? 3 : 0) + (attributesOk ? 2 : 0)
  const penalties = []
  if (len(copy.title) > 200) penalties.push(['Title over 200 characters', 5])
  if (bytes(copy.search_terms) > 249) penalties.push(['Search terms over 249 bytes (Amazon ignores them all)', 10])
  if (/doddl/i.test(copy.search_terms || '')) penalties.push(['Brand name in search terms', 2])
  const minus = penalties.reduce((s, p) => s + p[1], 0)
  // the parts add up to 90 (keywords 55 + completeness 35); shown out of 100
  const score = Math.max(0, Math.min(100, Math.round(Object.values(parts).reduce((s, v) => s + v, 0) * 100 / 90) - minus))
  return { score, parts, penalties, basis: top.length ? `top ${top.length} searches` : 'no Brand Analytics searches yet' }
}

// ─── images: master + colour sets composed per colour ─────────────────────────────────────────────────────────────
/**
 * What each colour shows on Amazon (7 slots), built from the family's slot map, the master set and each colour's own
 * set. A missing colour picture never borrows another colour's. Pure.
 *   master: { PT01: url, ... }  colours: [{ asin, colour, images: { MAIN: url, PT03: url } }]
 */
export function composeImages(slotMap = {}, master = {}, colours = []) {
  const map = { ...DEFAULT_SLOT_MAP, ...(slotMap || {}) }
  return colours.map(c => ({
    asin: c.asin, colour: c.colour,
    slots: SLOTS.map(slot => {
      const from = map[slot] === 'colour' ? 'colour' : 'master'
      const url = from === 'colour' ? (c.images || {})[slot] || null : master[slot] || null
      return { slot, from, url, missing: !url }
    }),
  }))
}
/** A slot → url map from an images list ([{slot,url}] or [url,...] in slot order). Pure. */
export function slotsOf(list) {
  const out = {}
  ;(Array.isArray(list) ? list : []).forEach((x, i) => {
    const url = typeof x === 'string' ? x : x && x.url
    const slot = (x && x.slot) || (i === 0 ? 'MAIN' : `PT${String(i).padStart(2, '0')}`)
    if (url && SLOTS.includes(slot) && !out[slot]) out[slot] = url
  })
  return out
}
