// Small helper for agent REST routes: method dispatch with a scope per method,
// a service-role client stamped with the caller as actor, and PM errors
// (lib/pm/ops.js pmError) returned as JSON with their status.

import { withAgentAuth } from '../agentAuth'
import { hasScope } from './credentials'
import { adminClient } from './admin'

// routes: { GET: { scope, run: async (req, db, principal) => body, status? }, ... }
export function agentRoute(routes) {
  return withAgentAuth(async (req, res, principal) => {
    const route = routes[req.method]
    if (!route) {
      res.setHeader('Allow', Object.keys(routes).join(', '))
      return res.status(405).json({ error: 'Method not allowed' })
    }
    if (route.scope && !hasScope(principal, route.scope)) {
      return res.status(403).json({ error: `This credential lacks the "${route.scope}" scope` })
    }
    try {
      const db = adminClient(principal.actor)
      const out = await route.run(req, db, principal)
      const status = typeof route.status === 'function' ? route.status(out) : (route.status || 200)
      return res.status(status).json(out)
    } catch (e) {
      if (e.expose) return res.status(e.status || 400).json({ error: e.message })
      throw e
    }
  })
}

export function queryParam(req, name) {
  const v = req.query[name]
  return Array.isArray(v) ? v[0] : v
}
