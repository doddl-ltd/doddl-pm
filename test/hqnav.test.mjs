import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SECTIONS, SECTION, REPORTS, REPORT_TABS, HQ_LINKS, BRAND, HUB_ORIGIN, sectionOf, activeTab, defaultSub, subsOf, hubLink } from '../lib/hq/sections.js'

// Every view pages/index.js can render must sit in exactly one doddlHQ section.
const src = readFileSync(new URL('../pages/index.js', import.meta.url), 'utf8')
const URL_VIEWS = JSON.parse(src.match(/const URL_VIEWS = (\[[^\]]*\])/)[1].replace(/'/g, '"'))

test('eight sections, each in a brand-book colour, each with tabs', () => {
  assert.deepEqual(SECTIONS.map((s) => s.key), ['home', 'projects', 'requests', 'approvals', 'reports', 'studio', 'b2b', 'hq'])
  for (const s of SECTIONS) {
    for (const c of [s.c, s.big, s.acc, s.pip].filter(Boolean)) assert.ok(BRAND.includes(c), `${s.key} uses ${c}, not a brand colour`)
    assert.ok(s.tabs.length >= 2, s.key)
  }
})

test('every view opened by URL belongs to a section, and the right one', () => {
  for (const v of URL_VIEWS) assert.ok(sectionOf(v), v)
  assert.equal(sectionOf('idea').key, 'requests')
  assert.equal(sectionOf('mailboxes').key, 'b2b')
  assert.equal(sectionOf('calendar').key, 'studio')
  assert.equal(sectionOf('approvers').key, 'approvals')
  assert.equal(sectionOf('nonsense').key, 'home')
})

test('a view and sub-tab light the right tab; inner Requests steps light their parent tab', () => {
  assert.equal(activeTab('reports', 'finance').label, 'Finance and inventory')
  assert.equal(activeTab('requests', 'form').key, 'new')
  assert.equal(activeTab('requests', 'detail').key, 'board')
  assert.equal(activeTab('board').label, 'All projects')
  assert.equal(defaultSub('reports'), 'dashboard')
  assert.equal(defaultSub('mywork'), null)
  assert.ok(subsOf('requests').includes('detail'))
  assert.ok(!subsOf('reports').includes('form'))
})

test('reports: every Hub link is a /hub path, unique within its tab; stock lives in Finance and inventory', () => {
  assert.deepEqual(REPORT_TABS, ['dashboard', 'ecommerce', 'marketing', 'finance', 'mine'])
  for (const k of REPORT_TABS) {
    const paths = REPORTS[k].groups.flatMap((g) => g.items.map((i) => i[1]))
    for (const p of paths) assert.match(p, /^\/hub(\/[a-z0-9-]+)*$/, p)
    assert.equal(new Set(paths).size, paths.length, `${k} lists a report twice`)
  }
  const ecommerce = REPORTS.ecommerce.groups.flatMap((g) => g.items.map((i) => i[1]))
  assert.ok(!ecommerce.includes('/hub/amazon/stock'))
  assert.ok(REPORTS.finance.groups.some((g) => g.items.some((i) => i[1] === '/hub/amazon/stock')))
  assert.ok(ecommerce.length >= 10, 'Ecommerce has its 10+ reports')
  for (const l of Object.values(HQ_LINKS).flat()) assert.match(l[1], /^\/hub/)
  assert.equal(hubLink('/hub'), HUB_ORIGIN + '/hub')
  for (const t of SECTION.reports.tabs) if (t.sub !== 'mine') assert.ok(t.href.startsWith(HUB_ORIGIN + '/hub'), t.href)
  for (const t of SECTION.hq.tabs) assert.ok(t.href.startsWith(HUB_ORIGIN + '/hub/'), t.href)
})

test('the rail opens each section on its first tab', () => {
  assert.equal(SECTION.reports.tabs[0].sub, 'dashboard')
  assert.equal(SECTION.requests.tabs[0].sub, 'new')
  assert.equal(SECTION.home.tabs[0].view, 'home')
})
