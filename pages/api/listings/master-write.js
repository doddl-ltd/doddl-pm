import { uiRoute } from '../../../lib/server/uiRoute'
import { writeMasterCopy, writeSearchTerms } from '../../../lib/pm/copyWriter'

// POST /api/listings/master-write { asin, terms?, focus? }: Claude writes a new title, bullets, description and search
// terms for the UK master from the key terms, UK Brand Analytics searches, the product facts and the copy in place
// (lib/pm/copyWriter.js, about $0.08). Nothing is saved: the person takes the fields they want.
export const config = { maxDuration: 120 }

export default uiRoute({
  POST: async ({ req, db, user }) => ((req.body || {}).op === 'search_terms' ? writeSearchTerms(db, user, req.body) : writeMasterCopy(db, user, req.body || {})),
})
