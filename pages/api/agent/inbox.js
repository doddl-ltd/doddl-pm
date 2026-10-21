import { agentRoute, queryParam } from '../../../lib/server/agentRoute'
import { adminClient } from '../../../lib/server/admin'
import { captureInbox, listInbox, triageInbox } from '../../../lib/pm/ops'
import { retryAutoTriage, fileNowIfRouted, AUTO_ACTOR } from '../../../lib/pm/autoTriage'

// POST  /api/agent/inbox            capture an email / meeting / proposal (idempotent on source+source_ref);
//                                   meetings, Teams messages and flagged e-mails are filed straight away
//                                   (lib/pm/routing.js), everything else by the auto-triage cron
// GET   /api/agent/inbox?status=new list items awaiting triage
// PATCH /api/agent/inbox?id=<uuid>  { decision: accept|dismiss|retry, accept_actions?, edits?, project?, notes? }
// PATCH /api/agent/inbox            { decision: retry, all: true }  ask Claude again for every "needs a look" item
export default agentRoute({
  POST: {
    scope: 'inbox:write',
    run: async (req, db, principal) => {
      const out = await captureInbox(db, principal, req.body || {})
      if (!out.created) return out
      const filed = await fileNowIfRouted(adminClient(AUTO_ACTOR), out.id)
      return filed ? { ...out, filed: true, auto_status: filed.auto_status } : out
    },
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
