// Bearer credentials accepted by the agent API and the MCP endpoint.
//
//   dpm_...  per-agent API key (agent_keys). Identity comes from the key, not
//            from a header the caller chooses. Plaintext only in Key Vault.
//   dpo_...  OAuth access token issued to a Claude connector (oauth_tokens),
//            acting on behalf of the doddl person who approved it.
//
// Only sha256 hashes are stored, so a database read never yields a usable key.

import crypto from 'crypto'

export const AGENT_KEY_PREFIX    = 'dpm_'
export const ACCESS_TOKEN_PREFIX = 'dpo_'
export const REFRESH_TOKEN_PREFIX = 'dpr_'

// What a person's Claude session may do through OAuth. Approve/reject stays
// in the PM UI only — no credential type carries that power.
export const OAUTH_SCOPES = ['tasks:read', 'tasks:write', 'inbox:write', 'inbox:triage']

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

export function newSecret(prefix) {
  return prefix + crypto.randomBytes(32).toString('base64url')
}

export function constantTimeEqual(a, b) {
  const aBuf = Buffer.from(String(a), 'utf8')
  const bBuf = Buffer.from(String(b), 'utf8')
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}

// Resolve a bearer token to a principal, or null.
// Principal: { kind, agent_id, actor, scopes, on_behalf_of }
export async function resolveBearer(token, db, now = new Date()) {
  if (!token || typeof token !== 'string') return null
  const hash = sha256Hex(token)

  if (token.startsWith(AGENT_KEY_PREFIX)) {
    const { data, error } = await db.from('agent_keys')
      .select('id, agent_id, scopes, revoked_at, last_used_at')
      .eq('key_hash', hash).maybeSingle()
    if (error || !data || data.revoked_at) return null
    const stale = !data.last_used_at || now - new Date(data.last_used_at) > 5 * 60_000
    if (stale) await db.from('agent_keys').update({ last_used_at: now.toISOString() }).eq('id', data.id)
    return {
      kind: 'agent_key',
      agent_id: data.agent_id,
      actor: `agent:${data.agent_id}`,
      scopes: data.scopes || [],
      on_behalf_of: null,
    }
  }

  if (token.startsWith(ACCESS_TOKEN_PREFIX)) {
    const { data, error } = await db.from('oauth_tokens')
      .select('client_id, user_name, kind, expires_at, revoked_at, oauth_clients(client_name)')
      .eq('token_hash', hash).eq('kind', 'access').maybeSingle()
    if (error || !data || data.revoked_at || new Date(data.expires_at) <= now) return null
    const client = (data.oauth_clients && data.oauth_clients.client_name) || 'Claude'
    return {
      kind: 'oauth',
      agent_id: `oauth:${data.user_name}`,
      actor: `${client} (${data.user_name})`,
      scopes: OAUTH_SCOPES,
      on_behalf_of: data.user_name,
    }
  }

  return null
}

export function hasScope(principal, scope) {
  return !!principal && Array.isArray(principal.scopes) && principal.scopes.includes(scope)
}
