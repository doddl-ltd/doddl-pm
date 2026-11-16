import { uiRoute } from '../../../lib/server/uiRoute'
import { searchMedia, syncMediaLibrary, useMedia } from '../../../lib/pm/mediaLibrary'

// GET  /api/media?q=&sku=&type=&channel=&kind=&page=   the image library (OneDrive "doddl HQ Knowledge/14 Media"), with thumbnails
// POST /api/media { op: 'sync' }                       refresh the index from imagery-index.csv now (it also runs daily)
// POST /api/media { op: 'use', image_id }              copy one image (once) into the listing image store for Amazon
export const config = { maxDuration: 120 }

export default uiRoute({
  GET: async ({ req, db }) => searchMedia(db, req.query || {}),
  POST: async ({ req, db }) => {
    const b = req.body || {}
    if (b.op === 'sync') return syncMediaLibrary(db)
    if (b.op === 'use') return useMedia(db, { image_id: b.image_id })
    const e = new Error('op must be sync or use'); e.status = 400; e.expose = true; throw e
  },
})
