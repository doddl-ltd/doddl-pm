import { uiRoute, q } from '../../../../../lib/server/uiRoute'
import { campaignDetail, patchCampaign } from '../../../../../lib/pm/b2b'

// GET   /api/b2b/campaigns/:id[?page=&page_size=&status=]  definition, track, approvals, prospects (paged),
//                                                          contacts to add (role/type only), replies
// PATCH /api/b2b/campaigns/:id  edit a draft (the wizard autosaves here), or { action: pause | resume | cancel }
export default uiRoute({
  GET: ({ req, db }) => campaignDetail(db, q(req, 'id'), { page: q(req, 'page'), page_size: q(req, 'page_size'), status: q(req, 'status') }),
  PATCH: ({ req, db, user }) => patchCampaign(db, user.name, q(req, 'id'), req.body || {}),
})
