// scripts/dev-journey-phase0-update.js
//
// Update the "Developmental Journey — Website" project (id 10000000-...0009)
// in both staging and production:
//
//   STEP 1 — Mark 9 specific tasks (matched by notes prefix [X-NN]) as
//            status='done', progress=100.
//   STEP 2 — Insert a new task_group "Phase 0 — Shopify & Environment Setup"
//            at position 0.
//   STEP 3 — Insert 16 new tasks under that group.
//
// Hard Rule 2: writes go through PostgREST service-role (Supabase client).
// Operating Rule 4 explicitly permits service-role-client task PM updates;
// user has explicitly authorised this scoped operation against both DBs.
//
// Idempotent: re-running is safe.
//   - Step 1 skips tasks already at done/100.
//   - Step 2 skips group if a row with the same name exists in the project.
//   - Step 3 skips tasks whose title already exists in that group.
//
// Run: node scripts/dev-journey-phase0-update.js staging
//      node scripts/dev-journey-phase0-update.js production

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
const NEW_GROUP_NAME = 'Phase 0 — Shopify & Environment Setup'

const STAGING_URL = 'https://iknwprxycshrickpswjz.supabase.co'
const PROD_URL    = 'https://ikcjciscttsvpxoijnqe.supabase.co'

const STEP1_TARGETS = ['U-01','U-02','U-08','U-10','N-01','N-06','S-02','S-03','S-10']

const STEP3_TASKS = [
  { title: 'Uninstall BoostMark (BM Country Blocker)',
    notes: 'Shopify Admin → Apps. Blocks: correct geo-routing.', priority: 'critical', assigned_to: 'Jon', due_date: '2026-05-01' },
  { title: 'Remove French and Spanish languages',
    notes: 'Shopify Admin → Settings → Languages.', priority: 'critical', assigned_to: 'Jon', due_date: '2026-05-01' },
  { title: 'Create dedicated US catalog in USD',
    notes: 'Admin → Markets → Catalogs.', priority: 'critical', assigned_to: 'Jon', due_date: '2026-05-01' },
  { title: 'Assign USD catalog to United States market',
    notes: 'Remove from Eurozone 1.', priority: 'critical', assigned_to: 'Jon', due_date: '2026-05-01' },
  { title: 'Remove doddl.com/de as serving domain for Germany',
    notes: 'Admin → Markets → Germany → Domains.', priority: 'critical', assigned_to: 'Jon', due_date: '2026-05-01' },
  { title: 'Install Shopify CLI',
    notes: 'npm install -g @shopify/cli @shopify/theme. Run as Administrator. Verify with shopify version.', priority: 'high', assigned_to: 'Jon', due_date: '2026-05-01' },
  { title: 'Duplicate live theme in Shopify Admin',
    notes: 'Rename to Dev - Migration - [date]. Working copy only. Live theme untouched until go-live.', priority: 'critical', assigned_to: 'Jon', due_date: '2026-05-01' },
  { title: 'Pull duplicate theme to local machine',
    notes: 'shopify theme pull. Replace DEV_THEME_ID with ID from shopify theme list command. Pull to C:\\Users\\JonFawcett\\Documents\\doddl-theme\\.', priority: 'critical', assigned_to: 'Jon', due_date: '2026-05-01' },
  { title: 'Initialise Git on doddl-theme folder',
    notes: 'git init, git add ., git commit "baseline: pre-migration theme pull".', priority: 'critical', assigned_to: 'Jon', due_date: '2026-05-01' },
  { title: 'Create CLAUDE.md inside doddl-theme folder',
    notes: 'Full migration context, high-risk file warnings, and locked URL architecture.', priority: 'critical', assigned_to: 'Jon', due_date: '2026-05-01' },
  { title: 'Audit Section Store pages',
    notes: 'Identify every page using Section Store sections before duplication. Document all section types and page names.', priority: 'critical', assigned_to: 'Jon', due_date: '2026-05-03' },
  { title: 'Run CWV benchmark on live site',
    notes: 'Record LCP, CLS, INP per key template as baseline for regression testing.', priority: 'high', assigned_to: 'Claude', due_date: '2026-05-03' },
  { title: 'Crawl live hreflang and canonical tags',
    notes: 'Document current state as baseline.', priority: 'critical', assigned_to: 'Claude', due_date: '2026-05-03' },
  { title: 'Extract and document all current schema markup',
    notes: 'Across key page types.', priority: 'high', assigned_to: 'Claude', due_date: '2026-05-03' },
  { title: 'Import pre-launch redirect CSV',
    notes: 'Admin → Online Store → Navigation → URL Redirects → Import. 7 pre-launch redirects covering category URL changes. Must go live before new URLs.', priority: 'critical', assigned_to: 'Jon', due_date: '2026-05-05' },
  { title: 'Verify all 7 pre-launch redirects are working',
    notes: 'Spot check each one.', priority: 'critical', assigned_to: 'Claude', due_date: '2026-05-05' },
]

async function getProdKey() {
  const VC_TOKEN = process.env.VERCEL_TOKEN
  if (!VC_TOKEN) throw new Error('Missing VERCEL_TOKEN — needed to fetch prod service role key')
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

  // Sanity: project exists
  const { data: proj, error: pErr } = await sb.from('projects').select('id,name').eq('id', PROJECT_ID).maybeSingle()
  if (pErr) throw pErr
  if (!proj) throw new Error(`Project ${PROJECT_ID} not found in ${label}`)
  console.log(`  ✓ project: ${proj.name}`)

  // ---- STEP 1 ----
  const { data: allTasks, error: tErr } = await sb.from('tasks')
    .select('id, title, status, progress, notes')
    .eq('project_id', PROJECT_ID)
  if (tErr) throw tErr

  const matched = []
  for (const code of STEP1_TARGETS) {
    const t = allTasks.find(t => (t.notes || '').startsWith(`[${code}]`))
    if (t) matched.push({ code, ...t })
  }

  let step1Updated = 0, step1AlreadyDone = 0, step1Missing = []
  for (const code of STEP1_TARGETS) {
    const m = matched.find(m => m.code === code)
    if (!m) { step1Missing.push(code); continue }
    if (m.status === 'done' && m.progress === 100) { step1AlreadyDone++; continue }
    const { error } = await sb.from('tasks')
      .update({ status: 'done', progress: 100, updated_at: new Date().toISOString() })
      .eq('id', m.id)
    if (error) throw error
    step1Updated++
  }
  console.log(`  STEP 1: matched ${matched.length}/${STEP1_TARGETS.length} targets · updated ${step1Updated} · already done ${step1AlreadyDone}` + (step1Missing.length ? ` · MISSING: ${step1Missing.join(', ')}` : ''))

  // ---- STEP 2 ----
  const { data: existingGroup, error: gErr } = await sb.from('task_groups')
    .select('id, name, position').eq('project_id', PROJECT_ID).eq('name', NEW_GROUP_NAME).maybeSingle()
  if (gErr) throw gErr
  let groupId, groupCreated = false
  if (existingGroup) {
    groupId = existingGroup.id
    console.log(`  STEP 2: group already exists (id ${groupId.slice(-12)}, position ${existingGroup.position}) — skipping insert`)
  } else {
    const { data: created, error: cErr } = await sb.from('task_groups')
      .insert({ project_id: PROJECT_ID, name: NEW_GROUP_NAME, position: 0 })
      .select('id, name, position').single()
    if (cErr) throw cErr
    groupId = created.id
    groupCreated = true
    console.log(`  STEP 2: created group "${created.name}" at position ${created.position} (id ${groupId.slice(-12)})`)
  }

  // ---- STEP 3 ----
  const { data: existingInGroup, error: eErr } = await sb.from('tasks')
    .select('id, title').eq('group_id', groupId)
  if (eErr) throw eErr
  const existingTitles = new Set(existingInGroup.map(t => t.title))

  let step3Inserted = 0, step3Skipped = 0
  for (let i = 0; i < STEP3_TASKS.length; i++) {
    const t = STEP3_TASKS[i]
    if (existingTitles.has(t.title)) { step3Skipped++; continue }
    const { error: iErr } = await sb.from('tasks').insert({
      title: t.title,
      notes: t.notes,
      status: 'not_started',
      progress: 0,
      priority: t.priority,
      assigned_to: t.assigned_to,
      due_date: t.due_date,
      project_id: PROJECT_ID,
      group_id: groupId,
      position: i,
    })
    if (iErr) throw iErr
    step3Inserted++
  }
  console.log(`  STEP 3: inserted ${step3Inserted}/${STEP3_TASKS.length} new tasks · skipped ${step3Skipped} (already existed)`)

  // ---- VERIFY ----
  const { count: totalTasksAfter } = await sb.from('tasks')
    .select('id', { count: 'exact', head: true }).eq('project_id', PROJECT_ID)
  const { count: phase0TasksAfter } = await sb.from('tasks')
    .select('id', { count: 'exact', head: true }).eq('group_id', groupId)
  console.log(`  VERIFY: project has ${totalTasksAfter} tasks total · Phase 0 group has ${phase0TasksAfter} tasks`)

  return {
    label,
    matched: matched.length,
    step1Updated, step1AlreadyDone, step1Missing,
    groupCreated, groupId,
    step3Inserted, step3Skipped,
    totalTasksAfter, phase0TasksAfter,
  }
}

async function main() {
  const target = process.argv[2]
  if (!['staging','production','both'].includes(target)) {
    console.error('Usage: node scripts/dev-journey-phase0-update.js <staging|production|both>')
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
    console.log(`  Step 1: ${r.step1Updated} updated, ${r.step1AlreadyDone} already done` + (r.step1Missing.length ? `, MISSING ${r.step1Missing.join(',')}` : ''))
    console.log(`  Step 2: ${r.groupCreated ? 'created' : 'already existed'} (group id ${r.groupId.slice(-12)})`)
    console.log(`  Step 3: ${r.step3Inserted} inserted, ${r.step3Skipped} skipped`)
    console.log(`  Final:  ${r.phase0TasksAfter} tasks in Phase 0 group, ${r.totalTasksAfter} tasks in project`)
  }
}

main().catch(e => { console.error('FAIL:', e.message || e); process.exit(1) })
