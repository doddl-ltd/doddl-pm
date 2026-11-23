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
  assert.deepEqual(v, { variation_theme: 'COLOR', item_name: 'doddl Baby Bowl', template_sku: 'BOWL PARENT', suggested_asin: 'OLDP', brand: 'doddl', manufacturer: 'Doddl Ltd' })
  assert.equal(e.language_reviewed_by, null)
  assert.match(nextEdits({ market: 'DE', group: plan.DE.groups[0], members, products, masterTitle: 'doddl Baby Bowl', who: 'Jon' }).missing, /approved DE translation/)
  const variants = { G: { DE: { status: 'approved', approved_by: 'Jon', copy: { title: 'doddl Babyschüssel, Frisches Grün' } } } }
  const [d] = nextEdits({ market: 'DE', group: plan.DE.groups[0], members, products, masterTitle: 'doddl Baby Bowl', who: 'Jon', variants })
  assert.deepEqual(JSON.parse(d.value), { variation_theme: 'COLOR', item_name: 'doddl Babyschüssel', template_sku: 'DOD011_EU', suggested_asin: 'EUP', brand: 'doddl', manufacturer: 'Doddl Ltd' })
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
