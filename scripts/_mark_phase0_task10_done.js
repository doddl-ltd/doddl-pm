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

async function q(ref, sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  })
  return JSON.parse(await r.text())
}

;(async () => {
  const REF = 'ikcjciscttsvpxoijnqe' // production only
  // Find Phase 0 group + tasks matching CLAUDE.md context
  const tasks = await q(REF, `
    SELECT t.id, t.title, t.notes, t.status, t.progress
    FROM tasks t
    JOIN task_groups g ON g.id = t.group_id
    WHERE t.project_id = '10000000-0000-0000-0000-000000000009'
      AND g.name ILIKE '%Phase 0%'
      AND (t.notes ILIKE '%P0-10%' OR t.title ILIKE '%CLAUDE.md%' OR t.title ILIKE '%agent context%' OR t.title ILIKE '%context file%')
    ORDER BY t.position
  `)
  console.log('Candidate tasks:', JSON.stringify(tasks, null, 2))

  for (const t of tasks) {
    if (t.status === 'done' && t.progress === 100) { console.log(`  skip (already done): ${t.title}`); continue }
    await q(REF, `UPDATE tasks SET status='done', progress=100, updated_at=now() WHERE id='${t.id}'`)
    console.log(`  ✓ marked done: ${t.title}`)
  }
})().catch(e => { console.error(e); process.exit(1) })
