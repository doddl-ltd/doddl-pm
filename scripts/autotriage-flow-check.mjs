// Staging-only end-to-end check of workstream sync + auto-triage + undo + my tasks,
// against the real staging database with a scripted stand-in for Claude.
//   node --import ./test/setup.mjs scripts/autotriage-flow-check.mjs
import fs from 'node:fs'

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=')
  if (line && !line.startsWith('#') && i > 0 && !process.env[line.slice(0, i).trim()]) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '')
}
if (!String(process.env.NEXT_PUBLIC_SUPABASE_URL).includes('iknwprxycshrickpswjz')) throw new Error('staging only')

const { adminClient } = await import('../lib/server/admin.js')
const ops = await import('../lib/pm/ops.js')
const prog = await import('../lib/pm/programmes.js')
const auto = await import('../lib/pm/autoTriage.js')

let failed = 0
const ok = (name, cond, detail = '') => { if (!cond) failed++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`) }
const db = adminClient('Jon (autotriage-check)')
const jon = { actor: 'Claude (Jon)', agent_id: 'oauth:Jon', on_behalf_of: 'Jon', scopes: ['tasks:read', 'tasks:write', 'inbox:write', 'inbox:triage'] }
const stamp = Date.now()

// 1. Claude's grouping becomes programme + project
const ws1 = await prog.syncWorkstream(db, jon, { kind: 'claude_chat', programme: `[check] doddl Marketing ${stamp}`, title: `[check] CRM build in Klaviyo ${stamp}` })
ok('sync creates programme + project + workstream', ws1.created.programme && ws1.created.project && ws1.created.workstream, `${ws1.programme.name} / ${ws1.project.name}`)
const ws2 = await prog.syncWorkstream(db, jon, { kind: 'claude_chat', programme: `[check] DODDL marketing ${stamp}`, title: `[check] CRM build in Klaviyo ${stamp}` })
ok('sync again is idempotent (case-insensitive programme)', ws2.project.id === ws1.project.id && !ws2.created.project && !ws2.created.programme)
const ws3 = await prog.syncWorkstream(db, jon, { kind: 'agent', key: `repo:doddl-crm-${stamp}`, title: `[check] CRM build in Klaviyo ${stamp}`, programme: `[check] doddl Marketing ${stamp}` })
ok('an agent with the same workstream name reuses the project', ws3.project.id === ws1.project.id && ws3.created.workstream)

// 2. An existing task Claude should update rather than duplicate
const { task: existing } = await ops.createTask(db, jon, { title: `[check] Publish the pop-up forms ${stamp}`, project_id: ws1.project.id, assigned_to: 'Jon' })

// 3. Capture from the chat with the workstream
const cap = await ops.captureInbox(db, jon, {
  source: 'chat', source_ref: `check-${stamp}`, title: `[check] CRM planning chat ${stamp}`, summary: 'Agreed the pop-up forms go live Friday; Laura to write the welcome copy.',
  workstream: { kind: 'claude_chat', programme: `[check] doddl Marketing ${stamp}`, title: `[check] CRM build in Klaviyo ${stamp}` },
  proposed_actions: [
    { kind: 'create_task', title: 'Write the welcome email copy', assigned_to: 'Laura', due_date: '2026-10-20' },
    { kind: 'create_task', title: 'Maybe look at SMS sometime' },
    { kind: 'create_task', title: 'Publish the pop-up forms on Friday' },
  ],
})
let item = (await db.from('inbox_items').select('*').eq('id', cap.id).single()).data
ok('capture links the chat project as the hint and queues auto-triage', item.project_hint_id === ws1.project.id && item.auto_status === 'pending')

// 4. Auto-triage with a scripted Claude: confident create, unsure create, confident update
const fakeClaude = {
  beta: { messages: { create: async (req) => {
    if (!req.messages[0].content.includes(existing.id)) throw new Error('existing task not offered to Claude')
    return { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({
      summary: 'Filed the copy task; updated the pop-up forms task.',
      decisions: [
        { action_index: 0, decision: 'create', project_id: ws1.project.id, project_fit: 'clear', task_id: null, title: 'Write the welcome email copy', assigned_to: 'Laura', due_date: '2026-10-20', status: null, progress: null, confidence: 0.92, reason: 'Clear new action with owner and date.' },
        { action_index: 1, decision: 'create', project_id: ws1.project.id, project_fit: 'clear', task_id: null, title: 'Look at SMS', assigned_to: null, due_date: null, status: null, progress: null, confidence: 0.4, reason: 'Vague; unclear whether it was agreed.' },
        { action_index: 2, decision: 'update', project_id: null, project_fit: null, task_id: existing.id, title: null, assigned_to: null, due_date: '2026-10-17', status: null, progress: null, confidence: 0.9, reason: 'Same deliverable as the open task; adds the Friday date.' },
      ] }) }] }
  } } },
}
const r = await auto.triageOne(adminClient(auto.AUTO_ACTOR), fakeClaude, item) // the cron's own client
ok('confident actions filed, unsure one left for a person', r.status === 'partial' && r.auto_status === 'needs_review', `${r.status}/${r.auto_status}`)
const created = r.decisions.find(d => d.index === 0)
const updated = (await ops.getTask(db, existing.id))
const newTask = await ops.getTask(db, created.task_id)
ok('new task is in the chat project, owned by Laura, with evidence', newTask.project_id === ws1.project.id && newTask.assigned_to === 'Laura' && newTask.links.some(l => l.url === `pm-inbox:${cap.id}`))
ok('existing task updated (date + note) instead of duplicated', updated.due_date === '2026-10-17' && updated.recent_comments.some(c => c.author === 'Claude (auto-triage)'))
ok('history shows Claude (auto-triage) as the actor', newTask.recent_history.some(h => h.actor === 'Claude (auto-triage)'))
const notes = (await db.from('notifications').select('user_name, type').eq('task_id', created.task_id)).data
ok('Laura is notified', notes.some(n => n.user_name === 'Laura' && n.type === 'auto_assigned'))

// 5. My tasks + briefing + overview see it
const mine = await prog.myTasks(db, jon, { person: 'Laura' })
ok('my_tasks for Laura includes it with programme + project', [...mine.due_this_week, ...mine.later, ...mine.overdue].some(t => t.id === created.task_id && t.programme === ws1.programme.name))
const brief = await prog.briefing(db, jon, {})
ok('briefing defaults to the signed-in person', brief.person === 'Jon' && typeof brief.triage.needs_a_look === 'number')
const ov = await prog.programmeOverview(db, { programme: ws1.programme.name })
ok('programme overview counts the project', ov.projects.length === 1 && ov.projects[0].open >= 2)

// 6. A person finishes the leftover item; then undo the auto-filing
const manual = await ops.triageInbox(db, jon, cap.id, { decision: 'accept', accept_actions: [1] })
ok('person accepts the leftover action', manual.status === 'accepted')
item = (await db.from('inbox_items').select('*').eq('id', cap.id).single()).data
const undo = await auto.undoAutoTriage(db, jon, cap.id)
const gone = (await db.from('tasks').select('archived_at').eq('id', created.task_id).single()).data
ok('undo archives what Claude created and lists updates to check', gone.archived_at && undo.updates_to_check.includes(existing.id))
const after = (await db.from('inbox_items').select('status, auto_status').eq('id', cap.id).single()).data
ok('undone item is back for a person and will not be re-filed', after.status === 'new' && after.auto_status === 'undone')

// 7. "Ask Claude again": allowed for this one item, refused once a person has dealt with it
const again = await auto.retryAutoTriage(db, jon, { id: cap.id })
const queued = (await db.from('inbox_items').select('auto_status, auto_attempts').eq('id', cap.id).single()).data
ok('retry queues the item for Claude again', again.queued === 1 && queued.auto_status === 'pending' && queued.auto_attempts === 0)
await ops.triageInbox(db, jon, cap.id, { decision: 'dismiss', notes: 'flow check clean-up' })
let refused = null
try { await auto.retryAutoTriage(db, jon, { id: cap.id }) } catch (e) { refused = e }
ok('retry refused once the item is dismissed', refused && refused.status === 409)

// 8. The Claude API account runs out of credit: the run pauses, the item stays queued, attempts unused
const pendingBefore = (await db.from('inbox_items').select('id', { count: 'exact', head: true }).eq('auto_status', 'pending').in('status', ['new', 'partial'])).count
if (pendingBefore) {
  console.log(`SKIP  pause check: ${pendingBefore} other item(s) already pending on staging`)
} else {
  const p = await ops.captureInbox(db, jon, { source: 'chat', source_ref: `check-pause-${stamp}`, title: `[check] pause ${stamp}`, proposed_actions: [{ kind: 'create_task', title: 'Anything' }] })
  const broke = { beta: { messages: { create: async () => { const e = new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'); e.status = 400; throw e } } } }
  const sum = await auto.runAutoTriage({ db: adminClient(auto.AUTO_ACTOR), claude: broke })
  const row = (await db.from('inbox_items').select('auto_status, auto_attempts, auto_error').eq('id', p.id).single()).data
  ok('out of credit pauses the run instead of parking items', sum.paused && sum.processed === 0 && sum.needs_review === 0, sum.paused || '')
  ok('the item stays queued with the reason and no attempt used', row.auto_status === 'pending' && row.auto_attempts === 0 && /^Paused:/.test(row.auto_error))
  const b = await prog.briefing(db, jon, {})
  ok('the briefing reports that filing is paused', /out of credit/.test(b.triage.auto_filing_paused || ''))
  await ops.triageInbox(db, jon, p.id, { decision: 'dismiss', notes: 'flow check clean-up' })
}

console.log(failed ? `\n${failed} FAILURE(S)` : '\nALL OK')
process.exit(failed ? 1 : 0)
