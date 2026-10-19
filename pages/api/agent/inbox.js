import { agentRoute, queryParam } from '../../../lib/server/agentRoute'
import { captureInbox, listInbox, triageInbox } from '../../../lib/pm/ops'
import { retryAutoTriage } from '../../../lib/pm/autoTriage'

// POST  /api/agent/inbox            capture an email / meeting / proposal (idempotent on source+source_ref)
// GET   /api/agent/inbox?status=new list items awaiting triage
// PATCH /api/agent/inbox?id=<uuid>  { decision: accept|dismiss|retry, accept_actions?, edits?, project?, notes? }
// PATCH /api/agent/inbox            { decision: retry, all: true }  ask Claude again for every "needs a look" item
export default agentRoute({
  POST: {
    scope: 'inbox:write',
    run: (req, db, principal) => captureInbox(db, principal, req.body || {}),
    status: (out) => (out.created ? 201 : 200),
  },
  GET: {
    scope: 'tasks:read',
    run: (req, db) => listInbox(db, { status: queryParam(req, 'status') || 'new', auto_status: queryParam(req, 'auto_status'), limit: queryParam(req, 'limit'), offset: queryParam(req, 'offset') }),
  },
  PATCH: {
    scope: 'inbox:triage',
    run: (req, db, principal) => {
      const body = req.body || {}
      if (body.decision === 'retry') return retryAutoTriage(db, principal, { id: queryParam(req, 'id'), all: body.all === true })
      return triageInbox(db, principal, queryParam(req, 'id'), body)
    },
  },
})
