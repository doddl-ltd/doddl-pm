// Small helper for the app's own API routes (Approvals v2): the caller must be a signed-in doddl person,
// verified from the Microsoft ID token exactly as /api/db does (lib/server/msalVerify.js). The handler gets
// a service-role client that acts as that person (x-doddl-actor) and only sees what they may see
// (x-doddl-viewer, migration 23). PM errors (e.expose) come back as JSON with their status.

import { requireUser } from './msalVerify'
import { adminClient } from './admin'

// routes: { GET: async ({ req, db, user }) => body, POST: ..., status?: { POST: 201 } }
export function uiRoute(routes, { status = {} } = {}) {
  return async function handler(req, res) {
    const run = routes[req.method]
    if (!run) {
      res.setHeader('Allow', Object.keys(routes).join(', '))
      return res.status(405).json({ error: 'Method not allowed' })
    }
    const user = await requireUser(req, res)
    if (!user) return
    try {
      const db = adminClient(user.name, { viewer: user.name })
      const out = await run({ req, db, user })
      res.setHeader('Cache-Control', 'no-store')
      return res.status(status[req.method] || 200).json(out)
    } catch (e) {
      if (e.expose) return res.status(e.status || 400).json({ error: e.message })
      console.error('api error:', e)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }
}

export function q(req, name) {
  const v = req.query[name]
  return Array.isArray(v) ? v[0] : v
}
