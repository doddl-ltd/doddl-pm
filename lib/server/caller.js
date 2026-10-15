// Who is calling a non-agent API route: a signed-in doddl person (MSAL ID
// token) or an agent credential (agent key / OAuth token) with the scope.
// Sends 401/403 and returns null when neither is valid.

import { bearerFrom, verifyIdToken } from './msalVerify'
import { resolveBearer, hasScope, AGENT_KEY_PREFIX, ACCESS_TOKEN_PREFIX } from './credentials'
import { adminClient } from './admin'

export async function requireCaller(req, res, { agentScope } = {}) {
  const token = bearerFrom(req)
  if (token && (token.startsWith(AGENT_KEY_PREFIX) || token.startsWith(ACCESS_TOKEN_PREFIX))) {
    const principal = await resolveBearer(token, adminClient('auth'))
    if (!principal) { res.status(401).json({ error: 'Invalid credential' }); return null }
    if (agentScope && !hasScope(principal, agentScope)) { res.status(403).json({ error: `Credential lacks "${agentScope}"` }); return null }
    return { actor: principal.actor, principal }
  }
  try {
    const user = await verifyIdToken(token)
    return { actor: user.name, user }
  } catch (e) {
    res.status(401).json({ error: e.message || 'Unauthorised' })
    return null
  }
}

export function pick(obj, keys) {
  const out = {}
  for (const k of keys) if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k]
  return out
}
