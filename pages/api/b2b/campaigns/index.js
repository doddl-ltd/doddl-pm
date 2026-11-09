import { uiRoute } from '../../../../lib/server/uiRoute'
import { listCampaigns, createCampaign } from '../../../../lib/pm/b2b'

// GET  /api/b2b/campaigns  { tiles, campaigns[] (stage, track, next, nums, waiting, replies_waiting), templates[] }
// POST /api/b2b/campaigns  a new draft: { name?, business_type_id?, definition?, goal?, offers?, market?, volume?,
//                          sample_size?, pace?, channels?, people?, approver? } -> the campaign (201)
export default uiRoute({
  GET: ({ db, user }) => listCampaigns(db, user.name),
  POST: ({ req, db, user }) => createCampaign(db, user.name, req.body || {}),
}, { status: { POST: 201 } })
