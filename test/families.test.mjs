import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveFamilies, seoScore, composeImages, keywordFocus, slotsOf, isPack, covers, keywordKey, keywordBulk, wordsOf, stemWord, wordWeights, gapMap } from '../lib/pm/families.js'
import { buildSeoRequest, seoDraftProblems, cleanCopy } from '../lib/pm/familyMaster.js'

test('Write SEO copy request: weighted words + lead phrase + rules; draft checks', () => {
  const req = buildSeoRequest({ name: '2-in-1 Bowl', copy: { title: 'x' }, attributes: [{ name: 'material', value: 'silicone' }], colours: [{ name: 'Fresh Green' }], keywords: [{ search_query: 'baby suction bowl', query_volume: 900 }, { search_query: 'toddler bowl', query_volume: 100 }] })
  assert.equal(req.model, 'claude-haiku-5-5')
  const u = req.messages[0].content
  assert.match(u, /LEAD PHRASE: baby suction bowl/); assert.match(u, /bowl \| 1000 \| 2/); assert.match(u, /material: silicone/)
  assert.match(req.system, /leftover|NOT already in the title/)
  const p = seoDraftProblems({ title: 'Bowl ' + 'x'.repeat(200), search_terms: 'doddl bowl', bullet_1: 'munchkin style' })
  assert.match(p.title, /over 200/); assert.match(p.search_terms, /Brand/); assert.match(p.notes, /Another brand/)
  assert.deepEqual(Object.keys(cleanCopy({ title: 'a', evil: 'x' })), ['title'])
})
import { applyChoices } from '../lib/pm/keywords.js'

test('keyword choices: out is hidden from scoring, focus becomes the scored set, watch never counts', () => {
  const rows = [
    { search_query: 'suction plate', query_volume: 1000, asin_impressions: 10 },
    { search_query: 'dinosaur plate', query_volume: 5000, asin_impressions: 1 },
    { search_query: 'toddler plate', query_volume: 800, asin_impressions: 5 },
    { search_query: 'plate with lid', query_volume: 300 },
  ]
  const copy = { title: 'doddl suction plate for toddler' }
  const auto = seoScore({ copy, keywords: keywordFocus(rows, copy) })
  const choices = { [keywordKey('dinosaur plate')]: 'out', [keywordKey('plate with lid')]: 'watch' }
  const chosen = keywordFocus(rows, copy, [], choices)
  assert.equal(chosen.find(k => k.search_query === 'dinosaur plate').choice, 'out')
  const cleaned = seoScore({ copy, keywords: chosen })
  assert.ok(cleaned.parts.title > auto.parts.title, 'dropping an irrelevant big search raises the title score')
  const focusOnly = keywordFocus(rows, copy, [], { ...choices, [keywordKey('suction plate')]: 'focus' })
  assert.equal(focusOnly[0].search_query, 'suction plate')
  assert.equal(seoScore({ copy, keywords: focusOnly }).parts.title, 30)
})

test('bulk keyword choices: many at once, suggestions become own keywords, reset restores', () => {
  const start = { [keywordKey('moonkie plate')]: 'out' }
  const { choices, own } = keywordBulk(start, ['weaning plate'], [
    { query: 'munchkin plate', choice: 'out' }, { query: 'bamboo bamboo suction plate', choice: 'out' },
    { query: 'baby plate', choice: 'focus' }, { query: 'toddler plates', choice: 'add' },
    { query: 'moonkie plate', choice: 'auto' }, { query: 'weaning plate', choice: 'remove' },
  ])
  assert.equal(choices[keywordKey('munchkin plate')], 'out')
  assert.equal(choices[keywordKey('bamboo bamboo suction plate')], 'out')
  assert.equal(choices[keywordKey('baby plate')], 'focus')
  assert.equal(choices[keywordKey('moonkie plate')], undefined)
  assert.deepEqual(own, ['toddler plates'])
})

test('copy writer list drops out and watch, leads with focus and own keywords', () => {
  const list = [{ search_query: 'dinosaur plate', query_volume: 5000 }, { search_query: 'suction plate', query_volume: 1000 }, { search_query: 'toddler plate', query_volume: 800 }]
  const out = applyChoices(list, { [keywordKey('dinosaur plate')]: 'out', [keywordKey('toddler plate')]: 'focus' }, ['weaning plate with suction'])
  assert.deepEqual(out.map(r => r.search_query), ['toddler plate', 'weaning plate with suction', 'suction plate'])
})

const parent = (asin, marketplace, sku, kids, title = 'Parent · 2-in-1 Suction Plate') => ({ asin, marketplace, sku, product: title, parent_asin: null, listing_status: 'Variation parent (not sold itself)', variations: { theme: 'COLOR', child_asins: kids, parent_asins: [] } })
const child = (asin, marketplace, sku, parent_asin, colour) => ({ asin, marketplace, sku, product: `${sku} · Thing`, parent_asin, colour, listing_status: 'Buyable', variations: null })

test('one family across stores, each store keeps its own parent (map only)', () => {
  const d = deriveFamilies([
    parent('PUK0000001', 'UK', '2in1plate', ['C000000001', 'C000000002']),
    child('C000000001', 'UK', 'DOD053', 'PUK0000001', 'Dusky Rose'), child('C000000002', 'UK', 'DOD017', 'PUK0000001', 'Fresh Green'),
    parent('PUS0000001', 'US', '2in1platemaster', ['C000000001', 'C000000002']),
    child('C000000001', 'US', 'DOD053', 'PUS0000001', 'Dusky Rose'), child('C000000002', 'US', 'DOD017', 'PUS0000001', 'Fresh Green'),
  ])
  assert.equal(d.families.length, 1)
  assert.equal(d.families[0].family_code, 'P-2IN1-PLATE')
  assert.deepEqual(d.parents.map(p => [p.marketplace, p.parent_sku, p.children]).sort(), [['UK', '2in1plate', 2], ['US', '2in1platemaster', 2]])
  assert.equal(d.cleanup.length, 0)
})

test('an emptied parent joins its old family as a clean-up item, not a family of its own', () => {
  const d = deriveFamilies([
    parent('PUK0000001', 'UK', '2in1plate', ['C000000001', 'C000000002']),
    parent('PUK0000002', 'UK', 'B0H7C1VDSM', ['C000000001']),
    child('C000000001', 'UK', 'DOD053', 'PUK0000001', 'Dusky Rose'), child('C000000002', 'UK', 'DOD017', 'PUK0000001', 'Fresh Green'),
  ])
  assert.equal(d.families.length, 1)
  assert.ok(d.cleanup.some(c => c.problem_key === 'empty_parent' && c.fix_kind === 'in_place'))
})

test('split, outside, packs, one child and colour names are found', () => {
  const d = deriveFamilies([
    parent('PA00000001', 'UK', 'BOWL PARENT', ['B000000001', 'B000000002'], 'Parent · Bowl'),
    child('B000000001', 'UK', 'DOD011', 'PA00000001', 'Fresh Green'), child('B000000002', 'UK', 'DOD011x2', 'PA00000001', 'Fresh Gree - Twin Pack'),
    child('B000000003', 'UK', 'DOD054', null, 'Dusky Rose'),
    parent('PB00000001', 'US', 'X', ['B000000001'], 'Parent · Bowl'), child('B000000001', 'US', 'DOD011', 'PB00000001', 'Magento'),
  ])
  const keys = d.cleanup.map(c => `${c.marketplace}:${c.problem_key}`).sort()
  assert.deepEqual(keys, ['UK:colour_names', 'UK:outside', 'UK:packs', 'US:colour_names', 'US:one_child'])
  assert.equal(d.families[0].family_code, 'P-2IN1-BOWL')
  assert.equal(d.parents.find(p => p.marketplace === 'UK').status, 'rebuild')
})

test('packs and keyword coverage helpers', () => {
  assert.ok(isPack('DOD011x2')); assert.ok(isPack('DOD001010')); assert.ok(isPack('VMP_DOD004_EU_2_PK')); assert.ok(!isPack('DOD011'))
  assert.ok(covers('Strong Suction Plate for Toddlers', 'suction plate toddler'))
  assert.ok(!covers('Suction Bowl', 'suction plate'))
})

test('words: phrases split into weighted words, plurals merged, filler and brands dropped', () => {
  assert.deepEqual(wordsOf('Suction Plates for Babies with doddl'), ['suction', 'plate', 'baby'])
  assert.equal(stemWord('bowls'), 'bowl'); assert.equal(stemWord('toddlers'), 'toddler'); assert.equal(stemWord('glass'), 'glass')
  const { words, phrases } = wordWeights([
    { search_query: 'baby suction plate', query_volume: 6000 }, { search_query: 'suction plates', query_volume: 2000 },
    { search_query: 'toddler plate', query_volume: 1000 }, { search_query: 'munchkin plate', query_volume: 9000 },
    { search_query: 'plate with lid', query_volume: 500, choice: 'watch' },
  ])
  assert.equal(phrases.length, 3, 'competitors and watch never count')
  assert.deepEqual(words.map(w => [w.word, w.weight]), [['plate', 9000], ['suction', 8000], ['baby', 6000], ['toddler', 1000]])
})

test('SEO score on words: 100 points, lead phrase, findable searches, penalties', () => {
  const keywords = [{ search_query: 'baby suction bowl', query_volume: 900 }, { search_query: 'toddler bowls', query_volume: 100 }]
  const good = {
    title: 'doddl Baby Suction Bowl for Toddlers, 2-in-1 Weaning Bowl with Strong Suction Base, Dishwasher Safe, 6 Months Plus, BPA Free Silicone Rim for Self Feeding',
    bullet_1: 'EASY TO USE: a baby suction bowl that stays put for toddlers. ' + 'y'.repeat(150), bullet_2: 'y'.repeat(160), bullet_3: 'y'.repeat(160), bullet_4: 'y'.repeat(160), bullet_5: 'y'.repeat(160),
    description: 'z'.repeat(1000), search_terms: 'w'.repeat(200),
  }
  const full = seoScore({ copy: good, keywords, images: 7, aplusLive: true })
  assert.equal(full.parts.title, 30); assert.equal(full.parts.lead, 5); assert.equal(full.parts.findable, 20); assert.equal(full.parts.bullets, 10)
  assert.equal(full.parts.images, 15); assert.equal(full.parts.aplus, 5); assert.equal(full.parts.family, 5); assert.equal(full.parts.space, 10)
  assert.equal(full.score, 100)
  assert.ok(full.words.every(w => w.in_title))
  const weak = seoScore({ copy: { title: 'toddler bowl bowl bowl', search_terms: 'doddl munchkin ' + 'a'.repeat(260) }, keywords, images: 3 })
  assert.equal(weak.parts.lead, 0)
  assert.equal(weak.parts.findable, 2) // only "toddler bowls" (100 of 1000) is findable
  assert.ok(weak.penalties.some(p => /249 bytes/.test(p[0])) && weak.penalties.some(p => /Brand/.test(p[0])) && weak.penalties.some(p => /more than twice/.test(p[0])) && weak.penalties.some(p => /Another brand/.test(p[0])))
  assert.ok(weak.score < 15)
})

test('gap map: structure against the target per store, content against the master, later stores wait', () => {
  const target = { parent_sku: 'P-2IN1-BOWL', theme: 'COLOR', children: ['GREEN00001', 'ROSE000001'], moved_out: [{ asin: 'PACK000001', to_family: 'P-2IN1-BOWL-TWIN' }] }
  const members = [
    { asin: 'GREEN00001', marketplace: 'UK', role: 'child', colour: 'Fresh Green' }, { asin: 'ROSE000001', marketplace: 'UK', role: 'child', colour: 'Dusky Rose' },
    { asin: 'PACK000001', marketplace: 'UK', role: 'child', colour: 'Fresh Gree - Twin Pack' },
    { asin: 'GREEN00001', marketplace: 'US', role: 'child', colour: 'Fresh Green' }, { asin: 'ROSE000001', marketplace: 'US', role: 'child', colour: 'Dusky Rose' },
    { asin: 'GREEN00001', marketplace: 'FR', role: 'standalone', colour: null }, { asin: 'ROSE000001', marketplace: 'FR', role: 'standalone', colour: null },
  ]
  const parents = [{ marketplace: 'UK', parent_asin: 'UKPARENT01', parent_sku: 'BOWL PARENT' }, { marketplace: 'US', parent_asin: 'USPARENT01', parent_sku: 'P-2IN1-BOWL' }]
  const products = [{ asin: 'UKPARENT01', marketplace: 'UK', variations: { theme: 'COLOR' } }, { asin: 'USPARENT01', marketplace: 'US', variations: { theme: 'COLOR_NAME' } }]
  const master = { copy: { title: 'doddl Baby Suction Bowl', bullet_1: 'b1', description: 'd', search_terms: 's' }, colours: [{ asin: 'GREEN00001', name: 'Fresh Green' }, { asin: 'ROSE000001', name: 'Dusky Rose' }], attributes: [{ name: 'material', value: 'silicone' }], images_missing: 2 }
  const g = gapMap({ target, master, members, parents, products, ukFields: { title: 'doddl Baby Suction Bowl Fresh Green', bullet_1: 'b1', description: 'd', search_terms: 'other' }, stores: ['UK', 'US', 'FR', 'DE'] })
  const cell = (key, s) => g.rows.find(r => r.key === key).cells[s]
  assert.equal(cell('parent_sku', 'UK').state, 'bad'); assert.match(cell('parent_sku', 'UK').text, /BOWL PARENT → P-2IN1-BOWL/)
  assert.equal(cell('parent_sku', 'US').state, 'ok')
  assert.match(cell('children', 'UK').text, /1 pack to move out/)
  assert.equal(cell('children', 'FR').state, 'bad'); assert.equal(cell('parent_sku', 'FR').text, 'no parent')
  assert.equal(cell('parent_sku', 'DE').state, 'none')
  assert.equal(cell('title', 'UK').state, 'ok'); assert.equal(cell('search_terms', 'UK').state, 'bad'); assert.match(cell('images', 'UK').text, /2 slots missing/)
  assert.equal(cell('title', 'US').state, 'later'); assert.equal(cell('title', 'FR').state, 'blocked')
  assert.equal(g.structure_complete, false)
})

test('images: each colour = master slots + its own colour slots; a missing colour picture is never borrowed', () => {
  const master = slotsOf([{ slot: 'MAIN', url: 'm0' }, { slot: 'PT01', url: 'm1' }, { slot: 'PT02', url: 'm2' }, { slot: 'PT04', url: 'm4' }])
  const out = composeImages({ PT04: 'colour' }, master, [{ asin: 'A', colour: 'Rose', images: { MAIN: 'r0', PT03: 'r3', PT04: 'r4' } }, { asin: 'B', colour: 'Green', images: { MAIN: 'g0' } }])
  const a = Object.fromEntries(out[0].slots.map(s => [s.slot, s.url])), b = Object.fromEntries(out[1].slots.map(s => [s.slot, s.url]))
  assert.deepEqual([a.MAIN, a.PT01, a.PT03, a.PT04], ['r0', 'm1', 'r3', 'r4'])
  assert.deepEqual([b.MAIN, b.PT01, b.PT03, b.PT04], ['g0', 'm1', null, null])
  assert.ok(out[1].slots.find(s => s.slot === 'PT03').missing)
})

test('keyword focus merges the family, adds own keywords and says where each search sits', () => {
  const f = keywordFocus([
    { asin: 'A', search_query: 'Suction plate', query_volume: 500, asin_impressions: 10, asin_clicks: 4, asin_purchases: 1 },
    { asin: 'B', search_query: 'suction plate', query_volume: 500, asin_impressions: 5, asin_clicks: 1, asin_purchases: 1 },
    { asin: 'A', search_query: 'doddl plate', query_volume: 50, is_brand_term: true },
    { asin: 'A', search_query: 'plate with lip', query_volume: 90 },
  ], { title: 'doddl Suction Plate', search_terms: '' }, ['plate for 1 year old'])
  assert.equal(f.length, 3)
  assert.equal(f[0].search_query, 'plate for 1 year old', 'own keywords are in focus, so they lead')
  const s = f.find(k => k.search_query === 'Suction plate')
  assert.deepEqual([s.impressions, s.clicks, s.purchases, s.where, s.choice], [15, 5, 2, 'Title', 'auto'])
  assert.equal(s.conversion, 0.4)
  assert.equal(f.find(k => k.search_query === 'plate with lip').where, 'Missing')
  assert.ok(f.find(k => k.own))
})
