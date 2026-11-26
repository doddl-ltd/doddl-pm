import { test } from 'node:test'
import assert from 'node:assert/strict'
import { structurePlan, nextEdits } from '../lib/pm/familyStructure.js'

const target = { parent_sku: 'P-2IN1-BOWL', children: ['G', 'R'], moved_out: [{ asin: 'T', to_family: 'P-2IN1-BOWL-TWIN' }] }
const members = [
  { asin: 'G', marketplace: 'UK', sku: 'DOD011', role: 'child', parent_asin: 'OLDP', colour: 'Fresh Green' },
  { asin: 'R', marketplace: 'UK', sku: 'DOD054', role: 'child', parent_asin: 'OLDP', colour: 'Dusky Rose' },
  { asin: 'T', marketplace: 'UK', sku: 'DOD011x2', role: 'child', parent_asin: 'OLDP' },
  { asin: 'G', marketplace: 'DE', sku: 'DOD011_EU', role: 'child', parent_asin: 'EUP' },
  { asin: 'R', marketplace: 'DE', sku: 'DOD054_eu', role: 'standalone', parent_asin: null },
]
const products = [{ asin: 'OLDP', marketplace: 'UK', sku: 'BOWL PARENT', product: 'old parent' }, { asin: 'G', marketplace: 'DE', sku: 'DOD011_EU', product: 'doddl Schüssel' }]

test('structure: parent first, then children; packs under their own parent; EU parent from the child', () => {
  const plan = structurePlan({ target, members, products, edits: [], stores: ['UK', 'DE', 'US'] })
  assert.deepEqual(Object.keys(plan), ['UK', 'DE'])
  assert.equal(plan.UK.groups.length, 2)
  assert.equal(plan.UK.groups[0].next, 'parent')
  const [e] = nextEdits({ market: 'UK', group: plan.UK.groups[0], members, products, masterTitle: 'doddl Baby Bowl', who: 'Jon' })
  assert.equal(e.kind, 'parent'); assert.equal(e.name, 'P-2IN1-BOWL'); assert.equal(e.asin, 'G')
  const v = JSON.parse(e.value)
  assert.deepEqual(v, { variation_theme: 'COLOR', item_name: 'doddl Baby Bowl', template_sku: 'BOWL PARENT', suggested_asin: 'OLDP', brand: 'doddl', manufacturer: 'Doddl Ltd', attributes: { country_of_origin: 'CN', supplier_declared_dg_hz_regulation: 'not_applicable', batteries_required: false, batteries_included: false } })
  assert.equal(e.language_reviewed_by, null)
  assert.match(nextEdits({ market: 'DE', group: plan.DE.groups[0], members, products, masterTitle: 'doddl Baby Bowl', who: 'Jon' }).missing, /approved DE translation/)
  const variants = { G: { DE: { status: 'approved', approved_by: 'Jon', copy: { title: 'doddl Babyschüssel, Frisches Grün' } } } }
  const [d] = nextEdits({ market: 'DE', group: plan.DE.groups[0], members, products, masterTitle: 'doddl Baby Bowl', who: 'Jon', variants })
  assert.deepEqual(JSON.parse(d.value), { variation_theme: 'COLOR', item_name: 'doddl Babyschüssel', template_sku: 'DOD011_EU', suggested_asin: 'EUP', brand: 'doddl', manufacturer: 'Doddl Ltd', attributes: { country_of_origin: 'CN', supplier_declared_dg_hz_regulation: 'not_applicable', batteries_required: false, batteries_included: false } })
  assert.equal(d.language_reviewed_by, 'Jon')
})

test('structure: a sent parent unlocks the children; linked children are done', () => {
  const edits = [{ asin: 'G', marketplace: 'UK', kind: 'parent', name: 'P-2IN1-BOWL', status: 'sent' }]
  let plan = structurePlan({ target, members, products, edits, stores: ['UK'] })
  assert.equal(plan.UK.groups[0].next, 'children')
  const rows = nextEdits({ market: 'UK', group: plan.UK.groups[0], members, products, who: 'Jon' })
  assert.deepEqual(rows.map(r => [r.asin, r.name, r.value, r.live]), [['G', 'child_parent_sku_relationship', 'P-2IN1-BOWL', 'BOWL PARENT'], ['R', 'child_parent_sku_relationship', 'P-2IN1-BOWL', 'BOWL PARENT']])
  const p2 = [...products, { asin: 'NEWP', marketplace: 'UK', sku: 'P-2IN1-BOWL' }]
  const m2 = members.map(m => (m.marketplace === 'UK' && m.asin !== 'T' ? { ...m, parent_asin: 'NEWP' } : m))
  plan = structurePlan({ target, members: m2, products: p2, edits, stores: ['UK'] })
  assert.equal(plan.UK.groups[0].done, true)
  assert.equal(plan.UK.groups[0].next, null)
  assert.equal(plan.UK.next, 'P-2IN1-BOWL-TWIN')
})

import { colourMaster } from '../lib/pm/familyMaster.js'
test('colour master: colour in the title, identity + colour kept per ASIN, German value fixed, its own 7 pictures', () => {
  const fm = { copy: { title: 'doddl Baby Bowl', bullet_1: 'b1' }, attributes: [{ name: 'brand', value: 'doddl' }, { name: 'color', value: 'Green' }, { name: 'externally_assigned_product_identifier', value: 'EAN-G' }, { name: 'special_feature', value: 'Spülmaschinenfest' }] }
  const own = { attributes: [{ name: 'color', value: 'Pink', keep: true }, { name: 'externally_assigned_product_identifier', value: 'EAN-R', keep: true }, { name: 'old_thing', value: 'x', keep: true }], images: { UK: [] } }
  const fm2 = { ...fm, attributes: [...fm.attributes, { name: 'model_number', value: 'DODDLBOWL' }, { name: 'item_weight', value: '0.18 kilograms' }] }
  const m = colourMaster({ fm: fm2, colour: { asin: 'R', name: 'Dusky Rose' }, own, live: [{ name: 'item_weight', value: '0.168 kilograms', source: 'ours' }], imagesFor: () => [{ slot: 'MAIN', url: 'u' }] })
  assert.equal(m.copy.title, 'doddl Baby Bowl, Dusky Rose')
  const a = Object.fromEntries(m.attributes.map(x => [x.name, x.value]))
  assert.deepEqual(a, { special_feature: 'Dishwasher Safe', item_weight: '0.168 kilograms', externally_assigned_product_identifier: 'EAN-R', color: 'Dusky Rose' })
  assert.deepEqual(m.images.MASTER, [{ slot: 'MAIN', url: 'u' }])
})

import { marketImages } from '../lib/pm/marketImages.js'
test('english pictures: a non-English store takes the English pictures unless an approved translation exists', () => {
  const master = { images: { MASTER: [{ url: 'm0' }, { url: 'm1' }, { url: 'm2' }] }, rollout: { english_images: true } }
  const t = [{ locale: 'DE', source_url: 'm2', status: 'approved', url: 'de2' }, { locale: 'DE', source_url: 'm1', status: 'problem', url: 'bad' }]
  assert.deepEqual(marketImages(master, 'DE', t).map(x => [x.url, x.ready]), [['m0', true], ['m1', true], ['de2', true]])
  assert.deepEqual(marketImages({ ...master, rollout: {} }, 'DE', t).map(x => x.ready), [true, false, true])
})

test('keep_existing: a store keeps our parent holding most colours; others use the account parent; new parent titled from the live title', async () => {
  const { effectiveParent, titleWithoutColour } = await import('../lib/pm/familyStructure.js')
  const t = { parent_sku: 'P-3PC-CUTLERY', children: ['A', 'B', 'C'], moved_out: [], keep_existing: true }
  const mem = [
    { asin: 'A', marketplace: 'DE', sku: 'A_EU', role: 'child', parent_asin: 'DEP', colour: 'Fresh Green' },
    { asin: 'B', marketplace: 'DE', sku: 'B_EU', role: 'child', parent_asin: 'DEP', colour: 'Magenta' },
    { asin: 'C', marketplace: 'DE', sku: 'C_EU', role: 'standalone', parent_asin: null, colour: 'Dusky Rose' },
    { asin: 'A', marketplace: 'ES', sku: 'A_EU', role: 'child', parent_asin: 'ORPHAN', colour: 'Fresh Green' },
    { asin: 'C', marketplace: 'ES', sku: 'C_EU', role: 'standalone', parent_asin: null, colour: 'Dusky Rose' },
    { asin: 'A', marketplace: 'PL', sku: 'A_PL', role: 'child', parent_asin: null, colour: 'Fresh Green' },
  ]
  const prod = [{ asin: 'DEP', marketplace: 'DE', sku: 'S2X-PARENT' }]
  assert.equal(effectiveParent({ target: t, market: 'DE', members: mem, products: prod }), 'S2X-PARENT')
  assert.equal(effectiveParent({ target: t, market: 'ES', members: mem, products: prod }), 'S2X-PARENT')
  assert.equal(effectiveParent({ target: t, market: 'UK', members: mem, products: prod }), 'P-3PC-CUTLERY')
  assert.equal(effectiveParent({ target: { ...t, keep_existing: false }, market: 'DE', members: mem, products: prod }), 'P-3PC-CUTLERY')
  const plan = structurePlan({ target: t, members: mem, products: prod, edits: [], stores: ['DE', 'ES'] })
  assert.equal(plan.DE.groups[0].parent_sku, 'S2X-PARENT'); assert.equal(plan.DE.groups[0].next, 'children')
  assert.deepEqual(nextEdits({ market: 'DE', group: plan.DE.groups[0], members: mem, products: prod, who: 'Jon' }).map(r => [r.asin, r.value]), [['C', 'S2X-PARENT']])
  assert.equal(plan.ES.groups[0].next, 'parent')
  const [p] = nextEdits({ market: 'ES', group: plan.ES.groups[0], members: mem, products: prod, who: 'Jon', keepExisting: true, liveTitles: { 'A|ES': 'doddl Juego de cubiertos, 3 piezas, Fresh Green' } })
  const v = JSON.parse(p.value)
  assert.equal(p.name, 'S2X-PARENT'); assert.equal(v.item_name, 'doddl Juego de cubiertos, 3 piezas'); assert.equal(v.suggested_asin, 'DEP'); assert.equal(p.language_reviewed_by, 'Jon')
  assert.equal(titleWithoutColour('doddl Set – Dusky Rose', 'Dusky Rose'), 'doddl Set')
  assert.equal(titleWithoutColour('doddl Set (Magenta)', 'Magenta'), 'doddl Set')
  assert.equal(titleWithoutColour('doddl Set', 'Aqua'), 'doddl Set')
})

test('keep_existing: the account parent whose ASIN already holds colours in this store wins', async () => {
  const { effectiveParent } = await import('../lib/pm/familyStructure.js')
  const t = { parent_sku: 'P-3PC-CUTLERY', children: ['A', 'B'], keep_existing: true }
  const mem = [
    { asin: 'A', marketplace: 'DE', parent_asin: 'DEP' }, { asin: 'B', marketplace: 'DE', parent_asin: 'DEP' },
    { asin: 'A', marketplace: 'FR', parent_asin: 'FRP' }, { asin: 'B', marketplace: 'FR', parent_asin: 'FRP' },
    { asin: 'A', marketplace: 'BE', parent_asin: 'FRP' }, { asin: 'B', marketplace: 'BE', parent_asin: null },
    { asin: 'A', marketplace: 'ES', parent_asin: 'ORPHAN' },
  ]
  const prod = [{ asin: 'DEP', marketplace: 'DE', sku: 'S2X' }, { asin: 'FRP', marketplace: 'FR', sku: 'SP-ARM' }]
  assert.equal(effectiveParent({ target: t, market: 'BE', members: mem, products: prod }), 'SP-ARM')
  assert.equal(effectiveParent({ target: t, market: 'ES', members: mem, products: prod }), 'S2X')
})

test('titleWithoutColour: a colour not on file is still taken off (doddl colour names)', async () => {
  const { titleWithoutColour } = await import('../lib/pm/familyStructure.js')
  assert.equal(titleWithoutColour('doddl Set | Self-Feeding from 6 Months to 5+ Fresh Green', null), 'doddl Set | Self-Feeding from 6 Months to 5+')
  assert.equal(titleWithoutColour('doddl Juego 3 piezas Dusky Rose', ''), 'doddl Juego 3 piezas')
})

test('titleWithoutColour: colour in the middle of a long title', async () => {
  const { titleWithoutColour } = await import('../lib/pm/familyStructure.js')
  assert.equal(titleWithoutColour('doddl Kit | from 6 Months to 5+ Fresh Green | Gift Boxed', null), 'doddl Kit | from 6 Months to 5+ | Gift Boxed')
  assert.equal(titleWithoutColour('doddl Set (Dusky Rose), BPA free', 'Dusky Rose'), 'doddl Set, BPA free')
})

test('keep_existing parent: wrong-theme parents skipped; brand first; bullets + description from a live colour', async () => {
  const { effectiveParent } = await import('../lib/pm/familyStructure.js')
  const t = { parent_sku: 'P-2PC', theme: 'COLOR', children: ['A', 'B'], keep_existing: true }
  const mem = [{ asin: 'A', marketplace: 'DE', parent_asin: 'SZ', colour: 'Aqua' }, { asin: 'B', marketplace: 'DE', parent_asin: null, colour: 'Dusky Rose' }]
  const prod = [{ asin: 'SZ', marketplace: 'DE', sku: 'S2X', variations: { theme: 'COLOR_NAME/SIZE_NAME' } }]
  assert.equal(effectiveParent({ target: t, market: 'DE', members: mem, products: prod }), 'P-2PC')
  const plan = structurePlan({ target: t, members: mem, products: prod, edits: [], stores: ['DE'] })
  const [p] = nextEdits({ market: 'DE', group: plan.DE.groups[0], members: mem, products: prod, who: 'Jon', keepExisting: true,
    liveTitles: { 'A|DE': 'Doddl Besteck 2-teilig Aqua' }, liveCopy: { 'A|DE': { bullets: ['b1', 'b2'], description: null } } })
  const v = JSON.parse(p.value)
  assert.equal(v.item_name, 'doddl Besteck 2-teilig')
  assert.deepEqual(v.attributes.bullet_point, ['b1', 'b2']); assert.equal(v.attributes.product_description, 'b1 b2')
})

test('keep_existing parent value stays under 2,000 characters', async () => {
  const t = { parent_sku: 'P-K', theme: 'COLOR', children: ['A'], keep_existing: true }
  const mem = [{ asin: 'A', marketplace: 'CA', parent_asin: null, colour: 'Fresh Green' }]
  const plan = structurePlan({ target: t, members: mem, products: [], edits: [], stores: ['CA'] })
  const long = 'word '.repeat(120)
  const [p] = nextEdits({ market: 'CA', group: plan.CA.groups[0], members: mem, products: [], who: 'Jon', keepExisting: true, masterTitle: 'doddl Kit',
    masterCopy: { bullet_1: long, bullet_2: long, bullet_3: long, bullet_4: long, bullet_5: long, description: long.repeat(3) } })
  assert.ok(p.value.length <= 2000, String(p.value.length))
  assert.ok(JSON.parse(p.value).attributes.bullet_point.length >= 3)
})
