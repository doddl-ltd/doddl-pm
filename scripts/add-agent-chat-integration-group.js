// scripts/add-agent-chat-integration-group.js
// Adds the "Agent Chat Integration" task group + 9 tasks to the PM Tool Build
// project on EITHER staging or production, via the Supabase service role client.
//
// Usage:
//   node scripts/add-agent-chat-integration-group.js staging
//   node scripts/add-agent-chat-integration-group.js prod
//
// Each run is idempotent-at-worst-skip: if the task group already exists with
// the target name on the target DB it refuses to run, so you can't double-insert.
//
// Hard Rule 2 compliance: uses PostgREST via the Supabase JS SDK with the
// service role key, not the Management API `/database/query` endpoint.
// Operating Rule 4 recognises the service role client as an approved write path.

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

const target = (process.argv[2] || '').toLowerCase()
if (!['staging', 'prod'].includes(target)) {
  console.error('Usage: node scripts/add-agent-chat-integration-group.js <staging|prod>')
  process.exit(1)
}

const STAGING_URL   = 'https://iknwprxycshrickpswjz.supabase.co'
const PROD_URL      = 'https://ikcjciscttsvpxoijnqe.supabase.co'
const PM_TOOL_BUILD = '10000000-0000-0000-0000-000000000001'
const AZURE_KV_TASK = '30000000-0000-0000-0000-000000000028'    // P0-1 Azure Key Vault setup
const NEW_GROUP_NAME = 'Agent Chat Integration'
const VC_TOKEN      = process.env.VERCEL_TOKEN

// Task definitions in insertion order. depends_on is a symbolic pointer:
//   null              → no dependency
//   'azure-kv'        → P0-1 Azure Key Vault task (pre-existing)
//   'task1'..'task9'  → the task at that position in this list (resolved as we go)
const TASKS = [
  { key: 'task1', title: 'Write doddl PM Claude Project system prompt',
    description: 'Defines the agent API endpoint, auth key, task update format, and natural language to API translation rules. Output is a saved Claude Project that any team member can use to read and update tasks via chat.',
    assigned_to: 'Jon', priority: 'high', due_date: '2026-04-28', depends_on: null },
  { key: 'task2', title: 'Build /api/agent/lookup endpoint',
    description: 'Allows the Claude Project to query tasks by assignee, project name, or task ID. Enables users to ask "what are my open tasks" before making updates.',
    assigned_to: 'Claude', priority: 'high', due_date: null, depends_on: 'task1' },
  { key: 'task3', title: 'Test shared Claude Project end to end',
    description: 'Jon creates a task, updates a status, adds a note — all via natural language in the Claude Project. Must confirm full round trip before team rollout.',
    assigned_to: 'Jon', priority: 'high', due_date: null, depends_on: 'task2' },
  { key: 'task4', title: 'Brief team on shared Claude Project — Laura and Cat',
    description: 'Both get access to the shared Claude Project and a one-page guide on how to use it to update their tasks via chat.',
    assigned_to: 'Jon', priority: 'medium', due_date: null, depends_on: 'task3' },
  { key: 'task5', title: 'Design user-scoped API key model',
    description: 'Each team member gets their own agent API key stored in Azure Key Vault. Audit log attributes every write to the correct person not to a shared service account.',
    assigned_to: 'Jon', priority: 'high', due_date: null, depends_on: 'azure-kv' },
  { key: 'task6', title: 'Build user key issuance in PM tool settings',
    description: 'Admin can generate and revoke per-user API keys via a settings page in the PM tool. Keys are stored in Azure Key Vault not in the database.',
    assigned_to: 'Claude', priority: 'high', due_date: null, depends_on: 'task5' },
  { key: 'task7', title: 'Update agent auth middleware for per-user keys',
    description: 'Validate per-user keys and extract user identity for audit log attribution. Every write must be logged against the correct person.',
    assigned_to: 'Claude', priority: 'high', due_date: null, depends_on: 'task6' },
  { key: 'task8', title: 'Update each team member Claude Project to use personal key',
    description: 'Jon, Laura, and Cat each get their own Claude Project configured with their personal API key. Replace the shared key from Step 1.',
    assigned_to: 'Jon', priority: 'medium', due_date: null, depends_on: 'task7' },
  { key: 'task9', title: 'Regression test user-scoped auth',
    description: 'Confirm existing AI agent routes still work with service key. User routes work with personal keys. Cross-user writes are blocked. Full audit log attribution verified.',
    assigned_to: 'Jon', priority: 'high', due_date: null, depends_on: 'task7' },
]

async function getProdServiceRoleKey() {
  if (!VC_TOKEN) throw new Error('Missing VERCEL_TOKEN (needed to fetch the prod service role key)')
  const listResp = await fetch('https://api.vercel.com/v10/projects/doddl-pm/env', {
    headers: { Authorization: `Bearer ${VC_TOKEN}` },
  })
  if (!listResp.ok) throw new Error(`Vercel list env: ${listResp.status} ${await listResp.text()}`)
  const { envs } = await listResp.json()
  const meta = envs.find(e => e.key === 'SUPABASE_SERVICE_ROLE_KEY' && (e.target || []).includes('production'))
  if (!meta) throw new Error('No production-scoped SUPABASE_SERVICE_ROLE_KEY found on Vercel')
  const oneResp = await fetch(`https://api.vercel.com/v1/projects/doddl-pm/env/${meta.id}?decrypt=true`, {
    headers: { Authorization: `Bearer ${VC_TOKEN}` },
  })
  if (!oneResp.ok) throw new Error(`Vercel get env ${meta.id}: ${oneResp.status} ${await oneResp.text()}`)
  const body = await oneResp.json()
  if (!body.value) throw new Error('Vercel returned env entry without plaintext value')
  return body.value
}

async function main() {
  const isProd = target === 'prod'
  const url    = isProd ? PROD_URL : STAGING_URL
  const key    = isProd
    ? await getProdServiceRoleKey()
    : process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error(`Missing service role key for ${target}`)
  if (!isProd && !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('iknwprxycshrickpswjz')) {
    throw new Error('For staging, .env.local must point at iknwprxycshrickpswjz. Refusing to guess.')
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  console.log(`=== ${target.toUpperCase()} (${url}) ===`)

  // Sanity: project exists.
  const { data: proj, error: pErr } = await supabase
    .from('projects').select('id, name').eq('id', PM_TOOL_BUILD).maybeSingle()
  if (pErr) throw pErr
  if (!proj)                      throw new Error('PM Tool Build project not found — aborting')
  if (proj.name !== 'PM Tool Build') throw new Error(`Project id matches but name is "${proj.name}" — aborting`)
  console.log(`  ✓ project: ${proj.name}`)

  // Sanity: P0-1 Azure Key Vault task exists (task5 depends on it).
  const { data: kv } = await supabase
    .from('tasks').select('id, title').eq('id', AZURE_KV_TASK).maybeSingle()
  if (!kv) throw new Error(`Azure Key Vault anchor task ${AZURE_KV_TASK} not found — aborting`)
  console.log(`  ✓ anchor task: ${kv.title}`)

  // Existing groups — pre-check to prevent double-insert.
  const { data: groups, error: gErr } = await supabase
    .from('task_groups').select('id, name, position')
    .eq('project_id', PM_TOOL_BUILD).order('position')
  if (gErr) throw gErr
  const groupsBefore = groups.length
  if (groups.some(g => g.name === NEW_GROUP_NAME)) {
    throw new Error(`Task group "${NEW_GROUP_NAME}" already exists on this DB — aborting to avoid duplicate`)
  }
  const nextGroupPos = Math.max(0, ...groups.map(g => g.position || 0)) + 1
  console.log(`  existing groups: ${groupsBefore} (highest position ${nextGroupPos - 1})`)

  // Compute next task position across the whole project (tasks share `position`
  // per-project in this schema). New tasks slot in after everything else so
  // they don't disturb existing ordering.
  const { data: allTasks, error: tErr } = await supabase
    .from('tasks').select('id, position').eq('project_id', PM_TOOL_BUILD)
  if (tErr) throw tErr
  const tasksBefore = allTasks.length
  let nextTaskPos = Math.max(0, ...allTasks.map(t => t.position || 0)) + 1
  console.log(`  existing tasks in project: ${tasksBefore}`)

  // Insert the task group.
  const { data: newGroup, error: ngErr } = await supabase
    .from('task_groups').insert([{
      project_id: PM_TOOL_BUILD, name: NEW_GROUP_NAME, position: nextGroupPos,
    }]).select('id, name, position').single()
  if (ngErr) throw ngErr
  console.log(`  ✓ inserted group "${newGroup.name}" pos=${newGroup.position}  id=${newGroup.id}`)

  // Insert tasks in dependency order so we can resolve depends_on against
  // ids as we go.
  const idByKey = { 'azure-kv': AZURE_KV_TASK }
  const inserted = []
  for (const t of TASKS) {
    const deps = t.depends_on ? idByKey[t.depends_on] : null
    if (t.depends_on && !deps) throw new Error(`Unresolved dep ${t.depends_on} for ${t.key}`)

    const row = {
      title:       t.title,
      description: t.description,
      status:      'not_started',
      priority:    t.priority,
      project_id:  PM_TOOL_BUILD,
      group_id:    newGroup.id,
      assigned_to: t.assigned_to,
      due_date:    t.due_date,
      source:      'manual',
      depends_on:  deps,
      position:    nextTaskPos++,
      progress:    0,
      task_type:   'standard',
    }
    const { data: newTask, error: ntErr } = await supabase
      .from('tasks').insert([row])
      .select('id, title, assigned_to, priority, position, depends_on')
      .single()
    if (ntErr) throw ntErr
    idByKey[t.key] = newTask.id
    inserted.push(newTask)
    console.log(`  ✓ ${t.key}  ${newTask.id}  ${newTask.title}`)
  }

  // Verification — re-read counts.
  const { data: groupsAfter } = await supabase
    .from('task_groups').select('id').eq('project_id', PM_TOOL_BUILD)
  const { data: tasksAfter } = await supabase
    .from('tasks').select('id').eq('project_id', PM_TOOL_BUILD)
  const { data: groupTasks } = await supabase
    .from('tasks').select('id, title').eq('group_id', newGroup.id).order('position')

  console.log(`\n  row counts: task_groups ${groupsBefore} → ${groupsAfter.length}   tasks ${tasksBefore} → ${tasksAfter.length}`)
  console.log(`  tasks in new group: ${groupTasks.length}`)

  // Write per-DB summary JSON for the report back to user.
  const out = {
    db: target, url, group: newGroup, tasks: inserted,
    counts: { groupsBefore, groupsAfter: groupsAfter.length, tasksBefore, tasksAfter: tasksAfter.length },
  }
  fs.writeFileSync(path.join('scripts', `_agent_chat_integration_${target}.json`), JSON.stringify(out, null, 2))
  console.log(`  wrote scripts/_agent_chat_integration_${target}.json`)
}

main().catch(e => { console.error('FAIL:', e.message || e); process.exit(1) })
