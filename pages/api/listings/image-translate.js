import { uiRoute } from '../../../lib/server/uiRoute'
import { decideImage, listImageTranslations, readImage, renderedImage } from '../../../lib/pm/imageTranslate'

// Listing images translated per market (migration 39, lib/pm/imageTranslate.js).
// GET  /api/listings/image-translate?asin=&locale=                   every translation for the ASIN (one market)
// POST { op: 'read', asin, locale, url, slot, redo? }                 Claude reads the words and translates them (about $0.02)
// POST { op: 'rendered', id, url }                                    the browser's repainted image; Claude checks it (about $0.01)
// POST { op: 'approve' | 'reject', id, note? }                        a person's decision; approve puts it in the market's set
// Nothing here writes to Amazon.
export const config = { maxDuration: 120 }

export default uiRoute({
  GET: async ({ req, db }) => listImageTranslations(db, req.query || {}),
  POST: async ({ req, db, user }) => {
    const b = req.body || {}
    if (b.op === 'read') return readImage(db, user, b)
    if (b.op === 'rendered') return renderedImage(db, user, b)
    return decideImage(db, user, b)
  },
})
