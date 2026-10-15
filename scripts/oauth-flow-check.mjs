// Exercises the OAuth code -> token -> refresh -> MCP path against STAGING,
// skipping only the Microsoft sign-in (a code is issued directly for a test
// user). Refuses to run against production.
//
//   node --import ./test/setup.mjs scripts/oauth-flow-check.mjs [http://localhost:3107]

import fs from 'node:fs'
import crypto from 'node:crypto'

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=')
  if (line && !line.startsWith('#') && i > 0 && !process.env[line.slice(0, i).trim()]) {
    process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '')
  }
}
if (!String(process.env.NEXT_PUBLIC_SUPABASE_URL).includes('iknwprxycshrickpswjz')) throw new Error('staging only')

const BASE = process.argv[2] || 'http://localhost:3107'
const { adminClient } = await import('../lib/server/admin.js')
const { registerClient, issueCode, exchangeCode, refreshTokens, pkceS256 } = await import('../lib/server/oauth.js')

const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`); if (!cond) process.exitCode = 1 }
const db = adminClient('oauth-flow-check')
const redirect = 'http://localhost/callback'
const client = await registerClient(db, { client_name: 'Claude Code (check)', redirect_uris: [redirect] })
const verifier = crypto.randomBytes(32).toString('base64url')
const params = { client_id: client.client_id, redirect_uri: 'http://localhost:51234/callback', code_challenge: pkceS256(verifier), code_challenge_method: 'S256', response_type: 'code' }

const code = await issueCode(db, { name: 'Jon', email: 'jon@doddl.com' }, params)
let bad = null
try { await exchangeCode(db, { code, client_id: client.client_id, redirect_uri: params.redirect_uri, code_verifier: crypto.randomBytes(32).toString('base64url') }) } catch (e) { bad = e.code }
ok('wrong PKCE verifier rejected (and burns the code)', bad === 'invalid_grant')

const code2 = await issueCode(db, { name: 'Jon', email: 'jon@doddl.com' }, params)
const tokens = await exchangeCode(db, { code: code2, client_id: client.client_id, redirect_uri: params.redirect_uri, code_verifier: verifier })
ok('code exchanged for access + refresh tokens', tokens.access_token.startsWith('dpo_') && tokens.refresh_token.startsWith('dpr_') && tokens.expires_in === 3600)
let reuse = null
try { await exchangeCode(db, { code: code2, client_id: client.client_id, redirect_uri: params.redirect_uri, code_verifier: verifier }) } catch (e) { reuse = e.code }
ok('code is single-use', reuse === 'invalid_grant')

const mcp = async (token, body) => {
  const r = await fetch(`${BASE}/api/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => null) }
}
let r = await mcp(tokens.access_token, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
const names = (r.json?.result?.tools || []).map(t => t.name)
ok('OAuth session acts for Jon: can triage, cannot submit approvals', names.includes('triage_inbox_item') && !names.includes('submit_for_approval'), names.length + ' tools')

const rotated = await refreshTokens(db, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id })
ok('refresh rotates both tokens', rotated.refresh_token !== tokens.refresh_token && rotated.access_token !== tokens.access_token)
let stolen = null
try { await refreshTokens(db, { refresh_token: tokens.refresh_token, client_id: client.client_id }) } catch (e) { stolen = e.code }
ok('replayed refresh token rejected', stolen === 'invalid_grant')
r = await mcp(rotated.access_token, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
ok('replay revokes the whole token family', r.status === 401, `status ${r.status}`)

// Tidy: revoke the check client's tokens (rows stay for audit).
await db.from('oauth_tokens').update({ revoked_at: new Date().toISOString() }).eq('client_id', client.client_id).is('revoked_at', null)
