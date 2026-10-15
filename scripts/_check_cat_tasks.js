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

async function q(projectRef, sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  })
  return JSON.parse(await r.text())
}

async function checkAssigned(label, ref) {
  const counts = await q(ref, `SELECT assigned_to, COUNT(*) AS n FROM tasks WHERE assigned_to IS NOT NULL GROUP BY assigned_to ORDER BY n DESC`)
  console.log(`\n=== ${label} — distinct assigned_to values (with count) ===`)
  for (const row of counts) console.log(`  ${JSON.stringify(row.assigned_to)}: ${row.n}`)

  const cat = await q(ref, `SELECT id, title, assigned_to, project_id, is_group, status, source FROM tasks WHERE assigned_to ILIKE '%cat%' ORDER BY created_at DESC LIMIT 15`)
  console.log(`\n  cat-related tasks: ${cat.length}`)
  for (const t of cat) console.log(`    [${t.assigned_to}] ${t.title?.slice(0,70)} (proj=${t.project_id?.slice(0,8) ?? 'NULL'}, group=${t.is_group}, status=${t.status})`)
}

;(async () => {
  await checkAssigned('STAGING', 'iknwprxycshrickpswjz')
  await checkAssigned('PRODUCTION', 'ikcjciscttsvpxoijnqe')
})().catch(e => { console.error(e); process.exit(1) })
