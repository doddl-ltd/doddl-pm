import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTranslateRequest, needsTranslation, hasParts, parseTranslation, planMarket } from '../lib/pm/masterSend.js'

const master = {
  status: 'approved',
  copy: { title: 'doddl Toddler Cutlery Set', bullet_1: 'Short handles', bullet_2: '', bullet_3: '', bullet_4: '', bullet_5: '', description: 'Made for small hands.', search_terms: 'toddler cutlery' },
  attributes: [
    { name: 'color', value: 'Indigo', keep: true },
    { name: 'item_weight', value: '120 grams', keep: true },
    { name: 'is_dishwasher_safe', value: 'true', keep: true },
    { name: 'warranty_description', value: 'None', keep: false },
    { name: 'item_dimensions', value: 'length: 10 centimeters; width: 2 centimeters', keep: true },
  ],
  images: { UK: [{ slot: 'MAIN', url: 'https://m.media-amazon.com/images/I/a.jpg' }, { slot: 'PT01', url: 'https://m.media-amazon.com/images/I/b.jpg' }] },
  variants: {},
}
const product = (attrs) => ({ sku: 'DOD002', attributes: attrs.map(([name, value]) => ({ name, value, source: 'page' })) })
const fields = (o) => Object.entries(o).map(([field, live]) => ({ field, live }))

test('translation needed only for words, not numbers, codes or true/false', () => {
  assert.equal(needsTranslation('color', 'Indigo'), true)
  assert.equal(needsTranslation('item_weight', '120 grams'), false)
  assert.equal(needsTranslation('is_dishwasher_safe', 'true'), false)
  assert.equal(needsTranslation('externally_assigned_product_identifier', '5060460120002; type: ean'), false)
  assert.equal(hasParts('length: 10 centimeters; width: 2 centimeters'), true)
  assert.equal(hasParts('Indigo'), false)
})

test('English market: copy, attributes, removals and image slots against the master', () => {
  const p = planMarket({
    master, market: 'UK',
    product: product([['color', 'Blue'], ['item_weight', '120 grams'], ['is_dishwasher_safe', 'true'], ['warranty_description', 'None']]),
    fields: fields({ Title: 'Old title', 'Bullet 1': 'Short handles', Description: 'Made for small hands.', 'Search terms': 'toddler cutlery', Images: [{ slot: 'MAIN', url: 'https://m.media-amazon.com/images/I/a.jpg' }, { slot: 'PT01', url: 'https://m.media-amazon.com/images/I/x.jpg' }, { slot: 'PT02', url: 'https://m.media-amazon.com/images/I/y.jpg' }] }),
    held: [],
  })
  const by = Object.fromEntries(p.changes.map(c => [c.name, c]))
  assert.equal(by.Title.to, 'doddl Toddler Cutlery Set')
  assert.equal(by.color.to, 'Indigo')
  assert.equal(by.warranty_description.remove, true)
  assert.equal(by.other_product_image_locator_1.to, 'https://m.media-amazon.com/images/I/b.jpg')
  assert.equal(by.other_product_image_locator_2.remove, true)
  assert.equal(by.main_product_image_locator, undefined)
  assert.equal(by['Bullet 1'], undefined)
  assert.ok(p.skipped.some(s => s.name === 'item_dimensions' && /Seller Central/.test(s.why)))
})

test('non-English market: neutral attributes go now; copy and words wait for an approved translation', () => {
  const p = planMarket({ master, market: 'DE', product: product([['color', 'Blau'], ['item_weight', '100 grams']]), fields: fields({ Title: 'doddl Besteck' }), held: [] })
  assert.ok(p.changes.some(c => c.name === 'item_weight' && c.to === '120 grams'))
  assert.ok(!p.changes.some(c => c.name === 'Title' || c.name === 'color'))
  assert.ok(p.skipped.some(s => s.name === 'Title' && /not translated/.test(s.why)))
  const m2 = { ...master, variants: { DE: { status: 'approved', approved_by: 'Jon', copy: { ...master.copy, title: 'doddl Kinderbesteck-Set' }, attributes: { color: 'Indigoblau' } } } }
  const q = planMarket({ master: m2, market: 'DE', product: product([['color', 'Blau']]), fields: fields({ Title: 'doddl Besteck' }), held: [{ kind: 'field', name: 'Description', status: 'in_approval' }] })
  const t = q.changes.find(c => c.name === 'Title')
  assert.equal(t.to, 'doddl Kinderbesteck-Set')
  assert.equal(t.reviewed_by, 'Jon')
  assert.equal(q.changes.find(c => c.name === 'color').to, 'Indigoblau')
  assert.ok(q.skipped.some(s => s.name === 'Description' && /already waiting/.test(s.why)))
  assert.equal(planMarket({ master, market: 'PL', product: null, fields: [], held: [] }).blocked, 'doddl does not sell this product on Amazon PL')
})

test('translate request: structured JSON, low effort, words only; parse refuses refusals and bad stops', () => {
  const r = buildTranslateRequest(master, 'DE')
  assert.equal(r.output_config.effort, 'low')
  assert.equal(r.output_config.format.type, 'json_schema')
  const sent = JSON.parse(r.messages[0].content)
  assert.deepEqual(sent.attributes.map(a => a.name), ['color'])
  assert.match(r.system, /German/)
  assert.throws(() => parseTranslation({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }), /declined/)
  assert.throws(() => parseTranslation({ stop_reason: 'max_tokens', content: [] }), /stopped early/)
  const ok = parseTranslation({ stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 2000 }, content: [{ type: 'text', text: JSON.stringify({ copy: { title: 'doddl X' }, attributes: [{ name: 'color', value: 'Indigo' }] }) }] })
  assert.equal(ok.copy.title, 'doddl X')
  assert.equal(ok.attributes.color, 'Indigo')
  assert.equal(ok.cost_usd, 0.044)
})
