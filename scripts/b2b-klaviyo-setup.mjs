#!/usr/bin/env node
// B2B partners in Klaviyo: one-off set-up and consumer-separation audit (docs/b2b-campaigns/OUTREACH-MAIL.md
// "Warm lead → partner"). DRY-RUN BY DEFAULT: it only reads and prints what it would change.
//
//   node scripts/b2b-klaviyo-setup.mjs            # audit only (reads lists, segments, flows)
//   node scripts/b2b-klaviyo-setup.mjs --apply    # also creates the "B2B partners" list if it is missing
//
// Needs KLAVIYO_API_KEY in the environment (never printed). Prints the list id to put in Vercel as
// B2B_KLAVIYO_LIST_ID. Segment and flow changes are NOT made by this script, even with --apply: it lists every
// consumer segment / flow a B2B partner could fall into and the condition to add (doddl_record_type is not
// "b2b_partner"), for a person to apply in Klaviyo, because a wrong segment edit can e-mail customers.
//
// Same REST style as Documents/doddl-crm/kv.py: https://a.klaviyo.com/api, revision 2025-10-15.

const BASE = 'https://a.klaviyo.com/api'
const REVISION = '2025-10-15'
const LIST_NAME = 'B2B partners'
const APPLY = process.argv.includes('--apply')
const KEY = process.env.KLAVIYO_API_KEY

if (!KEY) {
  console.error('KLAVIYO_API_KEY is not set. Load it into the environment first (it is never printed).')
  process.exit(1)
}

async function call(method, path, body) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(path.startsWith('http') ? path : `${BASE}${path}`, {
      method,
      headers: { authorization: `Klaviyo-API-Key ${KEY}`, revision: REVISION, accept: 'application/vnd.api+json', 'content-type': 'application/vnd.api+json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, Math.min(30000, Number(r.headers.get('retry-after') || 0) * 1000 || 1000 * 2 ** attempt))); continue }
    const text = await r.text()
    if (!r.ok) throw new Error(`${method} ${path.split('?')[0]} -> ${r.status}: ${text.slice(0, 300)}`)
    return text ? JSON.parse(text) : {}
  }
  throw new Error(`${method} ${path}: gave up after retries`)
}

async function paged(path) {
  const out = []
  let next = path
  while (next) {
    const j = await call('GET', next)
    out.push(...(j.data || []))
    next = j.links && j.links.next ? j.links.next : null
  }
  return out
}

// A segment definition "protects" consumers when it already excludes the B2B record type somewhere.
const mentionsRecordType = (obj) => JSON.stringify(obj || {}).includes('doddl_record_type')

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (creates the list if missing; segments and flows are only reported)' : 'DRY RUN (nothing is changed)'}\n`)

  const lists = await paged('/lists?fields[list]=name,created')
  let list = lists.find(l => l.attributes && l.attributes.name === LIST_NAME)
  if (list) console.log(`List "${LIST_NAME}" exists: ${list.id}`)
  else if (APPLY) {
    const j = await call('POST', '/lists', { data: { type: 'list', attributes: { name: LIST_NAME } } })
    list = j.data
    console.log(`Created list "${LIST_NAME}": ${list.id}`)
  } else console.log(`Would create list "${LIST_NAME}".`)
  if (list) console.log(`→ Set Vercel env B2B_KLAVIYO_LIST_ID=${list.id}\n`)

  const segments = await paged('/segments?fields[segment]=name,definition,is_active')
  const atRisk = segments.filter(s => s.attributes && s.attributes.is_active !== false && !mentionsRecordType(s.attributes.definition))
  console.log(`Segments: ${segments.length}; ${atRisk.length} without a doddl_record_type condition (a B2B partner could fall in):`)
  for (const s of atRisk) console.log(`  - ${s.attributes.name} (${s.id}): add condition  doddl_record_type  is not  "b2b_partner"`)

  const flows = await paged('/flows?fields[flow]=name,status,trigger_type')
  const live = flows.filter(f => f.attributes && f.attributes.status === 'live')
  console.log(`\nLive flows: ${live.length}. Check each trigger and add the same profile filter where a partner could enter:`)
  for (const f of live) {
    const fromB2B = /\bb2b\b|trade/i.test(String(f.attributes.name || ''))
    console.log(`  - ${f.attributes.name} (${f.id}) trigger: ${f.attributes.trigger_type || '?'}${fromB2B ? '  [B2B flow: keep it on the B2B list only]' : '  → profile filter: doddl_record_type is not "b2b_partner"'}`)
  }
  console.log('\nThe "B2B partners" list must never trigger or feed a consumer flow. Partners count toward billable profiles (PM\'s Outreach report shows the number).')
}

main().catch(e => { console.error(e.message); process.exit(1) })
