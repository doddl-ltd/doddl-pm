import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import { marketImages, masterImages, planMarket, buildTranslateRequest } from '../lib/pm/masterSend.js'
import { rolloutMarket, estimate, worst } from '../lib/pm/rollout.js'
import { agentQueue } from '../lib/pm/listingAgent.js'
import { keywordBrief } from '../lib/pm/keywords.js'
import { paintImage } from '../lib/pm/imageRender.js'
import { eraseText } from '../lib/pm/imagePaint.js'

const img = (n) => `https://m.media-amazon.com/images/I/img${n}.jpg`
const master = (over = {}) => ({ asin: 'B0779CZ9FD', status: 'approved', product: 'Cutlery', copy: { title: 'doddl Toddler Cutlery', bullet_1: 'Easy grip', search_terms: 'toddler cutlery' }, attributes: [], images: { MASTER: [{ url: img(0) }, { url: img(1) }, { url: img(2) }] }, variants: {}, ...over })
const product = (over = {}) => ({ asin: 'B0779CZ9FD', sku: 'DOD004', checked_at: '2026-11-16T07:00:00Z', attributes: [], ...over })
const liveFields = (urls, copy = {}) => [{ field: 'Images', live: urls.map((u, i) => ({ slot: i ? `PT0${i}` : 'MAIN', url: u })) }, ...Object.entries(copy).map(([field, live]) => ({ field, live }))]

test('one master image set: English stores take it as it is; others take approved translations, main image as it is', () => {
  const m = master()
  assert.deepEqual(marketImages(m, 'US').map(x => x.url), [img(0), img(1), img(2)])
  const de = marketImages(m, 'DE', [{ locale: 'DE', source_url: img(1), status: 'approved', url: 'https://x.supabase.co/storage/v1/object/public/listing-images/a/DE/1.png' }, { locale: 'DE', source_url: img(2), status: 'checked', url: 'u' }])
  assert.equal(de[0].url, img(0)); assert.equal(de[0].ready, true)
  assert.match(de[1].url, /DE\/1\.png$/); assert.equal(de[1].ready, true)
  assert.equal(de[2].ready, false); assert.equal(de[2].translation, 'checked')
  assert.deepEqual(masterImages({ images: { UK: [{ url: img(9) }] } }).map(x => x.url), [img(9)], 'older masters: the UK set is the master set')
})

test('the planner never sends an English image to a store still waiting for its translation', () => {
  const plan = planMarket({ master: master(), market: 'FR', product: product(), fields: liveFields([img(0), img(7), img(8)]), held: [], translations: [] })
  assert.equal(plan.changes.filter(c => c.image).length, 0)
  assert.deepEqual(plan.skipped.filter(s => /image/.test(s.why)).map(s => s.name), ['Image 1', 'Image 2'])
})

test('rollout stages: live only when Amazon shows it; made / needs you / ready to push before that', () => {
  const uk = rolloutMarket({ master: master({ categories: { UK: { node: '26119033031', status: 'approved', keep: true } } }), market: 'UK', product: product({ attributes: [{ name: 'recommended_browse_nodes', value: '26119033031', source: 'our listing' }] }), fields: liveFields([img(0), img(1), img(2)], { Title: 'doddl Toddler Cutlery', 'Bullet 1': 'Easy grip', 'Search terms': 'toddler cutlery' }) })
  assert.equal(uk.images.every(x => x.stage === 'live'), true)
  assert.equal(uk.copy.stage, 'live')
  assert.equal(uk.done, true)
  const us = rolloutMarket({ master: master(), market: 'US', product: product(), fields: liveFields([img(0), img(5), img(2)], { Title: 'old' }) })
  assert.equal(us.images[1].stage, 'approved')
  assert.equal(us.copy.stage, 'approved')
  assert.equal(us.done, false)
  assert.ok(us.to_push > 0)
  const started = master({ rollout: { started_at: '2026-11-16T10:00:00Z' } })
  const de = rolloutMarket({ master: started, market: 'DE', product: product(), fields: liveFields([img(0)]), translations: [{ id: 't1', locale: 'DE', source_url: img(1), status: 'checked', url: 'u1' }] })
  assert.equal(de.images[0].stage, 'live', 'main image: never translated, already on Amazon')
  assert.equal(de.images[1].stage, 'you')
  assert.equal(de.images[2].stage, 'made')
  assert.equal(de.copy.stage, 'made')
  assert.match(de.next, /needs? you/)
  const nl = rolloutMarket({ master: master({ status: 'draft' }), market: 'NL', product: product(), fields: [] })
  assert.equal(nl.images[1].stage, 'todo')
  assert.equal(nl.pieces.you, 0, 'an unapproved master is one job (approve it), not one per piece')
  assert.match(nl.next, /Waits for the master/)
  assert.equal(rolloutMarket({ master: master(), market: 'PL', product: null }).sold, false)
  assert.equal(us.category.stage, 'you', 'a store with no category set needs a person')
  const fr = rolloutMarket({ master: master({ categories: { FR: { node: '525747031', title: 'Couverts', status: 'approved' } } }), market: 'FR', product: product({ attributes: [{ name: 'recommended_browse_nodes', value: '26119038031 | 3966362031', source: 'our listing' }] }), fields: [] })
  assert.equal(fr.category.stage, 'approved', 'an approved category that differs is ready to push')
  assert.ok(planMarket({ master: master({ categories: { FR: { node: '525747031', status: 'approved' } } }), market: 'FR', product: product(), fields: [], held: [] }).changes.some(c => c.name === 'recommended_browse_nodes' && c.to === '525747031'))
  assert.equal(worst(['live', 'sent', 'problem']), 'problem')
})

test('an image sent and still wrong after 72 hours is an Amazon problem', () => {
  const ours = 'https://abc.supabase.co/storage/v1/object/public/listing-images/B0779CZ9FD/MASTER/x.png'
  const m = master({ images: { MASTER: [{ url: img(0) }, { url: ours }] } })
  const edits = [{ id: 'e', status: 'sent', kind: 'attribute', name: 'other_product_image_locator_1', value: ours, live: img(4), sent_at: '2026-11-10T08:00:00Z' }]
  const r = rolloutMarket({ master: m, market: 'UK', product: product(), fields: liveFields([img(0), img(4)]), edits, now: new Date('2026-11-16T09:00:00Z') })
  assert.equal(r.images[1].stage, 'problem')
  assert.match(r.next, /Amazon problem/)
})

test('the agent queue: translations first, then images not made yet, then A+ once approved; never English stores', () => {
  const q = agentQueue({ master: master({ variants: { FR: { status: 'draft' } } }), sold: ['UK', 'US', 'DE', 'FR'], translations: [{ locale: 'DE', source_url: img(1), status: 'checked' }, { locale: 'DE', source_url: img(2), status: 'read' }], aplus: { status: 'approved', variants: {} } })
  assert.deepEqual(q.map(x => x.key), ['copy:DE', `image:DE:${img(2)}`, `image:FR:${img(1)}`, `image:FR:${img(2)}`, 'aplus:DE', 'aplus:FR'])
  assert.equal(agentQueue({ master: master(), sold: ['DE'], fails: { 'copy:DE': 3 } }).some(x => x.key === 'copy:DE'), false, 'gives up after 3 failures')
  const e = estimate(master(), ['UK', 'DE', 'FR'], [])
  assert.equal(e.images, 4); assert.equal(e.translations, 2); assert.ok(e.usd > 0 && e.budget >= e.usd)
})

test('keywords: Brand Analytics searches go into the translation prompt; no data says so', () => {
  const kw = { basis: 'product', period_from: '2026-06-01', period_to: '2026-08-01', terms: [{ search_query: 'kinderbesteck', query_volume: 75409, asin_impressions: 3515, asin_clicks: 34, asin_purchases: 2 }] }
  const req = buildTranslateRequest(master(), 'DE', 'claude-opus-5-5', kw)
  assert.match(req.system, /kinderbesteck \| 75409 \| 3515 \| 34 \| 2/)
  assert.match(req.system, /Brand Analytics/)
  assert.ok(req.output_config.format.schema.required.includes('keywords_used'))
  assert.match(keywordBrief({ basis: 'none', terms: [] }, 'IT', 'Italian'), /no Brand Analytics data/)
})

test('the eraser takes off only the letters: the curve of a shape behind them stays', () => {
  const W = 120, H = 60, d = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, inShape = (x - 60) ** 2 + (y - 80) ** 2 < 60 ** 2   // a purple circle's top edge under teal
    const c = inShape ? [148, 127, 182] : [158, 207, 198]
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255
  }
  const before = d.slice()
  for (let y = 30; y < 36; y++) for (let x = 40; x < 80; x++) { const i = (y * W + x) * 4; d[i] = 255; d[i + 1] = 255; d[i + 2] = 255 }   // white words
  eraseText(d, W, H, { x: 30, y: 20, w: 60, h: 30 }, '#ffffff', '#947FB6')
  let off = 0
  for (let i = 0; i < d.length; i += 4) off = Math.max(off, Math.abs(d[i] - before[i]) + Math.abs(d[i + 1] - before[i + 1]) + Math.abs(d[i + 2] - before[i + 2]))
  assert.ok(off < 40, 'within a few shades of the picture without the words (got ' + off + ')')
})

test('the server repaint takes the old words off and sets the translation', async () => {
  const c = createCanvas(400, 200), x = c.getContext('2d')
  x.fillStyle = '#C9B6F2'; x.fillRect(0, 0, 400, 200)
  x.fillStyle = '#3D157D'; x.fillRect(40, 70, 6, 20); x.fillRect(340, 70, 6, 20)   // old letters at both ends of the line
  const block = { text: 'Easy grip for little hands', translated: 'Griff', x: 0.1, y: 0.3, w: 0.8, h: 0.2, color: '#3D157D', background: '#C9B6F2', weight: 'bold', align: 'center', line_height: 0.2 }
  const { png } = await paintImage(c.toBuffer('image/png'), [block])
  const { loadImage } = await import('@napi-rs/canvas')
  const out = await loadImage(png), c2 = createCanvas(400, 200), y = c2.getContext('2d')
  y.drawImage(out, 0, 0)
  const ink = (x0) => { const d = y.getImageData(x0, 70, 6, 20).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 120) n++; return n }
  assert.equal(ink(40) + ink(340), 0, 'the old letters at the ends are gone')
  const mid = y.getImageData(150, 60, 100, 40).data
  let n = 0
  for (let i = 0; i < mid.length; i += 4) if (mid[i] < 120 && mid[i + 2] > 80) n++
  assert.ok(n > 100, 'the translation is drawn in the middle')
})
