import { agentRoute } from '../../../../lib/server/agentRoute'
import { captureUploadUrl, saveCapture } from '../../../../lib/pm/pageCapture'

// Amazon page capture from Chrome on Jon's PC (scope evidence:write, migration 44), daily and before/after a change.
//   POST { action: 'upload_url', asin, marketplace, reason }  -> { key, signed_url }   (PUT the JPEG there)
//   POST { action: 'record', asin, marketplace, reason, change_ref?, date, values: { rating, reviews, title, url, status }, key? }
// The screenshot goes straight to the private bucket listing-evidence; the row is written here, never edited after.
export default agentRoute({
  POST: {
    scope: 'evidence:write',
    run: (req, db, principal) => {
      const b = req.body || {}
      return b.action === 'upload_url' ? captureUploadUrl(db, b) : saveCapture(db, b, principal)
    },
  },
})
