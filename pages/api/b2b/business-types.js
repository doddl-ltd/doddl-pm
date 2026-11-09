import { uiRoute } from '../../../lib/server/uiRoute'
import { listBusinessTypes, saveBusinessType } from '../../../lib/pm/b2b'

// GET  /api/b2b/business-types  { types[], people[] } templates first, each with campaigns / live / learned_count
// POST /api/b2b/business-types  "Save as a business type": { name, definition, description?, defaults? } -> the type (201)
export default uiRoute({
  GET: ({ db }) => listBusinessTypes(db),
  POST: ({ req, db, user }) => saveBusinessType(db, user.name, req.body || {}),
}, { status: { POST: 201 } })
