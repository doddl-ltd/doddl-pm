// Transient verification script for the Bundle Box import. Delete after use.
const fs = require('fs'), path = require('path')
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

async function verify(name, ref) {
  console.log(`\n====== ${name} (${ref}) ======`)
  const P = "'10000000-0000-0000-0000-000000000007'"

  const totalGroups = (await q(ref, `SELECT COUNT(*)::int AS n FROM task_groups WHERE project_id=${P};`))[0].n
  const activeGroups = (await q(ref, `SELECT COUNT(*)::int AS n FROM task_groups WHERE project_id=${P} AND archived_at IS NULL;`))[0].n
  const archivedGroups = (await q(ref, `SELECT COUNT(*)::int AS n FROM task_groups WHERE project_id=${P} AND archived_at IS NOT NULL;`))[0].n

  const totalTasks = (await q(ref, `SELECT COUNT(*)::int AS n FROM tasks WHERE project_id=${P};`))[0].n
  const activeTasks = (await q(ref, `SELECT COUNT(*)::int AS n FROM tasks WHERE project_id=${P} AND status != 'done';`))[0].n
  const doneTasks = (await q(ref, `SELECT COUNT(*)::int AS n FROM tasks WHERE project_id=${P} AND status='done';`))[0].n

  const perGroup = await q(ref, `
    SELECT g.position, g.name, g.archived_at IS NOT NULL AS archived,
           (SELECT COUNT(*)::int FROM tasks t WHERE t.group_id = g.id) AS task_count
    FROM task_groups g WHERE g.project_id=${P} ORDER BY g.position;
  `)

  console.log(`task_groups  total=${totalGroups}  active=${activeGroups}  archived=${archivedGroups}   (expect total=11, active=10, archived=1)`)
  console.log(`tasks        total=${totalTasks}  active=${activeTasks}  done=${doneTasks}        (expect total=62, active=59, done=3)`)
  console.log(`\nper-group task counts:`)
  for (const g of perGroup) {
    console.log(`  [${String(g.position).padStart(3)}] ${g.archived ? 'ARCH' : '    '}  ${g.name.padEnd(32)} ${g.task_count} tasks`)
  }

  const proj = (await q(ref, `SELECT id, name, start_date, due_date, LEFT(description, 80) AS desc_prefix FROM projects WHERE id=${P};`))[0]
  console.log(`\nproject row: ${proj.name} | ${proj.start_date} → ${proj.due_date}`)
  console.log(`  description: ${proj.desc_prefix}...`)

  const ledger = await q(ref, `SELECT id FROM schema_migrations WHERE id IN ('07-task-groups-archived-at','seed-bundle-box-plan') ORDER BY id;`)
  console.log(`\nschema_migrations entries: ${ledger.map(r => r.id).join(', ')}`)

  const ok =
    totalGroups === 11 && activeGroups === 10 && archivedGroups === 1 &&
    totalTasks === 62 && activeTasks === 59 && doneTasks === 3 &&
    ledger.length === 2
  console.log(`\nRESULT: ${ok ? 'PASS ✓' : 'FAIL ✗'}`)
  return ok
}

;(async () => {
  const args = process.argv.slice(2)
  const target = args[0] || 'staging'
  if (!REFS[target]) { console.error('pass staging | production | both'); process.exit(1) }
  if (target === 'both') {
    const a = await verify('staging', REFS.staging)
    const b = await verify('production', REFS.production)
    process.exit(a && b ? 0 : 1)
  } else {
    const ok = await verify(target, REFS[target])
    process.exit(ok ? 0 : 1)
  }
})()
