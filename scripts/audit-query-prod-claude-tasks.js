// scripts/audit-query-prod-claude-tasks.js
// READ-ONLY. Query production (ikcjciscttsvpxoijnqe) for every task in the
// PM Tool Build project assigned to Claude. Uses the Supabase Management API
// with SUPABASE_ACCESS_TOKEN (PAT). No writes here — this script only reads
// so we can plan the audit.
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

const PROD_REF = 'ikcjciscttsvpxoijnqe'
const SB_PAT   = process.env.SUPABASE_ACCESS_TOKEN
if (!SB_PAT) { console.error('Missing SUPABASE_ACCESS_TOKEN'); process.exit(1) }

async function sbQuery(q) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROD_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SB_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  if (!resp.ok) throw new Error(`${resp.status}: ${await resp.text()}`)
  return resp.json()
}

async function main() {
  const projs = await sbQuery(`select id, name from projects where lower(name) like '%pm tool%' or lower(name) like '%pm build%' order by name;`)
  console.log('Candidate projects:')
  for (const p of projs) console.log(`  ${p.id}  ${p.name}`)
  if (projs.length === 0) { console.log('No PM Tool project found.'); return }

  const rows = await sbQuery(`
    select id, title, status, progress, assigned_to, task_type, position, project_id
    from tasks
    where project_id in (${projs.map(p => `'${p.id}'`).join(',')})
      and assigned_to = 'Claude'
    order by position nulls last, title;
  `)
  console.log(`\nClaude-owned tasks (${rows.length}):`)
  for (const r of rows) {
    const title = (r.title || '').slice(0, 100)
    console.log(`  [${(r.status||'').padEnd(12)}] ${String(r.progress ?? '').padStart(3)}%  ${title}`)
  }
  // Emit JSON for programmatic reuse.
  fs.writeFileSync(path.join('scripts', '_audit_claude_tasks.json'), JSON.stringify(rows, null, 2))
  console.log(`\nWrote scripts/_audit_claude_tasks.json (${rows.length} rows).`)
}

main().catch(e => { console.error('FAIL:', e.message || e); process.exit(1) })
