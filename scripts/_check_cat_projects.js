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
  for (const [label, ref] of [['STAGING', 'iknwprxycshrickpswjz'], ['PRODUCTION', 'ikcjciscttsvpxoijnqe']]) {
    console.log(`\n========== ${label} ==========`)
    // Probe column existence
    const tcols = await q(ref, `SELECT column_name FROM information_schema.columns WHERE table_name='tasks'`)
    const tColNames = tcols.map(c => c.column_name)
    const pcols = await q(ref, `SELECT column_name FROM information_schema.columns WHERE table_name='projects'`)
    const pColNames = pcols.map(c => c.column_name)
    const taskHasArchived = tColNames.includes('archived_at')
    const projHasArchived = pColNames.includes('archived_at')

    // Tasks assigned to anything cat-ish, with full task details
    const tasks = await q(ref, `
      SELECT t.id, t.title, t.assigned_to, t.project_id, t.is_group, t.status
             ${taskHasArchived ? ', t.archived_at' : ''},
             p.name AS project_name
             ${projHasArchived ? ', p.archived_at AS project_archived' : ''}
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.assigned_to ILIKE '%cat%' OR t.assigned_to = ''
      ORDER BY t.created_at DESC
    `)
    if (!Array.isArray(tasks)) { console.log('  tasks query returned:', tasks); continue }
    console.log(`tasks matching cat/empty: ${tasks.length} (taskHasArchived=${taskHasArchived}, projHasArchived=${projHasArchived})`)
    for (const t of tasks) {
      console.log(`  [${t.assigned_to || 'EMPTY'}] ${t.title?.slice(0,55)}`)
      console.log(`     project="${t.project_name || 'NONE'}" projectArchived=${t.project_archived || 'no'} taskArchived=${t.archived_at || 'no'} status=${t.status}`)
    }

    // Check projects table columns
    const cols = await q(ref, `SELECT column_name FROM information_schema.columns WHERE table_name='projects' ORDER BY ordinal_position`)
    console.log(`  projects columns:`, cols.map(c => c.column_name).join(', '))

    // List all projects + owner
    const projs = await q(ref, `SELECT id, name, owner, status FROM projects ORDER BY name`)
    console.log(`  projects (${projs.length}):`)
    for (const p of projs) console.log(`    [${p.owner}] ${p.name} (${p.status})`)
  }
})().catch(e => { console.error(e); process.exit(1) })
