import { agentRoute } from '../../../lib/server/agentRoute'
import { searchMedia, useMedia } from '../../../lib/pm/mediaLibrary'

// The doddl image library for Doddl HQ's agents (migration 38, scope media:read): A+ pages, organic social, ads, email.
// GET  /api/agent/media?q=&sku=&type=&channel=&kind=&page=&size=   files with thumbnail links and the channels each is cleared for
// POST /api/agent/media { image_id, channel }                       a public link to the full-size original, only when the file
//                                                                   is cleared for that channel (amazon, website, social, email,
//                                                                   print, retail-b2b)
// Listing images are chosen by a person in doddlHQ; there is no agent route that sets them.
export default agentRoute({
  GET: { scope: 'media:read', run: (req, db) => searchMedia(db, req.query || {}) },
  POST: { scope: 'media:read', run: (req, db) => useMedia(db, { image_id: (req.body || {}).image_id }, { channel: (req.body || {}).channel, requireChannel: true }) },
})
