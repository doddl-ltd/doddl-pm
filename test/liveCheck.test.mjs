import test from 'node:test'
import assert from 'node:assert/strict'
import { liveCheck, caseText, imageSlot, contactUrl } from '../lib/pm/liveCheck.js'
import { planMarket } from '../lib/pm/masterSend.js'

const SENT = '2026-11-12T10:00:00.000Z'
const product = (over = {}) => ({ asin: 'B074DZSKV6', sku: 'DOD002', product: 'DOD002 · Toddler cutlery', checked_at: '2026-11-13T07:00:00.000Z', attributes: [], ...over })
const edit = (over = {}) => ({ id: 'e1', status: 'sent', kind: 'field', name: 'Title', value: 'doddl New title', live: 'doddl Old title', sent_at: SENT, ...over })

test('image slots', () => {
  assert.equal(imageSlot('main_product_image_locator'), 0)
  assert.equal(imageSlot('other_product_image_locator_3'), 3)
  assert.equal(imageSlot('color'), null)
  assert.equal(contactUrl('DE'), 'https://sellercentral.amazon.de/cu/contact-us')
})

test('not sent: no check; sent but not read since: waiting', () => {
  assert.equal(liveCheck(edit({ status: 'in_approval' }), {}), null)
  const c = liveCheck(edit(), { product: product({ checked_at: '2026-11-12T09:00:00.000Z' }), fields: [] })
  assert.equal(c.state, 'waiting')
  assert.match(c.why, /next read/)
})

test('copy: live when the page shows it, waiting inside 72 hours, problem after', () => {
  const fields = [{ field: 'Title', live: 'doddl  New title' }]
  assert.equal(liveCheck(edit(), { product: product(), fields }).state, 'live')
  const old = [{ field: 'Title', live: 'doddl Old title' }]
  assert.equal(liveCheck(edit(), { product: product(), fields: old, now: new Date('2026-11-13T08:00:00Z') }).state, 'waiting')
  const p = liveCheck(edit(), { product: product({ checked_at: '2026-11-16T07:00:00Z' }), fields: old, now: new Date('2026-11-16T08:00:00Z') })
  assert.equal(p.state, 'problem')
  assert.match(p.why, /3 days/)
})

test('an Amazon error on the field is a problem at once', () => {
  const events = [{ at: '2026-11-13T06:00:00Z', text: 'Amazon error 8541: the value for item_name conflicts with another contributor' }, { at: '2026-11-01T00:00:00Z', text: 'Amazon error 1: item_name old' }]
  const c = liveCheck(edit(), { product: product(), fields: [{ field: 'Title', live: 'doddl Old title' }], events, now: new Date('2026-11-13T08:00:00Z') })
  assert.equal(c.state, 'problem')
  assert.match(c.why, /8541/)
  assert.equal(c.issues.length, 1)
})

test('images: Amazon re-hosts, so live = our listing holds our link and the page slot changed', () => {
  const ours = 'https://abc.supabase.co/storage/v1/object/public/listing-images/B074DZSKV6/UK/x-main.jpg'
  const e = edit({ kind: 'attribute', name: 'main_product_image_locator', value: ours, live: 'https://m.media-amazon.com/images/I/old.jpg' })
  const accepted = product({ attributes: [{ name: 'main_product_image_locator', value: `media_location: ${ours}`, source: 'our listing' }] })
  const changed = [{ field: 'Images', live: [{ slot: 'MAIN', url: 'https://m.media-amazon.com/images/I/new.jpg' }] }]
  const same = [{ field: 'Images', live: [{ slot: 'MAIN', url: 'https://m.media-amazon.com/images/I/old.jpg' }] }]
  assert.equal(liveCheck(e, { product: accepted, fields: changed }).state, 'live')
  const w = liveCheck(e, { product: accepted, fields: same, now: new Date('2026-11-13T08:00:00Z') })
  assert.equal(w.state, 'waiting')
  assert.match(w.why, /accepted the image/)
  const p = liveCheck(e, { product: { ...accepted, checked_at: '2026-11-20T07:00:00Z' }, fields: same, now: new Date('2026-11-20T08:00:00Z') })
  assert.equal(p.state, 'problem')
  assert.match(p.why, /still shows the old one/)
})

test('removal: live when Amazon shows nothing', () => {
  const e = edit({ kind: 'attribute', name: 'color', value: '' })
  assert.equal(liveCheck(e, { product: product(), fields: [] }).state, 'live')
  assert.equal(liveCheck(e, { product: product({ attributes: [{ name: 'color', value: 'Red', source: 'page' }] }), fields: [], now: new Date('2026-11-13T08:00:00Z') }).state, 'waiting')
})

test('case text names the ASIN, SKU, store, what was sent and what shows', () => {
  const p = liveCheck(edit(), { product: product({ checked_at: '2026-11-16T07:00:00Z' }), fields: [{ field: 'Title', live: 'doddl Old title' }], now: new Date('2026-11-16T08:00:00Z') })
  const { subject, body } = caseText({ product: product(), marketplace: 'UK', problems: [p] })
  assert.match(subject, /B074DZSKV6/)
  assert.match(subject, /Amazon\.co\.uk/)
  assert.match(body, /We sent \(2026-11-12 10:00 UTC\): doddl New title/)
  assert.match(body, /The page shows .*doddl Old title/)
  assert.match(body, /SKU: DOD002/)
})

test('the planner does not send again what is already sent and waiting, or live', () => {
  const ours = 'https://abc.supabase.co/storage/v1/object/public/listing-images/B074DZSKV6/UK/x-main.jpg'
  const master = { asin: 'B074DZSKV6', status: 'approved', copy: { title: 'doddl New title' }, attributes: [], images: { UK: [{ slot: 'MAIN', url: ours }] } }
  const p = product({ attributes: [{ name: 'main_product_image_locator', value: `media_location: ${ours}`, source: 'our listing' }] })
  const fields = [{ field: 'Title', live: 'doddl Old title' }, { field: 'Images', live: [{ slot: 'MAIN', url: 'https://m.media-amazon.com/images/I/new.jpg' }] }]
  const held = [
    edit({ now: undefined }),
    edit({ id: 'e2', kind: 'attribute', name: 'main_product_image_locator', value: ours, live: 'https://m.media-amazon.com/images/I/old.jpg' }),
  ]
  const plan = planMarket({ master, market: 'UK', product: p, fields, held })
  assert.equal(plan.changes.length, 0)
  assert.deepEqual(plan.skipped.map(s => s.why).sort(), ['already live', 'already sent; waiting for Amazon to show it'])
})
