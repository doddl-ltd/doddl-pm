import { uiRoute } from '../../lib/server/uiRoute'
import { actOnRequest, createRequest, listRequests } from '../../lib/pm/requests'

// GET  /api/requests                         every request (the hub, Standing work, Waiting on me)
// POST /api/requests { kind, mode, fields }  a new request, its plan drafted from the answers
// POST /api/requests { id, op, note?, text? } approve | change | park | reopen | accept | decline | pause | retire | close | change_request | reply
export default uiRoute({
  GET: ({ db }) => listRequests(db),
  POST: ({ req, db, user }) => {
    const b = req.body || {}
    return b.id ? actOnRequest(db, user, b) : createRequest(db, user, b)
  },
}, { status: { POST: 200 } })
