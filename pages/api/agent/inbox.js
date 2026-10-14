import { agentRoute, queryParam } from '../../../lib/server/agentRoute'
import { captureInbox, listInbox, triageInbox } from '../../../lib/pm/ops'

// POST  /api/agent/inbox            capture an email / meeting / proposal (idempotent on source+source_ref)
// GET   /api/agent/inbox?status=new list items awaiting triage
// PATCH /api/agent/inbox?id=<uuid>  { decision: accept|dismiss, accept_actions?, edits?, project?, notes? }
export default agentRoute({
  POST: {
    scope: 'inbox:write',
    run: (req, db, principal) => captureInbox(db, principal, req.body || {}),
    status: (out) => (out.created ? 201 : 200),
  },
  GET: {
    scope: 'tasks:read',
    run: (req, db) => listInbox(db, { status: queryParam(req, 'status') || 'new', limit: queryParam(req, 'limit'), offset: queryParam(req, 'offset') }),
  },
  PATCH: {
    scope: 'inbox:triage',
    run: (req, db, principal) => triageInbox(db, principal, queryParam(req, 'id'), req.body || {}),
  },
})
