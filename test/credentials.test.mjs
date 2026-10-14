import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveBearer, sha256Hex, newSecret, hasScope } from '../lib/server/credentials.js'

function fakeDb(rows) {
  const from = (table) => {
    const filters = {}
    const api = {
      select() { return api },
      eq(k, v) { filters[k] = v; return api },
      update() { return { eq: async () => ({ error: null }) } },
      async maybeSingle() {
        const row = (rows[table] || []).find(r => Object.entries(filters).every(([k, v]) => r[k] === v))
        return { data: row || null, error: null }
      },
    }
    return api
  }
  return { from }
}

test('agent keys resolve to their agent, never to a caller-chosen id', async () => {
  const key = newSecret('dpm_')
  const db = fakeDb({ agent_keys: [{ id: 1, key_hash: sha256Hex(key), agent_id: 'doddl-transcribe', scopes: ['inbox:write'], revoked_at: null }] })
  const p = await resolveBearer(key, db)
  assert.equal(p.agent_id, 'doddl-transcribe')
  assert.equal(p.actor, 'agent:doddl-transcribe')
  assert.equal(hasScope(p, 'inbox:write'), true)
  assert.equal(hasScope(p, 'tasks:write'), false)
})

test('revoked, unknown and malformed credentials resolve to null', async () => {
  const key = newSecret('dpm_')
  const db = fakeDb({ agent_keys: [{ id: 1, key_hash: sha256Hex(key), agent_id: 'x', scopes: [], revoked_at: '2026-01-01' }] })
  assert.equal(await resolveBearer(key, db), null)
  assert.equal(await resolveBearer(newSecret('dpm_'), db), null)
  assert.equal(await resolveBearer('Bearer junk', db), null)
  assert.equal(await resolveBearer(null, db), null)
})

test('OAuth access tokens act for the approving person and expire', async () => {
  const tok = newSecret('dpo_')
  const future = new Date(Date.now() + 60_000).toISOString()
  const past = new Date(Date.now() - 60_000).toISOString()
  const live = fakeDb({ oauth_tokens: [{ token_hash: sha256Hex(tok), kind: 'access', user_name: 'Jon', client_id: 'c', expires_at: future, revoked_at: null, oauth_clients: { client_name: 'Claude' } }] })
  const p = await resolveBearer(tok, live)
  assert.equal(p.on_behalf_of, 'Jon')
  assert.equal(p.actor, 'Claude (Jon)')
  assert.equal(hasScope(p, 'approvals:write'), false)
  const expired = fakeDb({ oauth_tokens: [{ token_hash: sha256Hex(tok), kind: 'access', user_name: 'Jon', client_id: 'c', expires_at: past, revoked_at: null }] })
  assert.equal(await resolveBearer(tok, expired), null)
})
