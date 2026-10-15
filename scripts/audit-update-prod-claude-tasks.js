// scripts/audit-update-prod-claude-tasks.js
// Update Claude-owned tasks in the PM Tool Build project on PRODUCTION
// (ikcjciscttsvpxoijnqe) to match what the codebase actually delivers.
//
// This reads _audit_claude_tasks.json (produced by the query script) so we
// work from a frozen snapshot of IDs rather than title-matching blindly.
//
// Uses the PRODUCTION Supabase service role key, fetched from Vercel via the
// Vercel API (VERCEL_TOKEN) — the staging .env.local key cannot authenticate
// against the prod URL. The key is held in memory only and never logged.
//
// Hard Rule 2 compliance: writes go through the PostgREST service-role path
// (Supabase client), NOT the Management API `/database/query` SQL endpoint.
// Operating Rule 4 explicitly permits service-role-client status updates.

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

const VC_TOKEN       = process.env.VERCEL_TOKEN
const VERCEL_PROJECT = 'doddl-pm'
const PROD_URL       = 'https://ikcjciscttsvpxoijnqe.supabase.co'
const PROD_REF       = 'ikcjciscttsvpxoijnqe'
const PM_TOOL_BUILD  = '10000000-0000-0000-0000-000000000001'

if (!VC_TOKEN) { console.error('Missing VERCEL_TOKEN'); process.exit(1) }

// Each row = evidence-based verdict for one task in PM Tool Build assigned to
// Claude, keyed by task id. See audit-query-prod-claude-tasks.js for source.
// `update: null` means do not touch (not-started → leave unchanged).
const VERDICTS = [
  { id: '30000000-0000-0000-0000-000000000001', title: '[Step 1] Create lib/constants.js, lib/team.js, lib/msal.js',
    update: { status: 'done', progress: 100 }, why: 'All three files exist in lib/ (constants.js, team.js, msal.js)' },
  { id: '30000000-0000-0000-0000-000000000002', title: '[Step 2] Extract leaf components — StatusBadge, PriorityBadge, AssigneeSelect, TagsCell, ProgressBar, InlineEdit, DateCell, OwnerAvatar',
    update: { status: 'done', progress: 100 }, why: 'All 8 leaf components exist in components/' },
  { id: '30000000-0000-0000-0000-000000000003', title: '[Step 3] Extract CalendarPicker, TimelineCell, LoginScreen',
    update: { status: 'done', progress: 100 }, why: 'CalendarPicker.jsx, TimelineCell.jsx, LoginScreen.jsx all exist' },
  { id: '30000000-0000-0000-0000-000000000004', title: '[Step 4] Extract CommentBody, MentionInput, TaskDetailPanel',
    update: { status: 'done', progress: 100 }, why: 'CommentBody.jsx, MentionInput.jsx, TaskDetailPanel.jsx all exist' },
  { id: '30000000-0000-0000-0000-000000000005', title: '[Step 5] Extract ProjectTableRow, ProjectGroup, ProjectDashboard, TaskRow',
    update: { status: 'done', progress: 100 }, why: 'All 4 components exist in components/' },
  { id: '30000000-0000-0000-0000-000000000006', title: '[Step 6] Extract KanbanBoard, GanttView',
    update: { status: 'done', progress: 100 }, why: 'KanbanBoard.jsx and GanttView.jsx exist in components/' },
  { id: '30000000-0000-0000-0000-000000000007', title: '[Step 7] Extract ProjectSection',
    update: { status: 'done', progress: 100 }, why: 'components/ProjectSection.jsx exists' },
  { id: '30000000-0000-0000-0000-000000000008', title: '[Step 8] Extract AddTaskModal, AddProjectModal',
    update: { status: 'done', progress: 100 }, why: 'AddTaskModal.jsx and AddProjectModal.jsx exist' },
  { id: '30000000-0000-0000-0000-000000000009', title: '[Step 9] Extract MyWorkView (with MwTaskTable + MwSection)',
    update: { status: 'done', progress: 100 }, why: 'MyWorkView.jsx contains MwTaskTable (line 8) and MwSection (line 56) as internal components' },
  { id: '30000000-0000-0000-0000-000000000010', title: '[Step 10] Reduce pages/index.js to <150-line shell + smoke test',
    update: { status: 'in_progress', progress: 85 }, why: 'pages/index.js is 182 lines — over the <150 target. Shell extraction done but acceptance criterion not met.' },
  { id: '30000000-0000-0000-0000-000000000011', title: '[Step 11] Add REST API scaffolding — pages/api/projects.js + pages/api/task-groups.js',
    update: { status: 'done', progress: 100 }, why: 'Both API routes exist in pages/api/' },
  { id: '30000000-0000-0000-0000-000000000012', title: 'Upgrade Next.js 14.1.0 → 14.2.x (security fix)',
    update: null, why: 'package.json still pins next@14.1.0 — not started, leave unchanged' },
  { id: '30000000-0000-0000-0000-000000000013', title: 'Build lib/agentAuth.js — agent authentication middleware',
    update: { status: 'done', progress: 100 }, why: 'lib/agentAuth.js exists (173 lines) with auth + rate limit + audit logging' },
  { id: '30000000-0000-0000-0000-000000000015', title: 'Build pages/api/agent/tasks.js',
    update: { status: 'done', progress: 100 }, why: 'pages/api/agent/tasks.js exists' },
  { id: '30000000-0000-0000-0000-000000000016', title: 'Build pages/api/agent/artefacts.js',
    update: { status: 'done', progress: 100 }, why: 'pages/api/agent/artefacts.js exists' },
  { id: '30000000-0000-0000-0000-000000000017', title: 'Implement rate limiting on agent routes',
    update: { status: 'done', progress: 100 }, why: 'agentAuth.js enforces RATE_LIMIT_PER_MINUTE=60 with 429 response on exceed' },
  { id: '30000000-0000-0000-0000-000000000020', title: 'Build lib/artefactTypes.js',
    update: { status: 'done', progress: 100 }, why: 'lib/artefactTypes.js exists (68 lines)' },
  { id: '30000000-0000-0000-0000-000000000021', title: 'Build components/ApprovalTaskPanel.jsx',
    update: { status: 'done', progress: 100 }, why: 'components/ApprovalTaskPanel.jsx exists with approve/reject/revision flow' },
  { id: '30000000-0000-0000-0000-000000000022', title: 'Implement immutable decision recording logic',
    update: { status: 'in_progress', progress: 70 }, why: 'Server-side enforced in pages/api/agent/tasks.js (returns 409 if decision already recorded), but UI path via ApprovalTaskPanel + anon RLS can still overwrite — no DB-level constraint/trigger yet' },
  { id: '30000000-0000-0000-0000-000000000023', title: 'Write RLS migration SQL — three role-based policy levels',
    update: { status: 'done', progress: 100 }, why: 'lib/migrations/04-rls-policies.sql exists with Level 1 (anon humans), Level 2 (service_role agents), Level 3 (admin)' },
]

async function getProdServiceRoleKey() {
  // Two-step: list to find the id of the production-scoped key, then GET that
  // id by env/{id} — the list endpoint returns ciphertext for type=encrypted
  // vars even with decrypt=true, but the per-id endpoint returns the plaintext.
  const listResp = await fetch(`https://api.vercel.com/v10/projects/${VERCEL_PROJECT}/env`, {
    headers: { Authorization: `Bearer ${VC_TOKEN}` },
  })
  if (!listResp.ok) throw new Error(`Vercel list env: ${listResp.status} ${await listResp.text()}`)
  const { envs } = await listResp.json()
  const meta = envs.find(e => e.key === 'SUPABASE_SERVICE_ROLE_KEY' && (e.target || []).includes('production'))
  if (!meta) throw new Error('No production-scoped SUPABASE_SERVICE_ROLE_KEY found on Vercel project')
  const oneResp = await fetch(`https://api.vercel.com/v1/projects/${VERCEL_PROJECT}/env/${meta.id}?decrypt=true`, {
    headers: { Authorization: `Bearer ${VC_TOKEN}` },
  })
  if (!oneResp.ok) throw new Error(`Vercel get env ${meta.id}: ${oneResp.status} ${await oneResp.text()}`)
  const body = await oneResp.json()
  if (!body.value) throw new Error('Vercel returned env entry without plaintext value')
  return body.value
}

async function main() {
  console.log('Fetching production service role key from Vercel…')
  const prodKey = await getProdServiceRoleKey()
  console.log('  ✓ retrieved (value not logged)')

  const supabase = createClient(PROD_URL, prodKey, { auth: { persistSession: false } })

  // Sanity check: read one row from prod to confirm we're connected.
  const { data: sanity, error: sErr } = await supabase
    .from('projects').select('id, name').eq('id', PM_TOOL_BUILD).maybeSingle()
  if (sErr) throw sErr
  if (!sanity) throw new Error('PM Tool Build project not found on prod — aborting')
  console.log(`  ✓ connected to prod; confirmed project: ${sanity.name}`)

  const report = []
  for (const v of VERDICTS) {
    // Read the current state first (so the report reflects real "before" values).
    const { data: before, error: bErr } = await supabase
      .from('tasks')
      .select('id, title, status, progress, assigned_to, project_id')
      .eq('id', v.id).maybeSingle()
    if (bErr) throw bErr
    if (!before) { report.push({ ...v, before: null, after: null, skipped: 'task not found' }); continue }
    if (before.project_id !== PM_TOOL_BUILD) { report.push({ ...v, before, after: null, skipped: 'not in PM Tool Build' }); continue }
    if (before.assigned_to !== 'Claude')    { report.push({ ...v, before, after: null, skipped: 'not assigned to Claude' }); continue }

    if (!v.update) {
      report.push({ ...v, before, after: before, skipped: 'left unchanged (not started)' })
      continue
    }

    // Only write if status/progress would actually change.
    if (before.status === v.update.status && before.progress === v.update.progress) {
      report.push({ ...v, before, after: before, skipped: 'already matches target' })
      continue
    }

    const { data: after, error: uErr } = await supabase
      .from('tasks')
      .update({ status: v.update.status, progress: v.update.progress, updated_at: new Date().toISOString() })
      .eq('id', v.id)
      .select('id, title, status, progress')
      .single()
    if (uErr) throw uErr
    report.push({ ...v, before, after, skipped: null })
  }

  // Persist audit output so the user can review.
  fs.writeFileSync(path.join('scripts', '_audit_update_report.json'), JSON.stringify(report, null, 2))

  console.log('\n=== UPDATE REPORT ===')
  for (const r of report) {
    const beforeStr = r.before ? `${r.before.status}/${r.before.progress}%` : '—'
    const afterStr  = r.after  ? `${r.after.status}/${r.after.progress}%`  : '—'
    const flag      = r.skipped ? ` (skipped: ${r.skipped})` : ''
    console.log(`  ${r.id.slice(-4)}  ${beforeStr.padEnd(22)} → ${afterStr.padEnd(22)}  ${r.title.slice(0, 60)}${flag}`)
  }
}

main().catch(e => { console.error('FAIL:', e.message || e); process.exit(1) })
