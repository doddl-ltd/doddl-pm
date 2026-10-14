// scripts/regression-test.js
// SUPERSEDED once 17-pm-lockdown is applied: anon then has no access at all, so
// the POS anon checks below are expected to fail. Use scripts/lockdown-check.js.
//
// Task 4 RLS regression checks — runs entirely via HTTP against staging.
//
// Covers:
//   NEG-1  anon SELECT on agent_audit_log must return 0 rows (policy denies)
//   NEG-2  anon INSERT  into agent_audit_log must fail (policy denies)
//   NEG-3  anon DELETE  on comments must fail (no DELETE policy)
//   NEG-4  anon UPDATE  on comments must fail (no UPDATE policy)
//   NEG-5  anon DELETE  on notifications must fail (no DELETE policy)
//   POS-1  anon SELECT on tasks succeeds
//   POS-2  anon SELECT on projects succeeds
//   POS-3  anon SELECT on task_groups succeeds
//   POS-4  anon SELECT on notifications succeeds
//   POS-5  service_role SELECT on agent_audit_log succeeds
//   POS-6  service_role INSERT into agent_audit_log succeeds, then cleans up

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

let failed = 0
function report(name, ok, detail) {
  if (!ok) failed++
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

async function main() {
  loadDotEnv(path.join(process.cwd(), '.env.local'))
  const url     = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const srvKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !srvKey) { console.error('Missing env vars'); process.exit(1) }

  const anon = createClient(url, anonKey, { auth: { persistSession: false } })
  const srv  = createClient(url, srvKey,  { auth: { persistSession: false } })

  // ── NEG-1: anon SELECT on agent_audit_log should return 0 rows ──
  {
    const { data, error } = await anon.from('agent_audit_log').select('id').limit(5)
    const ok = !error && Array.isArray(data) && data.length === 0
    report('NEG-1 anon SELECT agent_audit_log returns 0 rows', ok,
      error ? `error=${error.message}` : `got ${data?.length} rows`)
  }

  // ── NEG-2: anon INSERT into agent_audit_log should fail ──
  {
    const { error } = await anon.from('agent_audit_log').insert([{
      agent_id: 'regression-test', method: 'GET', path: '/x', status_code: 200,
    }])
    report('NEG-2 anon INSERT agent_audit_log is denied', !!error, error?.message || 'unexpectedly succeeded')
  }

  // Seed: grab one existing task to target comment tests at.
  const { data: seedTask } = await srv.from('tasks').select('id').limit(1)
  const taskId = seedTask?.[0]?.id

  // ── Create a temp comment with service_role for NEG-3/NEG-4 ──
  let tempCommentId = null
  if (taskId) {
    const { data: cm, error: cErr } = await srv.from('comments').insert([{
      task_id: taskId, author: 'regression-test', body: 'temp comment — safe to delete',
    }]).select().single()
    if (cErr) console.warn('seed comment failed:', cErr.message)
    else tempCommentId = cm.id
  }

  // ── NEG-3: anon DELETE comments should fail (no DELETE policy) ──
  if (tempCommentId) {
    const { error, count } = await anon.from('comments').delete({ count: 'exact' }).eq('id', tempCommentId)
    const ok = !!error || count === 0
    report('NEG-3 anon DELETE comments is denied', ok,
      error ? `error=${error.message}` : `deleted ${count} rows`)
  } else {
    report('NEG-3 anon DELETE comments is denied', false, 'skipped — no seed comment')
  }

  // ── NEG-4: anon UPDATE comments should fail (no UPDATE policy) ──
  if (tempCommentId) {
    const { error, count } = await anon.from('comments').update({ body: 'tampered' }, { count: 'exact' }).eq('id', tempCommentId)
    const ok = !!error || count === 0
    report('NEG-4 anon UPDATE comments is denied', ok,
      error ? `error=${error.message}` : `updated ${count} rows`)
  } else {
    report('NEG-4 anon UPDATE comments is denied', false, 'skipped — no seed comment')
  }

  // Cleanup seed comment
  if (tempCommentId) await srv.from('comments').delete().eq('id', tempCommentId)

  // ── NEG-5: anon DELETE notifications should fail ──
  {
    // Insert a temp notif with service_role, attempt anon delete, clean up.
    const { data: n, error: nErr } = await srv.from('notifications').insert([{
      user_name: 'regression-test', type: 'mention', task_title: 'temp',
    }]).select().single()
    if (nErr) {
      report('NEG-5 anon DELETE notifications is denied', false, `seed failed: ${nErr.message}`)
    } else {
      const { error, count } = await anon.from('notifications').delete({ count: 'exact' }).eq('id', n.id)
      const ok = !!error || count === 0
      report('NEG-5 anon DELETE notifications is denied', ok,
        error ? `error=${error.message}` : `deleted ${count} rows`)
      await srv.from('notifications').delete().eq('id', n.id)
    }
  }

  // ── POS-1..4: anon SELECT on tasks/projects/task_groups/notifications ──
  for (const tbl of ['tasks', 'projects', 'task_groups', 'notifications']) {
    const { error } = await anon.from(tbl).select('*').limit(1)
    report(`POS anon SELECT ${tbl} succeeds`, !error, error?.message)
  }

  // ── POS-5: service_role SELECT on agent_audit_log succeeds ──
  {
    const { error } = await srv.from('agent_audit_log').select('id').limit(1)
    report('POS service_role SELECT agent_audit_log succeeds', !error, error?.message)
  }

  // ── POS-6: service_role INSERT into agent_audit_log succeeds ──
  {
    const { data, error } = await srv.from('agent_audit_log').insert([{
      agent_id: 'regression-test', method: 'GET', path: '/_test', status_code: 200,
    }]).select().single()
    report('POS service_role INSERT agent_audit_log succeeds', !error, error?.message)
    // agent_audit_log is append-only since 16-pm-hardening: the row stays.
  }

  console.log(failed === 0 ? '\nALL OK' : `\n${failed} FAILURE(S)`)
  process.exit(failed === 0 ? 0 : 1)
}

main()
