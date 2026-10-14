// Load the October 2026 catch-up proposal into the Triage inbox, so each item
// is approved by a person before it touches the task list.
//
//   PM_KEY=<claude-agents key from Key Vault> node scripts/load-reconciliation.mjs \
//     [--base=https://doddl-pm.vercel.app] [--file=docs/reconciliation/2026-10-14-proposal.json] \
//     [--create-projects] [--dry-run]
//
// - new_tasks            -> one inbox item each, proposing create_task (with status, progress, evidence)
// - existing_task_updates (status changes only) -> one inbox item each, proposing update_task
// - new_projects         -> created only with --create-projects (after Jon has approved them in
//                           the proposal .md); otherwise listed so tasks for them can wait
// - archive proposals and project renames are listed for doing by hand in the UI
// Idempotent: every item carries source_ref "reconcile-2026-10-14:<ref>", so re-running skips loaded items.

import fs from 'node:fs'

const arg = (name, dflt) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : dflt
}
const flag = (name) => process.argv.includes(`--${name}`)
const BASE = arg('base', 'https://doddl-pm.vercel.app')
const FILE = arg('file', 'docs/reconciliation/2026-10-14-proposal.json')
const DRY = flag('dry-run')
const KEY = process.env.PM_KEY
if (!KEY && !DRY) throw new Error('Set PM_KEY (Key Vault: pm-agent-key-claude-agents)')

const proposal = JSON.parse(fs.readFileSync(FILE, 'utf8'))
const TAG = 'reconcile-2026-10-14'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// The agent API allows 60 requests/minute per agent: pace at ~50/min and back
// off for a full window on 429.
async function api(method, path, body) {
  if (DRY) { console.log(`DRY ${method} ${path} ${body ? (body.title || body.name) : ''}`); return { status: 0, json: { created: true } } }
  for (let attempt = 0; ; attempt++) {
    await sleep(1200)
    const r = await fetch(BASE + path, { method, headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    let json = null
    try { json = await r.json() } catch { /* empty */ }
    if (r.status !== 429 || attempt >= 3) return { status: r.status, json }
    console.log('rate limited — waiting 60s')
    await sleep(60_000)
  }
}

const splitEvidence = (v) => String(v || '').split(/\s*;\s*/).map(s => s.trim()).filter(Boolean).slice(0, 10)

let created = 0, skipped = 0, failed = 0
const tally = (r, label) => {
  if (r.status === 201 || (DRY && r.json.created)) created++
  else if (r.status === 200) skipped++
  else { failed++; console.error(`FAILED ${label}: ${r.status} ${JSON.stringify(r.json)}`) }
}

if (flag('create-projects')) {
  for (const p of proposal.new_projects || []) {
    const r = await api('POST', '/api/projects', { name: p.name, description: p.description, status: p.status, owner: p.owner, start_date: p.start_date, due_date: p.due_date })
    console.log(`project "${p.name}": ${r.status}`)
  }
} else {
  for (const p of proposal.new_projects || []) console.log(`(not created — run with --create-projects once approved) project: ${p.name}`)
}

for (const t of proposal.new_tasks || []) {
  const evidence = splitEvidence(t.evidence_url_or_path)
  const r = await api('POST', '/api/agent/inbox', {
    source: 'agent',
    source_ref: `${TAG}:${t.external_ref}`,
    title: t.title,
    summary: t.notes,
    occurred_at: t.done_date ? `${t.done_date}T12:00:00Z` : undefined,
    payload: { proposal: TAG, project: t.project, group: t.group || null, evidence },
    proposed_actions: [{
      kind: 'create_task',
      title: t.title,
      project: t.project,
      group: t.group || undefined,
      assigned_to: t.assigned_to || undefined,
      status: t.status,
      progress: t.progress,
      due_date: t.due_date || null,
      external_ref: t.external_ref,
      evidence,
      notes: t.notes,
    }],
  })
  tally(r, t.title)
}

const manual = []
for (const u of proposal.existing_task_updates || []) {
  if (u.proposed_status === 'unchanged') continue
  if (u.proposed_status === 'archive') { manual.push(`archive: ${u.title} (${u.task_id}) — ${u.reason}`); continue }
  const r = await api('POST', '/api/agent/inbox', {
    source: 'agent',
    source_ref: `${TAG}:update:${u.task_id}`,
    title: `Update: ${u.title}`,
    summary: u.reason,
    payload: { proposal: TAG, current_status: u.current_status, evidence: splitEvidence(u.evidence) },
    proposed_actions: [{
      kind: 'update_task',
      task_id: u.task_id,
      status: u.proposed_status,
      progress: u.proposed_progress,
      evidence: splitEvidence(u.evidence),
      notes: u.reason,
    }],
  })
  tally(r, u.title)
}

for (const p of proposal.existing_project_updates || []) manual.push(`project: ${p.project || p.name} — ${p.proposed_change || p.reason || JSON.stringify(p)}`)

console.log(`\nInbox items: ${created} created, ${skipped} already loaded, ${failed} failed`)
if (manual.length) console.log(`\nDo by hand in the UI:\n- ${manual.join('\n- ')}`)
process.exit(failed ? 1 : 0)
