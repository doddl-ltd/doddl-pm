import { uiRoute, q } from '../../../lib/server/uiRoute'
import { outreachReport } from '../../../lib/pm/b2bMail'

// GET /api/b2b/report?campaign_id=&mailbox_id=&by=day|week|all  sent (by step), delivered, bounces, opens (null = not
// measured), clicks (scanners left out), replies by kind, auto-replies, opt-outs, the funnel, still to send, contacts
// missing, partners in Klaviyo.
export default uiRoute({
  GET: ({ req, db }) => outreachReport(db, { campaign_id: q(req, 'campaign_id') || null, mailbox_id: q(req, 'mailbox_id') || null, by: q(req, 'by') || 'all' }),
})
