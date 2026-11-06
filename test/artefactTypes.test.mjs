import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateArtefact, lineIds, listArtefactTypes } from '../lib/artefactTypes.js'

const ok = (t, a) => assert.deepEqual(validateArtefact(t, a), { valid: true }, `${t} should be valid`)
const bad = (t, a, re) => {
  const r = validateArtefact(t, a)
  assert.equal(r.valid, false, `${t} should be invalid`)
  assert.match(r.error, re)
}

test('the old types validate exactly as before', () => {
  ok('deploy_plan', { summary: 'Ship it', steps: ['a', 'b'] })
  bad('deploy_plan', { summary: 'Ship it' }, /^Missing required field 'steps' for type 'deploy_plan'$/)
  bad('deploy_plan', { summary: 'x', steps: 'a' }, /^Field 'steps' must be an array$/)
  ok('pr_link', { url: 'https://github.com/x/y/pull/1', title: 'PR' })
  bad('pr_link', { url: 1, title: 'PR' }, /^Field 'url' must be a string$/)
  ok('copy', { title: 'T', description: 'D', bullets: [1, 'mixed is fine'] })
  bad('nope', {}, /Unknown artefact_type 'nope'/)
  bad('copy', [], /must be a JSON object/)
  for (const t of ['pr_link', 'deploy_plan', 'copy', 'document', 'design', 'ad_creative', 'video', 'social_pack', 'email', 'listing_change', 'pack']) {
    assert.ok(listArtefactTypes().includes(t), t)
  }
})

test('ad_creative: needs at least one variant with an id; nested fields checked', () => {
  const a = {
    platform: 'meta', campaign: 'Kit grandparents', variants: [
      { id: 'v1', headline: 'Made for little hands', image: { label: 'Kit flat lay', url: null }, checks: [{ result: 'pass', text: 'Brand' }] },
      { id: 'v2', primary_text: 'x' },
    ],
    running_now: [{ name: 'Old ad', spend: '£120', ctr: 1.2 }],
    evidence: [{ text: 'CTR 2x', source: 'Meta' }], after_yes: ['Switch on Mon 06:00'],
  }
  ok('ad_creative', a)
  assert.deepEqual(lineIds('ad_creative', a), ['v1', 'v2'])
  bad('ad_creative', { ...a, variants: [] }, /variants needs at least 1 item/)
  bad('ad_creative', { platform: 'meta' }, /Missing required field 'variants'/)
  bad('ad_creative', { ...a, platform: 'snapchat' }, /platform must be one of meta, tiktok, amazon_sb/)
  bad('ad_creative', { ...a, variants: [{ headline: 'no id' }] }, /variants\[0\]\.id is required/)
  bad('ad_creative', { ...a, variants: [{ id: 'v1', image: { url: 5 } }] }, /variants\[0\]\.image\.url must be a string/)
  bad('ad_creative', { ...a, variants: [{ id: 'v1' }, { id: 'v1' }] }, /used twice/)
  bad('ad_creative', { ...a, checks: [{ result: 'maybe', text: 'x' }] }, /checks\[0\]\.result must be one of pass, check, fix/)
})

test('video: files, frames, beats, deliverables', () => {
  ok('video', {
    title: 'First spoon 15s', duration_s: 15, version: 2, files: { '9:16': 'https://x/v.mp4' },
    frames: [{ t: '0:03', beat: 'Hook' }], beats: [{ label: 'Hook', start_s: 0, end_s: 3 }],
    deliverables: [{ label: '4:5 cut', status: 'missing' }], previous_versions: [{ version: 1, outcome: 'revision_requested' }],
  })
  bad('video', { duration_s: 15 }, /Missing required field 'title'/)
  bad('video', { title: 'x', duration_s: '15s' }, /duration_s must be a number/)
  bad('video', { title: 'x', deliverables: [{ label: 'a', status: 'done' }] }, /deliverables\[0\]\.status must be one of ready, missing/)
  bad('video', { title: 'x', files: ['a'] }, /files must be an object/)
})

test('social_pack: posts are lines; day must be a date', () => {
  const p = { week_start: '2026-11-09', posts: [{ id: 'p1', channel: 'instagram', day: '2026-11-09', caption: 'Hi' }, { id: 'p2', channel: 'tiktok' }] }
  ok('social_pack', p)
  assert.deepEqual(lineIds('social_pack', p), ['p1', 'p2'])
  bad('social_pack', { posts: [] }, /posts needs at least 1 item/)
  bad('social_pack', { posts: [{ id: 'p1' }] }, /posts\[0\]\.channel is required/)
  bad('social_pack', { ...p, week_start: '9 Nov' }, /week_start must be a date/)
})

test('email, listing_change and pack', () => {
  ok('email', { kind: 'campaign', subjects: [{ id: 'a', text: 'Early access', split: 50 }], audience: { segment: 'UK engaged', size: 12000 }, links: [{ url: 'https://doddl.com', ok: true }], smart_sending: true })
  bad('email', { kind: 'blast' }, /kind must be one of campaign, flow/)
  bad('email', { links: [{ where: 'Hero' }] }, /links\[0\]\.url is required/)

  const l = { asin: 'B0TEST', marketplace: 'UK', fields: [{ field: 'Title', live: 'a', should: 'b', status: 'drift' }, { field: 'Bullet 2' }], images: { live: [{ slot: 1, url: 'x' }], should: [] } }
  ok('listing_change', l)
  assert.deepEqual(lineIds('listing_change', l), ['Title', 'Bullet 2'])
  bad('listing_change', { ...l, asin: undefined }, /Missing required field 'asin'/)
  bad('listing_change', { ...l, fields: [{ field: 'Title', status: 'weird' }] }, /fields\[0\]\.status must be one of/)

  const pack = { pack_kind: 'amazon_ads', groups: [{ name: 'Budgets', lines: [{ id: 'l1', target: 'UK auto', before: 20, after: 25, weekly_delta: { currency: 'GBP', amount: 35 } }] }] }
  ok('pack', pack)
  assert.deepEqual(lineIds('pack', pack), ['l1'])
  bad('pack', { ...pack, pack_kind: 'misc' }, /pack_kind must be one of/)
  bad('pack', { pack_kind: 'amazon_ads', groups: [{ name: 'x', lines: [] }] }, /groups\[0\]\.lines needs at least 1 item/)
  bad('pack', { pack_kind: 'amazon_ads', groups: [{ name: 'x', lines: [{ id: 'a', weekly_delta: { currency: 'GBP', amount: '35' } }] }] }, /weekly_delta\.amount must be a number/)
  assert.deepEqual(lineIds('deploy_plan', { summary: 'x', steps: [] }), [])
})
