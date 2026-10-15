// scripts/configure-breach-alerts.js
// Upserts the two Supabase Vault secrets that breach alert migration 11 reads.
// Run once after applying migration 11, or whenever the API URL or key changes.
//
// Usage:
//   node scripts/configure-breach-alerts.js --target=staging
//   node scripts/configure-breach-alerts.js --target=production
//
// Secrets written to Vault (encrypted at rest):
//   breach-alert-pm-api-url          — Vercel deployment URL (not sensitive)
//   breach-alert-agent-service-key   — AGENT_SERVICE_KEY (sensitive — never printed)

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

const SERVICE_KEY = process.env.AGENT_SERVICE_KEY
if (!SERVICE_KEY) { console.error('AGENT_SERVICE_KEY missing'); process.exit(1) }

const TARGETS = {
  staging:    { ref: 'iknwprxycshrickpswjz', url: 'https://doddl-pm-git-staging-d0ddls-projects.vercel.app' },
  production: { ref: 'ikcjciscttsvpxoijnqe', url: 'https://doddl-pm.vercel.app' },
}

function parseArgs(argv) {
  const out = {}
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/); if (m) out[m[1]] = m[2]
  }
  return out
}

const args = parseArgs(process.argv)
const { target } = args
if (!target || !TARGETS[target]) {
  console.error(`--target must be one of: ${Object.keys(TARGETS).join(', ')}`)
  process.exit(1)
}

const { ref, url } = TARGETS[target]

async function sbQuery(query) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SB}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await resp.text()
  if (!resp.ok) throw new Error(`${resp.status}: ${text.slice(0, 400)}`)
  return JSON.parse(text)
}

function sqlEscape(s) { return String(s).replace(/'/g, "''") }

async function upsertVaultSecret(name, value, description) {
  // Check if secret exists
  const existing = await sbQuery(
    `SELECT id FROM vault.secrets WHERE name = '${sqlEscape(name)}' LIMIT 1;`
  )
  if (existing.length > 0) {
    const id = existing[0].id
    await sbQuery(`SELECT vault.update_secret('${sqlEscape(id)}', '${sqlEscape(value)}');`)
    return 'updated'
  } else {
    await sbQuery(
      `SELECT vault.create_secret('${sqlEscape(value)}', '${sqlEscape(name)}', '${sqlEscape(description)}');`
    )
    return 'created'
  }
}

async function main() {
  console.log(`configure-breach-alerts → ${target} (${ref})`)

  const r1 = await upsertVaultSecret(
    'breach-alert-pm-api-url',
    url,
    'Vercel deployment URL for breach alert HTTP POST'
  )
  console.log(`  breach-alert-pm-api-url: ${r1} (${url})`)

  const r2 = await upsertVaultSecret(
    'breach-alert-agent-service-key',
    SERVICE_KEY,
    'AGENT_SERVICE_KEY for breach alert PM task creation'
  )
  console.log(`  breach-alert-agent-service-key: ${r2} [value not printed]`)

  console.log(`\n✓ Vault secrets configured on ${target}.`)
  console.log(`  The cron job fires within 5 minutes of the next breach_log INSERT.`)
}

main().catch(e => { console.error('\nFAILED:', e.message || e); process.exit(1) })
