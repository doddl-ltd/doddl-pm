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

;(async () => {
  const q = async (sql) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/iknwprxycshrickpswjz/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql })
    })
    return JSON.parse(await r.text())
  }
  const P = "'10000000-0000-0000-0000-000000000012'"

  const proj = (await q(`SELECT id, name, status, priority, owner, start_date, due_date FROM projects WHERE id=${P};`))[0]
  console.log('project row:', proj)

  const groupCount = (await q(`SELECT COUNT(*)::int AS n FROM task_groups WHERE project_id=${P};`))[0].n
  const taskCount  = (await q(`SELECT COUNT(*)::int AS n FROM tasks WHERE project_id=${P};`))[0].n
  const zeroProgress = (await q(`SELECT COUNT(*)::int AS n FROM tasks WHERE project_id=${P} AND progress = 0;`))[0].n
  const notStarted = (await q(`SELECT COUNT(*)::int AS n FROM tasks WHERE project_id=${P} AND status = 'not_started';`))[0].n

  const perGroup = await q(`
    SELECT g.position, g.name, (SELECT COUNT(*)::int FROM tasks t WHERE t.group_id = g.id) AS task_count
    FROM task_groups g WHERE g.project_id=${P} ORDER BY g.position;
  `)

  console.log(`\ntask_groups: ${groupCount}  (expect 5)`)
  console.log(`tasks:       ${taskCount}  (expect 22)`)
  console.log(`progress=0:  ${zeroProgress}  (expect 22)`)
  console.log(`status=not_started: ${notStarted}  (expect 22)`)

  console.log('\nper-group:')
  for (const g of perGroup) console.log(`  [${g.position}] ${g.name.padEnd(60)} ${g.task_count} tasks`)

  const deps = await q(`SELECT id, title, depends_on FROM tasks WHERE project_id=${P} AND depends_on IS NOT NULL ORDER BY position;`)
  console.log(`\ndependency links: ${deps.length}`)
  for (const d of deps) console.log(`  ${d.id} -> ${d.depends_on}`)

  const ok = groupCount === 5 && taskCount === 22 && zeroProgress === 22 && notStarted === 22 && proj
  console.log(`\nRESULT: ${ok ? 'PASS ✓' : 'FAIL ✗'}`)
  process.exit(ok ? 0 : 1)
})()
