// scripts/dev-journey-seo-expansion.js
//
// "Developmental Journey — Website" project (id 10000000-...0009) — SEO expansion:
//
//   STEP 1 — Mark 3 Phase 1A audit tasks as done (matched by title prefix in
//            the "Phase 0 — Shopify & Environment Setup" group).
//   STEP 2 — Update existing [SE-01]..[SE-08] tasks with new assigned_to,
//            notes, and priority.
//   STEP 3 — Create 5 new task groups after the existing "SEO" group:
//              A. Schema Implementation
//              B. On-Page Content & Copy
//              C. E-E-A-T & Expert Signals
//              D. LLM & GEO Optimisation
//              E. Keyword Research — All Markets
//            Existing groups at positions ≥ SEO+1 are shifted +5 to make room.
//   STEP 4 — Insert 59 new tasks across the 5 groups.
//
// Hard Rule 2: writes via PostgREST service-role client.
// Idempotent: re-running is safe (skips updates that already match, skips
// group inserts where name exists, skips task inserts where title exists).
//
// Run: node scripts/dev-journey-seo-expansion.js <staging|production|both>

const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

function loadDotEnv(p) {
  if (!fs.existsSync(p)) return
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('='); if (eq === -1) continue
    const k = line.slice(0, eq).trim(); let v = line.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
loadDotEnv(path.join(process.cwd(), '.env.local'))

const PROJECT_ID = '10000000-0000-0000-0000-000000000009'
const PHASE0_GROUP_NAME = 'Phase 0 — Shopify & Environment Setup'
const SEO_GROUP_NAME = 'SEO'
const STAGING_URL = 'https://iknwprxycshrickpswjz.supabase.co'
const PROD_URL    = 'https://ikcjciscttsvpxoijnqe.supabase.co'

// ---- STEP 1: 3 tasks to mark done in Phase 0, matched by title prefix ----
const STEP1_TITLES = [
  'Run CWV benchmark on live site',
  'Crawl live hreflang and canonical tags',
  'Extract and document all current schema markup',
]

// ---- STEP 2: SE-01..SE-08 updates ----
const STEP2_UPDATES = {
  'SE-01': { assigned_to: 'Jon', priority: 'critical',
    notes: '[SE-01] UK keyword research: full audit using Search Console + keyword tool. US keyword research: American English equivalents (silverware not cutlery, starting solids not weaning). DE keyword research: German parent terminology — use native speaker to validate. Create keyword brief per new page type mapping UK/US/DE terms before any copy is written. All three are critical blockers before copy is written.' },
  'SE-02': { assigned_to: 'Jon', priority: 'critical',
    notes: '[SE-02] Homepage H1 currently reads Doddl Ltd — zero keyword value. Fix to keyword-rich developmental headline (Claude Code). Homepage meta is 275 chars — rewrite under 160 (Jon). Collection title tags too short at 36 chars — update template to include age range and stage number (Claude Code). Blog article titles too short at 35 chars (Claude Code). Write custom title tags for all 18 new pages — do not rely on page title fallback (Jon). US title tags: review American English terminology (Jon + Claude Code).' },
  'SE-03': { assigned_to: 'Claude', priority: 'critical',
    notes: '[SE-03] Critical gaps on live site: Organization + WebSite + SearchAction missing from homepage. CollectionPage + ItemList missing from all collections. Article + datePublished missing from all 126 blog articles. Person schema missing for all experts. MerchantReturnPolicy + ShippingDetails missing from PDPs. FAQPage missing everywhere. speakable missing everywhere. All must be added per Claude Code tasks in SEO audit workstreams 1 and 5.' },
  'SE-04': { assigned_to: 'Jon', priority: 'high',
    notes: '[SE-04] Blog articles only link via global navigation — zero contextual in-body links. Build navigation Liquid for all 6 new sections (Claude Code). Add contextual links from Tips articles to Stage collections (both Jon + Claude Code). Add next/previous stage navigation to all Stage collection pages (Claude Code). Apply blog article tags to all 126 articles to enable cluster navigation (Jon — 5 hrs). Build blog tag cluster landing pages (Claude Code).' },
  'SE-05': { assigned_to: 'Laura', priority: 'high',
    notes: '[SE-05] Audit all product image alt text via Shopify bulk export (Laura). Populate missing alt text — format: [product name] — [colour/variant] — [use case/age] (Laura). Add German alt text for DE market images in Translate & Adapt (Laura). Verify hero image has fetchpriority=high and is not lazy-loaded — LCP impact (Claude Code). Bulk audit images missing alt text across all page types (Claude Code).' },
  'SE-06': { assigned_to: 'Claude', priority: 'high',
    notes: '[SE-06] Baseline CWV captured in Phase 1A audit. Compare LCP/CLS/INP after new theme build. Verify hero image fetchpriority=high. Ensure no new render-blocking assets added in new page templates. Post-launch: run CWV field data check at Week 2 comparing CrUX vs baseline.' },
  'SE-07': { assigned_to: 'Claude', priority: 'high',
    notes: '[SE-07] All canonical tags must be self-referential on new page types. Bulk noindex check across all 170+ pages to confirm no pages accidentally blocked. Check paginated collection pages for duplicate content. Verify robots.txt does not block new page types after go-live. Validate in Phase 1D QA crawl.' },
  'SE-08': { assigned_to: 'Jon', priority: 'high',
    notes: '[SE-08] Add Search Console property for doddl.com (domain property if not already set). Add Search Console property for doddl.com/en-us/ after URL prefix is activated — URL prefix property type. Phase 2: Add doddl.com/de/ property and submit Change of Address from doddlbaby.de. Request indexing for all 18 new URLs via URL Inspection post go-live. Set up weekly GSC monitoring for Coverage + Performance across all three market properties.' },
}

// ---- STEP 3 & 4: New groups + tasks ----
const NEW_GROUPS = [
  {
    name: 'Schema Implementation',
    tasks: [
      { title: 'Add Organization + WebSite + SearchAction schema to homepage (theme.liquid)', assigned_to: 'Claude', priority: 'critical', notes: 'Single most important LLM signal missing. Establishes brand entity for all AI systems. Blocks all GEO work.' },
      { title: 'Fix undefined schema block on homepage causing parser errors', assigned_to: 'Claude', priority: 'critical', notes: 'Silently failing validation. Fix before any other schema work.' },
      { title: 'Add CollectionPage + ItemList schema to all collection templates (collection.liquid)', assigned_to: 'Claude', priority: 'critical', notes: '' },
      { title: 'Add FAQPage schema to all collection templates', assigned_to: 'Claude', priority: 'high', notes: 'Highest leverage AI Overview signal. Requires FAQ content from Laura first.' },
      { title: 'Add Article + datePublished + dateModified schema to all blog article templates (article.liquid)', assigned_to: 'Claude', priority: 'critical', notes: '126 articles currently missing freshness signals entirely.' },
      { title: 'Add Person schema for all cited experts — Charlotte Stirling-Reed, Stacey Zimmels, Katia Balducci, Penelope Henderson, Colleen Sarrazin', assigned_to: 'Claude', priority: 'high', notes: 'Create as reusable schema snippet. Include jobTitle, affiliation, sameAs fields.' },
      { title: 'Add MerchantReturnPolicy schema to PDP template', assigned_to: 'Claude', priority: 'high', notes: 'Required for Shopping rich results.' },
      { title: 'Add ShippingDetails schema to PDP — UK (GBP), US (USD), DE (EUR) variants per market', assigned_to: 'Claude', priority: 'high', notes: 'Use Shopify Markets Liquid logic to serve correct currency and carrier per market.' },
      { title: 'Add speakable schema to homepage', assigned_to: 'Claude', priority: 'critical', notes: 'Mark single most important brand statement paragraph.' },
      { title: 'Add speakable schema to Research & Dev hub and SEN feeding journey hub', assigned_to: 'Claude', priority: 'high', notes: 'Mark expert-backed opening paragraphs. German speakable must wrap German paragraphs separately.' },
      { title: 'Add FAQPage schema to all SEN journey pages and MDB stage pages', assigned_to: 'Claude', priority: 'high', notes: 'Build into page template on day one — not retrofitted.' },
      { title: 'Add HowTo schema to instructional blog articles', assigned_to: 'Claude', priority: 'medium', notes: 'Applies to articles like introducing solids, how to use doddl plate.' },
      { title: 'Add Handelsregister sameAs link to Organization schema for DE market', assigned_to: 'Claude', priority: 'medium', notes: '' },
      { title: 'Validate all schema on all 4 page types using Google Rich Results Test', assigned_to: 'Claude', priority: 'high', notes: 'Run after every schema addition. Include homepage, PDP, collection, blog article.' },
      { title: 'Set up US-specific schema variants — USD pricing, US shipping and return values', assigned_to: 'Claude', priority: 'high', notes: 'Use Shopify Markets Liquid conditional logic.' },
      { title: 'Verify DE schema serves correct EUR values and de-DE language property via Translate & Adapt', assigned_to: 'Laura', priority: 'high', notes: '' },
    ],
  },
  {
    name: 'On-Page Content & Copy',
    tasks: [
      { title: 'Fix homepage H1 from "Doddl Ltd" to keyword-rich developmental positioning headline', assigned_to: 'Claude', priority: 'critical', notes: 'H1 is currently the company legal name — strongest on-page ranking signal completely wasted.' },
      { title: 'Rewrite homepage meta description — currently 275 chars, rewrite under 160 chars reflecting developmental positioning', assigned_to: 'Jon', priority: 'critical', notes: '' },
      { title: 'Update collection title tag template — add age range and stage number format: [Product] Stage [N] ([Age]) | doddl', assigned_to: 'Claude', priority: 'high', notes: 'Current collection title tags average 36 chars — too short.' },
      { title: 'Update blog article title tag template — add keyword context', assigned_to: 'Claude', priority: 'high', notes: 'Current blog title tags average 35 chars.' },
      { title: 'Write custom title tags for all 18 new pages — do not use page title fallback', assigned_to: 'Jon', priority: 'high', notes: '' },
      { title: 'US title tags — review American English terminology across all /en-us/ templates', assigned_to: 'Jon', priority: 'high', notes: 'silverware not cutlery, starting solids not weaning, mom not mum.' },
      { title: 'DE title tags — verify German title tags populated in Translate & Adapt for all products and new pages', assigned_to: 'Laura', priority: 'high', notes: '' },
      { title: 'Trim PDP meta description template to under 160 chars — currently generates 239 chars', assigned_to: 'Claude', priority: 'high', notes: '' },
      { title: 'Write meta descriptions for all 18 new pages — unique, intent-matched, under 160 chars', assigned_to: 'Jon', priority: 'high', notes: '' },
      { title: 'US meta descriptions — American English CTR hooks, US-specific trust signals', assigned_to: 'Jon', priority: 'high', notes: '' },
      { title: 'DE meta descriptions — verify all 18 new pages have German meta in Translate & Adapt before go-live', assigned_to: 'Laura', priority: 'high', notes: '' },
      { title: 'Fix PDP H2 hierarchy — expert names (Penelope Henderson etc.) are H2, should be H3 under "What the experts think" H2', assigned_to: 'Claude', priority: 'high', notes: '' },
      { title: 'Add H2 structure to all 126 blog article templates — zero H2s found on crawled article', assigned_to: 'Claude', priority: 'critical', notes: '' },
      { title: 'Add H2 structure to all collection page templates — zero H2s on baby cutlery collection', assigned_to: 'Claude', priority: 'high', notes: '' },
      { title: 'Write 200+ words of unique introductory copy for each existing collection page', assigned_to: 'Laura', priority: 'critical', notes: 'Baby cutlery collection has only 189 total words including nav and footer. Collections ranking well have 300-500 words.' },
      { title: 'Write body copy for all 18 new pages — minimum 300 words per page, H2 structured', assigned_to: 'Laura', priority: 'critical', notes: '' },
      { title: 'Write FAQ content for all collection pages and new stage pages — 4-6 questions each, direct-answer format', assigned_to: 'Laura', priority: 'high', notes: 'Feeds FAQPage schema. Must be completed before schema tasks A4 and A11 can be wired up.' },
      { title: 'Add direct-answer opening paragraphs to existing blog articles — LLMs favour answer-first content', assigned_to: 'Laura', priority: 'medium', notes: 'Ongoing workstream post-launch.' },
      { title: 'DE copy — translate all 18 new page body copy to German via Translate & Adapt after UK copy finalised', assigned_to: 'Laura', priority: 'critical', notes: 'Must be complete before go-live. German parents will see English on all new pages without this.' },
      { title: 'Audit all product image alt text — Shopify bulk export and check all alt text fields', assigned_to: 'Laura', priority: 'high', notes: '' },
      { title: 'Populate missing product image alt text — format: [product name] — [colour] — [use case/age]', assigned_to: 'Laura', priority: 'high', notes: '' },
      { title: 'Add German alt text for DE market images in Translate & Adapt', assigned_to: 'Laura', priority: 'high', notes: '' },
      { title: 'Review existing product descriptions for word count — flag any PDPs under 300 words', assigned_to: 'Claude', priority: 'medium', notes: '' },
    ],
  },
  {
    name: 'E-E-A-T & Expert Signals',
    tasks: [
      { title: 'Add visible publication date to all 126 blog article pages — hidden dates weaken E-E-A-T', assigned_to: 'Claude', priority: 'critical', notes: '' },
      { title: 'Add visible author attribution to all 126 blog articles — byline plus Person schema', assigned_to: 'Claude', priority: 'critical', notes: '' },
      { title: 'Add sameAs links to expert Person schema entities — LinkedIn, NHS profile, university pages where available', assigned_to: 'Jon', priority: 'high', notes: 'Research required. Add as Shopify metafields then reference in Claude Code schema snippet.' },
      { title: 'Update /pages/what-the-experts-think — add Person schema for each expert with credentials, job title, sameAs', assigned_to: 'Claude', priority: 'high', notes: '' },
      { title: 'Add sameAs links to Organization schema — Wikidata, Companies House, Crunchbase', assigned_to: 'Jon', priority: 'medium', notes: 'Register on Wikidata if not already present.' },
      { title: 'Review /pages/about — ensure Organization schema, founding date, registered address, employee signals present', assigned_to: 'Jon', priority: 'medium', notes: '' },
      { title: 'Source 2-3 US-based expert citations for US market credibility', assigned_to: 'Jon', priority: 'low', notes: 'US dietitian or OT. Phase 2 workstream.' },
      { title: 'Source 2-3 German/EU-based expert citations for DE market', assigned_to: 'Jon', priority: 'low', notes: 'Phase 2 workstream after DE migration.' },
      { title: 'Apply blog article tags to all 126 articles — stage-0-1, stage-1-2, stage-2-4, general — enables cluster navigation', assigned_to: 'Laura', priority: 'high', notes: 'Estimated 5 hours in Shopify Admin blog editor. High leverage for internal linking and LLM topic authority.' },
    ],
  },
  {
    name: 'LLM & GEO Optimisation',
    tasks: [
      { title: 'Add FAQPage schema to all collection pages — highest leverage AI Overview signal', assigned_to: 'Claude', priority: 'critical', notes: 'Blocked until Laura writes FAQ content (Task B17).' },
      { title: 'Write FAQ content sections for all collection pages and new page types — 4-6 questions, direct-answer format', assigned_to: 'Laura', priority: 'critical', notes: 'US collections need American English FAQ language. DE needs German translation.' },
      { title: 'Reformat existing blog articles to lead with direct answer paragraph — LLMs extract answer-first content more reliably', assigned_to: 'Laura', priority: 'high', notes: 'Ongoing. Start with highest-traffic articles first.' },
      { title: 'Add sameAs entity links to Organization schema — Wikidata, Companies House, Crunchbase, Google Knowledge Graph', assigned_to: 'Jon', priority: 'high', notes: '' },
      { title: 'Ensure Research & Dev hub cites external authoritative sources with source attribution', assigned_to: 'Laura', priority: 'high', notes: 'LLMs favour citeable content. Include study references and expert source links.' },
      { title: 'Add HowTo schema to qualifying instructional blog articles', assigned_to: 'Claude', priority: 'high', notes: 'Target: introducing solids articles, how to use doddl plate, fine motor development guides.' },
      { title: 'German speakable schema — wrap German paragraphs separately on DE pages via Translate & Adapt', assigned_to: 'Claude', priority: 'medium', notes: 'Phase 2 workstream — after DE migration.' },
    ],
  },
  {
    name: 'Keyword Research — All Markets',
    tasks: [
      { title: 'UK keyword research — full audit of target terms per new page type using Search Console and keyword tool', assigned_to: 'Jon', priority: 'critical', notes: 'Output: keyword brief document mapping target terms per page. Required before Laura writes any copy.' },
      { title: 'US keyword research — American English equivalents for all UK terms', assigned_to: 'Jon', priority: 'critical', notes: 'Key differences: starting solids not weaning, silverware not cutlery, mom not mum, picky eater more common than fussy eater. Zero US organic presence — build from scratch.' },
      { title: 'DE keyword research — German parent terminology by topic area — use native German speaker to validate search intent', assigned_to: 'Jon', priority: 'critical', notes: 'Key terms: Beikost, Babybesteck, Kinderbesteck, Selbstständig essen, Feinmotorik. German translations of UK copy will not match German search intent.' },
      { title: 'Create keyword brief per new page type — one document mapping UK / US / DE target terms per page before any copy is written', assigned_to: 'Jon', priority: 'critical', notes: 'All 18 new pages need a brief. This is a prerequisite for tasks B15 and B16.' },
    ],
  },
]

async function getProdKey() {
  const VC_TOKEN = process.env.VERCEL_TOKEN
  if (!VC_TOKEN) throw new Error('Missing VERCEL_TOKEN')
  const listResp = await fetch('https://api.vercel.com/v10/projects/doddl-pm/env', {
    headers: { Authorization: `Bearer ${VC_TOKEN}` }
  })
  if (!listResp.ok) throw new Error(`Vercel list env: ${listResp.status}`)
  const { envs } = await listResp.json()
  const meta = envs.find(e => e.key === 'SUPABASE_SERVICE_ROLE_KEY' && (e.target || []).includes('production'))
  if (!meta) throw new Error('No production-scoped SUPABASE_SERVICE_ROLE_KEY on Vercel')
  const oneResp = await fetch(`https://api.vercel.com/v1/projects/doddl-pm/env/${meta.id}?decrypt=true`, {
    headers: { Authorization: `Bearer ${VC_TOKEN}` }
  })
  if (!oneResp.ok) throw new Error(`Vercel get env: ${oneResp.status}`)
  const body = await oneResp.json()
  if (!body.value) throw new Error('Empty value from Vercel')
  return body.value
}

async function applyToEnv(label, url, key) {
  console.log(`\n========== ${label} (${url.replace('https://','').split('.')[0]}) ==========`)
  const sb = createClient(url, key, { auth: { persistSession: false } })

  const { data: proj, error: pErr } = await sb.from('projects').select('id,name').eq('id', PROJECT_ID).maybeSingle()
  if (pErr) throw pErr
  if (!proj) throw new Error(`Project ${PROJECT_ID} not found in ${label}`)
  console.log(`  ✓ project: ${proj.name}`)

  // ---------- STEP 1 ----------
  const { data: ph0g, error: pgErr } = await sb.from('task_groups').select('id').eq('project_id', PROJECT_ID).eq('name', PHASE0_GROUP_NAME).maybeSingle()
  if (pgErr) throw pgErr
  if (!ph0g) throw new Error(`Phase 0 group not found in ${label}`)
  const { data: ph0Tasks, error: ptErr } = await sb.from('tasks').select('id, title, status, progress').eq('group_id', ph0g.id)
  if (ptErr) throw ptErr

  let s1Updated = 0, s1Already = 0, s1Missing = []
  for (const t of STEP1_TITLES) {
    const match = ph0Tasks.find(x => x.title.startsWith(t))
    if (!match) { s1Missing.push(t); continue }
    if (match.status === 'done' && match.progress === 100) { s1Already++; continue }
    const { error } = await sb.from('tasks').update({ status: 'done', progress: 100, updated_at: new Date().toISOString() }).eq('id', match.id)
    if (error) throw error
    s1Updated++
  }
  console.log(`  STEP 1: ${s1Updated} updated, ${s1Already} already done` + (s1Missing.length ? `, MISSING: ${s1Missing.join(' / ')}` : ''))

  // ---------- STEP 2 ----------
  const { data: allTasks, error: atErr } = await sb.from('tasks').select('id, title, notes, assigned_to, priority').eq('project_id', PROJECT_ID)
  if (atErr) throw atErr
  let s2Updated = 0, s2Already = 0, s2Missing = []
  for (const [code, upd] of Object.entries(STEP2_UPDATES)) {
    const match = allTasks.find(t => (t.notes || '').startsWith(`[${code}]`))
    if (!match) { s2Missing.push(code); continue }
    const same = match.assigned_to === upd.assigned_to && match.priority === upd.priority && match.notes === upd.notes
    if (same) { s2Already++; continue }
    const { error } = await sb.from('tasks').update({
      assigned_to: upd.assigned_to, priority: upd.priority, notes: upd.notes,
      updated_at: new Date().toISOString(),
    }).eq('id', match.id)
    if (error) throw error
    s2Updated++
  }
  console.log(`  STEP 2: ${s2Updated} updated, ${s2Already} already match` + (s2Missing.length ? `, MISSING: ${s2Missing.join(',')}` : ''))

  // ---------- STEP 3 ----------
  const { data: gs, error: gsErr } = await sb.from('task_groups').select('id, name, position').eq('project_id', PROJECT_ID).order('position')
  if (gsErr) throw gsErr
  const seoGroup = gs.find(g => g.name === SEO_GROUP_NAME)
  if (!seoGroup) throw new Error(`"${SEO_GROUP_NAME}" group not found in ${label}`)
  const seoPos = seoGroup.position

  const existingNewGroups = NEW_GROUPS.map(ng => gs.find(g => g.name === ng.name)).filter(Boolean)
  let groupsCreated = 0
  let groupIdByName = {}

  if (existingNewGroups.length === NEW_GROUPS.length) {
    // All new groups already exist — skip shift, just collect ids.
    for (const ng of NEW_GROUPS) groupIdByName[ng.name] = gs.find(g => g.name === ng.name).id
    console.log(`  STEP 3: all 5 groups already exist — skipping shift and inserts`)
  } else if (existingNewGroups.length > 0 && existingNewGroups.length < NEW_GROUPS.length) {
    throw new Error(`Partial state in ${label}: ${existingNewGroups.length}/${NEW_GROUPS.length} new groups exist — manual cleanup required`)
  } else {
    // None exist — shift existing rows below seoPos by +5, then insert new ones at seoPos+1..seoPos+5
    const toShift = gs.filter(g => g.position > seoPos).sort((a, b) => b.position - a.position) // largest first to avoid unique-position collisions if any
    for (const g of toShift) {
      const { error } = await sb.from('task_groups').update({ position: g.position + 5 }).eq('id', g.id)
      if (error) throw error
    }
    for (let i = 0; i < NEW_GROUPS.length; i++) {
      const { data: created, error } = await sb.from('task_groups').insert({
        project_id: PROJECT_ID, name: NEW_GROUPS[i].name, position: seoPos + 1 + i,
      }).select('id, name, position').single()
      if (error) throw error
      groupIdByName[created.name] = created.id
      groupsCreated++
    }
    console.log(`  STEP 3: shifted ${toShift.length} groups +5, created ${groupsCreated} new groups at positions ${seoPos+1}..${seoPos+NEW_GROUPS.length}`)
  }

  // ---------- STEP 4 ----------
  let totalInserted = 0, totalSkipped = 0
  for (const ng of NEW_GROUPS) {
    const groupId = groupIdByName[ng.name]
    const { data: existingInGroup, error: eErr } = await sb.from('tasks').select('title').eq('group_id', groupId)
    if (eErr) throw eErr
    const existingTitles = new Set(existingInGroup.map(t => t.title))
    let inserted = 0, skipped = 0
    for (let i = 0; i < ng.tasks.length; i++) {
      const t = ng.tasks[i]
      if (existingTitles.has(t.title)) { skipped++; continue }
      const { error } = await sb.from('tasks').insert({
        title: t.title,
        notes: t.notes || null,
        status: 'not_started',
        progress: 0,
        priority: t.priority,
        assigned_to: t.assigned_to,
        project_id: PROJECT_ID,
        group_id: groupId,
        position: i,
      })
      if (error) throw error
      inserted++
    }
    totalInserted += inserted; totalSkipped += skipped
    console.log(`    ${ng.name}: ${inserted} inserted, ${skipped} skipped (group has ${ng.tasks.length} target tasks)`)
  }
  console.log(`  STEP 4: ${totalInserted} inserted total, ${totalSkipped} skipped`)

  // ---------- VERIFY ----------
  const { count: totalAfter } = await sb.from('tasks').select('id', { count: 'exact', head: true }).eq('project_id', PROJECT_ID)
  const { data: gsAfter } = await sb.from('task_groups').select('id, name, position').eq('project_id', PROJECT_ID).order('position')
  console.log(`  VERIFY: project has ${totalAfter} tasks · ${gsAfter.length} groups`)

  return { label, s1Updated, s1Already, s1Missing, s2Updated, s2Already, s2Missing, groupsCreated, totalInserted, totalSkipped, totalAfter, gsAfter }
}

async function main() {
  const target = process.argv[2]
  if (!['staging','production','both'].includes(target)) {
    console.error('Usage: node scripts/dev-journey-seo-expansion.js <staging|production|both>')
    process.exit(1)
  }

  const reports = []
  if (target === 'staging' || target === 'both') {
    const stagingKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!stagingKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY in .env.local')
    reports.push(await applyToEnv('STAGING', STAGING_URL, stagingKey))
  }
  if (target === 'production' || target === 'both') {
    console.log('\nFetching production service role key from Vercel…')
    const prodKey = await getProdKey()
    console.log('  ✓ retrieved (value not logged)')
    reports.push(await applyToEnv('PRODUCTION', PROD_URL, prodKey))
  }

  console.log('\n========== SUMMARY ==========')
  for (const r of reports) {
    console.log(`${r.label}:`)
    console.log(`  Step 1: ${r.s1Updated} updated, ${r.s1Already} already done`)
    console.log(`  Step 2: ${r.s2Updated} updated, ${r.s2Already} already match`)
    console.log(`  Step 3: ${r.groupsCreated} new groups created`)
    console.log(`  Step 4: ${r.totalInserted} new tasks inserted, ${r.totalSkipped} skipped`)
    console.log(`  Final:  ${r.totalAfter} tasks · ${r.gsAfter.length} groups`)
  }
}

main().catch(e => { console.error('FAIL:', e.message || e); process.exit(1) })
