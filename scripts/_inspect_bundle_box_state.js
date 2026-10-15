// Transient inspection script — reads schema + placeholder state from both DBs.
// No writes. Delete after migration is done.
const fs = require('fs')
const path = require('path')

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

const SB = process.env.SUPABASE_ACCESS_TOKEN
if (!SB) { console.error('SUPABASE_ACCESS_TOKEN missing'); process.exit(1) }

const REFS = { staging: 'iknwprxycshrickpswjz', production: 'ikcjciscttsvpxoijnqe' }

async function q(ref, sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SB}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`${ref} ${r.status}: ${t.slice(0, 400)}`)
  return JSON.parse(t)
}

async function inspect(name, ref) {
  console.log(`\n====== ${name} (${ref}) ======`)

  const cols = await q(ref, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name IN ('tasks','task_groups','projects')
    ORDER BY table_name, ordinal_position;
  `)
  console.log('\n[columns]')
  for (const c of cols) console.log(`  ${c.column_name.padEnd(20)} ${c.data_type} ${c.is_nullable==='NO'?'NOT NULL':'NULL'} ${c.column_default ? 'default='+c.column_default : ''}`)

  const checks = await q(ref, `
    SELECT con.conname, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    WHERE ns.nspname='public'
      AND cls.relname IN ('tasks','task_groups','projects')
      AND con.contype='c'
    ORDER BY cls.relname, con.conname;
  `)
  console.log('\n[check constraints]')
  for (const c of checks) console.log(`  ${c.conname}: ${c.def}`)

  const funcs = await q(ref, `
    SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND proname='backup_before_migration';
  `)
  console.log(`\n[backup_before_migration] ${funcs.length>0 ? 'EXISTS' : 'MISSING'}`)

  const ledger = await q(ref, `SELECT id FROM schema_migrations ORDER BY id;`)
  console.log(`\n[schema_migrations ids] (${ledger.length})`)
  for (const row of ledger) console.log(`  ${row.id}`)

  const proj = await q(ref, `SELECT id, name, description, start_date, due_date FROM projects WHERE id='10000000-0000-0000-0000-000000000007';`)
  console.log(`\n[project 10000000-...-0007]`)
  console.log(proj.length ? proj[0] : '  NOT FOUND')

  const groups = await q(ref, `SELECT id, name, position FROM task_groups WHERE project_id='10000000-0000-0000-0000-000000000007' ORDER BY position;`)
  console.log(`\n[existing task_groups for project] (${groups.length})`)
  for (const g of groups) console.log(`  ${g.id} [${g.position}] ${g.name}`)

  const tasks = await q(ref, `SELECT id, title, status, priority, group_id FROM tasks WHERE project_id='10000000-0000-0000-0000-000000000007' ORDER BY position;`)
  console.log(`\n[existing tasks for project] (${tasks.length})`)
  for (const t of tasks) console.log(`  ${t.id} [${t.status}/${t.priority}] ${t.title} (group ${t.group_id})`)
}

;(async () => {
  for (const [name, ref] of Object.entries(REFS)) {
    try { await inspect(name, ref) } catch (e) { console.error(`\n${name} FAILED:`, e.message) }
  }
})()
