import { uiRoute, q } from '../../../../lib/server/uiRoute'
import { listReplies } from '../../../../lib/pm/b2b'

// GET /api/b2b/replies[?mine=1][&status=needs_person|sent|closed|auto|all]  replies waiting, soonest due first
export default uiRoute({
  GET: ({ req, db, user }) => listReplies(db, user.name, { mine: q(req, 'mine') === '1', status: q(req, 'status') || 'needs_person' }),
})
