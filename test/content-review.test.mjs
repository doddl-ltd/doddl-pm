import test from 'node:test'
import assert from 'node:assert/strict'
import { choosePhotos, tidyWords, houseModules, drawPanels, boldParts, searchWords, SHARED_PANELS } from '../lib/pm/aplusHouse.js'
import { storeReady, aplusSections, storeArtefact, aplusArtefact } from '../lib/pm/contentReview.js'
import { validateArtefact, lineIds } from '../lib/artefactTypes.js'
import { aplusProblems, cleanModules } from '../lib/pm/aplusModel.js'
import { agentQueue } from '../lib/pm/listingAgent.js'
import { createCanvas } from '@napi-rs/canvas'

const words = { product_name: 'Toddler Plate', bold_word: 'Plate', promise: 'Helps your child eat from a plate', age_pill: 'For toddlers 12+ months', closeup_headline: 'Strong suction keeps the plate in place', closeup_bold: ['Strong suction'], bullets: ['Wide flat front', 'Raised back', 'Removable suction ring', 'Dishwasher safe'] }

test('photos: best of this product first, then other colours; nothing weak; a missing kind stays empty', () => {
  const s = [
    { n: 0, product: 'same_product_other_colour', kind: 'studio_product', quality: 9 },
    { n: 1, product: 'this_product', kind: 'studio_product', quality: 7 },
    { n: 2, product: 'this_product', kind: 'food_closeup', quality: 3 },
    { n: 3, product: 'other_doddl_product', kind: 'child_using', quality: 10 },
  ]
  const c = choosePhotos(s)
  assert.equal(c.hero.n, 1)
  assert.equal(c.closeup, null)
  assert.equal(c.features, null)
})

test('words: limits kept, bold parts must be inside their sentence', () => {
  const w = tidyWords({ ...words, bold_word: 'Bowl', closeup_bold: ['Strong suction', 'not there'], bullets: ['a', 'b', 'c', 'd', 'e'] })
  assert.equal(w.bold_word, '')
  assert.deepEqual(w.closeup_bold, ['Strong suction'])
  assert.equal(w.bullets.length, 4)
  assert.deepEqual(boldParts('Toddler Plate', ['Plate']), [['Toddler ', false], ['Plate', true]])
  assert.deepEqual(searchWords({ sku: 'DOD053', product: '2-in-1 Strong Suction Plate' }), ['DOD053', 'suction plate', 'plate'])
})

test('house page: drawn panels then the shared ones (English only), designed modules need no headline', () => {
  const panels = { hero: 'https://x/h.png', features: 'https://x/f.png' }
  const uk = houseModules({ panels, locale: 'UK', english: true, words })
  assert.equal(uk.modules.length, 5)
  assert.deepEqual(uk.modules.map(m => m.image), ['h_UK_hero', 'h_UK_features', 'h_shared_independence', 'h_shared_brand', 'h_shared_trust'])
  assert.deepEqual(aplusProblems(cleanModules(uk.modules), uk.images), [])
  const de = houseModules({ panels, locale: 'DE', english: false, words })
  assert.equal(de.modules.length, 2)
  assert.ok(de.images.every(x => !x.id.startsWith('h_shared')))
  assert.equal(SHARED_PANELS.length, 3)
  // a normal header still needs its headline
  assert.ok(aplusProblems(cleanModules([{ type: 'header', headline: '', body: '', image: 'h_UK_hero' }]), uk.images).some(p => /no headline/.test(p)))
})

test('panels draw at 970x600 from loaded images', () => {
  const ph = createCanvas(800, 800); ph.getContext('2d').fillRect(0, 0, 800, 800)
  const out = drawPanels({ words, photos: { hero: ph, closeup: ph, features: ph }, logo: null })
  assert.deepEqual(Object.keys(out), ['hero', 'closeup', 'features'])
  assert.ok(out.hero.length > 1000)
})

test('review cards: valid artefacts, one line per piece', () => {
  const page = { asin: 'B0H6XSBMSD', brief: 'Lead with suction', ...houseModules({ panels: { hero: 'https://x/h.png' }, words }), house: { shot_list: [{ slot: 'closeup', need: 'food' }], library: { searched: 4, previewed: 4 }, cost_usd: 0.02 } }
  const a = aplusArtefact(page, { master_sku: 'DOD053', product: 'Suction Plate' })
  assert.deepEqual(validateArtefact('content_review', a), { valid: true })
  assert.deepEqual(lineIds('content_review', a), a.sections.map(s => s.id))
  const m = { asin: 'B0H6XSBMSD', master_sku: 'DOD053', product: 'Plate', copy: { title: 'Plate', search_terms: 'plate' }, images: { MASTER: [{ url: 'https://m.media-amazon.com/images/I/a.jpg' }, { url: 'https://m.media-amazon.com/images/I/b.jpg' }] }, variants: { DE: { copy: { title: 'Teller', search_terms: 'teller' }, status: 'draft' } } }
  const de = storeArtefact({ master: m, market: 'DE', translations: [{ locale: 'DE', source_url: 'https://m.media-amazon.com/images/I/b.jpg', url: 'https://s/b-de.png', status: 'checked', id: 't1' }], aplus: null })
  assert.deepEqual(validateArtefact('content_review', de), { valid: true })
  assert.equal(de.sections.find(s => s.id === 'copy_title').master_text, 'Plate')
  assert.equal(de.sections.find(s => s.id === 'img_2').translation_id, 't1')
  assert.equal(aplusSections([], []).length, 0)
})

test('a store is ready for review only when the agent has nothing left to make', () => {
  assert.equal(storeReady({ sold: true, copy: { stage: 'you' }, images: [{ stage: 'you' }, { stage: 'approved' }], aplus: { stage: 'you' } }), true)
  assert.equal(storeReady({ sold: true, copy: { stage: 'you' }, images: [{ stage: 'made' }], aplus: null }), false)
  assert.equal(storeReady({ sold: true, copy: { stage: 'todo' }, images: [], aplus: null }), false)
})

test('agent: house A+ pages are translated once Jon and Laura approve the UK page', () => {
  const m = { asin: 'B0H6XSBMSD', status: 'approved', copy: {}, images: { MASTER: [{ url: 'https://m.media-amazon.com/images/I/a.jpg' }] }, variants: { DE: { copy: { title: 'x' } } } }
  assert.deepEqual(agentQueue({ master: m, sold: ['UK', 'DE'], aplus: { status: 'draft', variants: {} } }).map(x => x.kind), [])
  assert.deepEqual(agentQueue({ master: m, sold: ['UK', 'DE'], aplus: { status: 'approved', variants: {} } }).map(x => x.key), ['aplus:DE'])
})
