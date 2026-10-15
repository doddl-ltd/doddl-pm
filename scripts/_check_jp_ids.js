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
      method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql })
    })
    return JSON.parse(await r.text())
  }
  console.log('existing projects:')
  const ps = await q(`SELECT id, name FROM projects ORDER BY id;`)
  for (const p of ps) console.log(`  ${p.id}  ${p.name}`)
  console.log('\nany project / group / task matching reserved IDs:')
  console.log('project -0008:',     await q(`SELECT id FROM projects WHERE id = '10000000-0000-0000-0000-000000000008';`))
  console.log('task_groups -070..-074:', await q(`SELECT id FROM task_groups WHERE id BETWEEN '20000000-0000-0000-0000-000000000070' AND '20000000-0000-0000-0000-000000000074';`))
  console.log('tasks -500..-521:', await q(`SELECT id FROM tasks WHERE id BETWEEN '30000000-0000-0000-0000-000000000500' AND '30000000-0000-0000-0000-000000000521';`))
})()
