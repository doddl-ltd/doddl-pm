// scripts/lockdown-check.js — verifies 17-pm-lockdown on a target database.
//   node scripts/lockdown-check.js --target=staging|production
// Read-only: the anon checks only try reads and an insert that must fail;
// the hard-delete guard is checked in the catalogue, never by deleting.

const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

const env = {}
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=')
  if (line && !line.startsWith('#') && i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '')
}
const target = (process.argv.find(a => a.startsWith('--target=')) || '--target=staging').split('=')[1]
const REF = { staging: 'iknwprxycshrickpswjz', production: 'ikcjciscttsvpxoijnqe' }[target]
if (!REF) { console.error('target must be staging or production'); process.exit(1) }

let failed = 0
const report = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`) }

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, read_only: true }),
  })
  return r.json()
}

async function main() {
  const anonKey = target === 'production' ? env.SUPABASE_PRODUCTION_ANON_KEY : env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (anonKey) {
    const anon = createClient(`https://${REF}.supabase.co`, anonKey, { auth: { persistSession: false } })
    for (const t of ['tasks', 'projects', 'task_groups', 'comments', 'notifications', 'inbox_items', 'agent_keys', 'oauth_tokens']) {
      const { data, error } = await anon.from(t).select('*').limit(1)
      report(`anon cannot read ${t}`, !!error || (Array.isArray(data) && data.length === 0), error ? error.message : `${data.length} rows`)
    }
    const { error } = await anon.from('tasks').insert([{ title: 'lockdown-check must fail' }])
    report('anon cannot insert tasks', !!error, error ? error.message : 'INSERT SUCCEEDED')
  } else {
    console.log('SKIP  anon checks (no anon key for this target in .env.local)')
  }

  const policies = await sql(`select count(*)::int n from pg_policies where schemaname='public' and 'anon' = any(roles)
    and tablename in ('projects','task_groups','tasks','comments','notifications')`)
  report('no anon policies on PM tables', policies[0]?.n === 0, JSON.stringify(policies))
  const privs = await sql(`select bool_or(has_table_privilege('anon', 'public.'||t, 'SELECT,INSERT,UPDATE,DELETE')) any
    from unnest(array['projects','task_groups','tasks','comments','notifications']) t`)
  report('anon holds no table privileges', privs[0]?.any === false, JSON.stringify(privs))
  const guards = await sql(`select string_agg(tgrelid::regclass::text, ',' order by 1) t from pg_trigger
    where tgname = 'forbid_hard_delete' and not tgisinternal`)
  report('hard-delete guard on projects, task_groups, tasks', guards[0]?.t === 'projects,task_groups,tasks', guards[0]?.t)

  console.log(failed === 0 ? '\nALL OK' : `\n${failed} FAILURE(S)`)
  process.exit(failed === 0 ? 0 : 1)
}
main()
