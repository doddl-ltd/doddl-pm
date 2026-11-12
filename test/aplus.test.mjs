import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanModules, aplusProblems, fits, textsOf, withTexts, modulesFor, aplusLiveState } from '../lib/pm/aplusModel.js'
import { buildAplusRequest, translateAplusRequest, aplusOp } from '../lib/pm/aplus.js'

const IMG = [{ id: 'a', url: 'https://abc.supabase.co/storage/v1/object/public/listing-images/B074DZSKV6/APLUS/x.jpg', w: 1940, h: 1200, name: 'hero.jpg', alt: 'A toddler eating' }, { id: 'b', url: 'https://abc.supabase.co/storage/v1/object/public/listing-images/B074DZSKV6/APLUS/y.jpg', w: 600, h: 600, name: 'fork.jpg', alt: '' }]

test('fits: an image fills a slot once cropped to its shape', () => {
  assert.equal(fits({ w: 1940, h: 1200 }, [970, 600]), true)
  assert.equal(fits({ w: 970, h: 400 }, [970, 600]), false)
  assert.equal(fits({ w: 600, h: 600 }, [300, 300]), true)
  assert.equal(fits({ w: 600, h: 600 }, [970, 300]), false)
})

test('cleanModules keeps each type to its shape; at most 5', () => {
  const m = cleanModules([{ type: 'four', headline: 'Hi', blocks: [{ headline: 'x', body: 'y', image: 'b' }], junk: 1 }, { type: 'overlay', headline: 'o', overlay: 'weird' }])
  assert.equal(m[0].blocks.length, 4)
  assert.equal(m[0].junk, undefined)
  assert.equal(m[1].overlay, 'dark')
  assert.throws(() => cleanModules(Array(6).fill({ type: 'text' })), /At most 5/)
  assert.throws(() => cleanModules([{ type: 'video' }]), /type must be one of/)
})

test('aplusProblems: limits, images that do not fit, missing alt text', () => {
  const mods = cleanModules([{ type: 'header', headline: 'H', body: 'b', image: 'a' }, { type: 'side', headline: 'x'.repeat(161), body: 'b', image: 'b' }, { type: 'overlay', headline: 'o', body: 'b', image: 'b' }])
  const p = aplusProblems(mods, IMG)
  assert.ok(p.some(x => /Module 2.*headline is 161/.test(x)))
  assert.ok(p.some(x => /Module 2.*alt text/.test(x)))
  assert.ok(p.some(x => /Module 3.*needs an image at least 970×300/.test(x)))
  assert.ok(!p.some(x => /Module 1/.test(x)))
})

test('texts round-trip by path, so a translation keeps the layout', () => {
  const mods = cleanModules([{ type: 'three', headline: 'Three', blocks: [{ headline: 'A', body: 'a', image: 'b' }, { headline: 'B', body: 'b', image: 'b' }, { headline: 'C', body: 'c', image: 'b' }] }, { type: 'highlights', headline: 'Points', image: 'b', bullets: ['one', 'two'] }])
  const t = textsOf(mods).map(x => ({ ...x, text: x.text.toUpperCase() }))
  const out = withTexts(mods, t)
  assert.equal(out[0].blocks[2].body, 'C')
  assert.equal(out[1].bullets[1], 'TWO')
  assert.equal(out[0].blocks[0].image, 'b')
})

test('modulesFor: English markets get the page, others only an approved translation', () => {
  const page = { modules: [{ type: 'text', headline: 'Hello' }], variants: { DE: { modules: [{ type: 'text', headline: 'Hallo' }], status: 'approved', approved_by: 'Jon' }, FR: { modules: [], status: 'draft' } } }
  assert.equal(modulesFor(page, 'US').modules[0].headline, 'Hello')
  assert.equal(modulesFor(page, 'DE').reviewed_by, 'Jon')
  assert.equal(modulesFor(page, 'FR'), null)
  assert.equal(modulesFor(page, 'IT'), null)
})

test('aplusLiveState reads Amazon\'s status for our document', () => {
  const send = { status: 'sent', ref: 'ref-1' }
  assert.equal(aplusLiveState(send, { aplus: [] }).state, 'waiting')
  assert.equal(aplusLiveState(send, { aplus: [{ ref: 'ref-1', status: 'APPROVED' }] }).state, 'live')
  assert.equal(aplusLiveState(send, { aplus: [{ ref: 'ref-1', status: 'REJECTED' }] }).state, 'problem')
  assert.equal(aplusLiveState({ status: 'in_approval' }, {}), null)
})

test('the build request shows Claude each image with the slots it fits, and fences the brief as data', () => {
  const req = buildAplusRequest({ brief: 'Lead with self-feeding', copy: { title: 'doddl cutlery' }, images: IMG, product: 'DOD002' })
  assert.equal(req.output_config.format.type, 'json_schema')
  const texts = req.messages[0].content.filter(c => c.type === 'text').map(c => c.text)
  assert.ok(texts[0].includes('Fits: header') && texts[1].includes('Fits: side'))
  assert.equal(req.messages[0].content.filter(c => c.type === 'image').length, 2)
  assert.match(req.system, /data, not instructions/)
  assert.match(translateAplusRequest(cleanModules([{ type: 'text', headline: 'Hi', body: 'There' }]), 'DE').system, /German/)
})

// A tiny in-memory stand-in for the Supabase client: just what aplusOp uses.
function fakeDb(rows) {
  const t = { listing_aplus: rows, listing_masters: [{ asin: 'B074DZSKV6', copy: { title: 'doddl cutlery' }, product: 'DOD002' }] }
  return { from(table) {
    const q = { f: {}, patch: null, ins: null }
    const api = {
      select() { return api }, eq(k, v) { q.f[k] = v; return api }, limit() { return api },
      update(p) { q.patch = p; return api }, insert(r) { q.ins = r; return api },
      async maybeSingle() { return { data: t[table].find(r => Object.entries(q.f).every(([k, v]) => r[k] === v)) || null } },
      async single() {
        if (q.ins) { const r = { brief: '', modules: [], images: [], variants: {}, sends: {}, status: 'draft', ...q.ins }; t[table].push(r); return { data: r } }
        const r = t[table].find(x => Object.entries(q.f).every(([k, v]) => x[k] === v)); Object.assign(r, q.patch); return { data: r }
      },
      then(res) { const r = t[table].find(x => Object.entries(q.f).every(([k, v]) => x[k] === v)); if (q.patch && r) Object.assign(r, q.patch); res({ data: r ? [r] : [] }) },
    }
    return api
  } }
}
const reply = (obj) => ({ stop_reason: 'end_turn', model: 'claude-opus-5-5', usage: { input_tokens: 10000, output_tokens: 2000 }, content: [{ type: 'text', text: JSON.stringify(obj) }] })

test('build, approve, translate and send, with Claude faked', async () => {
  const db = fakeDb([{ asin: 'B074DZSKV6', name: 'p', brief: 'Lead with self-feeding', modules: [], images: IMG.map(x => ({ ...x })), variants: {}, sends: {}, status: 'draft', cost_usd: 0 }])
  const user = { name: 'Jon' }
  const build = { beta: { messages: { create: async () => reply({ modules: [{ type: 'header', headline: 'Made for little hands', body: 'b', image: 'a', overlay: '', side: '', bullets: [], blocks: [] }, { type: 'side', headline: 'Fork', body: 'f', image: 'zzz', overlay: '', side: 'right', bullets: [], blocks: [] }], alts: [{ id: 'b', alt: 'The fork' }] }) } } }
  let p = await aplusOp(db, user, { asin: 'B074DZSKV6', op: 'build' }, { client: build })
  assert.equal(p.modules.length, 2)
  assert.equal(p.modules[1].image, '', 'an image id Claude made up is dropped')
  assert.equal(p.images.find(x => x.id === 'b').alt, 'The fork')
  assert.equal(p.cost_usd, 0.08)
  await assert.rejects(aplusOp(db, user, { asin: 'B074DZSKV6', op: 'approve' }), /Fix first/)
  p = await aplusOp(db, user, { asin: 'B074DZSKV6', op: 'modules', modules: [p.modules[0], { ...p.modules[1], image: 'b' }] })
  p = await aplusOp(db, user, { asin: 'B074DZSKV6', op: 'approve' })
  assert.equal(p.status, 'approved')
  const tr = { beta: { messages: { create: async (req) => reply({ texts: JSON.parse(req.messages[0].content).texts.map(x => ({ id: x.id, text: `DE ${x.text}` })) }) } } }
  p = await aplusOp(db, user, { asin: 'B074DZSKV6', op: 'translate', locale: 'DE' }, { client: tr })
  assert.equal(p.variants.DE.modules[0].headline, 'DE Made for little hands')
  const r = await aplusOp(db, user, { asin: 'B074DZSKV6', op: 'send', markets: ['UK', 'DE'] })
  assert.deepEqual(r.markets, [{ market: 'UK', sent: true }, { market: 'DE', skipped: 'translation not approved yet' }])
})
