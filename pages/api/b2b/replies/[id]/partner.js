import { uiRoute, q } from '../../../../../lib/server/uiRoute'
import { makePartner } from '../../../../../lib/pm/b2bMail'

// POST /api/b2b/replies/:id/partner { wants: trade_pack | prices | samples | call, first_name?, last_name? }
// "Make partner lead": Klaviyo profile on the "B2B partners" list, prospect -> partner, all sending to it stops.
export default uiRoute({
  POST: ({ req, db, user }) => makePartner(db, user.name, q(req, 'id'), req.body || {}),
})
