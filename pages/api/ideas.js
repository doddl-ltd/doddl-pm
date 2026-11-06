import { uiRoute, q } from '../../lib/server/uiRoute'
import { createIdea, listIdeas } from '../../lib/pm/hq'

// POST /api/ideas  { text (required), persona?, age_stages?[], channels?[], markets?[], timing?, offer?, must_include?, must_avoid?, measure? }
// GET  /api/ideas[?status=new,picked_up][&mine=1]  -> { ideas[] }
export default uiRoute({
  POST: ({ req, db, user }) => createIdea(db, user.name, req.body || {}),
  GET: ({ req, db, user }) => listIdeas(db, { status: q(req, 'status'), created_by: q(req, 'mine') ? user.name : undefined, limit: q(req, 'limit') }),
}, { status: { POST: 201 } })
