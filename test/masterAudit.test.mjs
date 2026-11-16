import test from 'node:test'
import assert from 'node:assert/strict'
import { auditMarket } from '../lib/pm/masterAudit.js'

const master = (over = {}) => ({
  asin: 'B000000001', status: 'approved', product_type: 'CUTLERY',
  copy: { title: 'doddl Toddler Cutlery Set', bullet_1: 'Easy grip', bullet_2: '', bullet_3: '', bullet_4: '', bullet_5: '', description: '', search_terms: '' },
  attributes: [{ name: 'color', value: 'Fresh Green', keep: true }, { name: 'material', value: 'Stainless steel', keep: true }, { name: 'model_name', value: 'Old name', keep: false }],
  images: {}, variants: {}, ...over,
})
const product = (attrs) => ({ asin: 'B000000001', marketplace: 'UK', sku: 'DOD004', checked_at: '2026-11-16T13:00:00Z', attributes: attrs })
const fields = [{ field: 'Title', live: 'doddl Toddler Cutlery Set' }, { field: 'Bullet 1', live: 'Old bullet' }]

test('every difference from the master says what fixes it', () => {
  const a = auditMarket({
    master: master(), market: 'UK', fields,
    product: product([{ name: 'color', value: 'Lime Green', source: 'page' }, { name: 'material', value: 'Stainless steel', source: 'page' }, { name: 'model_name', value: 'Doddl Cutlery', source: 'page' }, { name: 'age_range_description', value: '12 months+', source: 'page' }, { name: 'item_name', value: 'x', source: 'page' }, { name: 'recommended_browse_nodes', value: '123', source: 'page' }]),
  })
  const by = (name) => a.items.find((i) => i.name === name)
  assert.equal(by('Bullet 1').action, 'send')
  assert.equal(by('color').action, 'send')
  assert.equal(by('color').should, 'Fresh Green')
  assert.equal(by('model_name').should, '(remove)')
  assert.equal(by('age_range_description').action, 'extra', 'an attribute Amazon has and the master does not')
  assert.equal(by('item_name'), undefined, 'copy attributes are compared as copy, not as extras')
  assert.equal(by('recommended_browse_nodes'), undefined, 'per-store attributes are never scored')
  assert.equal(by('material'), undefined, 'matches the master')
  assert.equal(a.to_send, 3)
  assert.equal(a.extra, 1)
})

test('an unapproved master asks for approval first; a non-English market waits on its translation', () => {
  const draft = auditMarket({ master: master({ status: 'draft' }), market: 'UK', fields, product: product([]) })
  assert.ok(draft.items.some((i) => i.action === 'approve'))
  assert.ok(!draft.items.some((i) => i.action === 'send'))
  const de = auditMarket({ master: master(), market: 'DE', fields: [{ field: 'Title', live: 'doddl Kinderbesteck' }], product: { ...product([]), marketplace: 'DE' } })
  assert.ok(de.translate > 0, 'copy waits for an approved German version')
  assert.ok(!de.items.some((i) => i.kind === 'copy' && i.action === 'send'))
})

test('sent and still wrong after 72 hours is a case; inside 72 hours it is waiting', () => {
  const sent = (at) => [{ id: '11111111-1111-1111-1111-111111111111', kind: 'attribute', name: 'color', value: 'Fresh Green', live: 'Lime Green', status: 'sent', sent_at: at }]
  const p = product([{ name: 'color', value: 'Lime Green', source: 'page' }, { name: 'material', value: 'Stainless steel', source: 'page' }])
  const late = auditMarket({ master: master(), market: 'UK', fields, product: p, edits: sent('2026-11-10T10:00:00Z'), now: new Date('2026-11-16T14:40:00Z') })
  assert.equal(late.problems, 1)
  assert.equal(late.items.find((i) => i.action === 'case').should, 'Fresh Green')
  const soon = auditMarket({ master: master(), market: 'UK', fields, product: { ...p, checked_at: '2026-11-16T13:00:00Z' }, edits: sent('2026-11-16T09:00:00Z'), now: new Date('2026-11-16T14:40:00Z') })
  assert.equal(soon.problems, 0)
  assert.ok(soon.waiting >= 1)
})
