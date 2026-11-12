import { uiRoute } from '../../../lib/server/uiRoute'
import { buildListingCase, updateListingCase } from '../../../lib/pm/cases'

// POST /api/listings/cases { op: 'build', asin, marketplace }    a draft case for Seller Support from the listing's problems
// POST /api/listings/cases { op: 'update', id, status?, amazon_case_id?, note?, body? }
// Nothing is sent to Amazon from here: a person files the case in Seller Central.
export default uiRoute({
  POST: ({ req, db, user }) => {
    const b = req.body || {}
    if (b.op === 'build') return buildListingCase(db, user, b)
    if (b.op === 'update') return updateListingCase(db, user, b)
    throw Object.assign(new Error('op must be build or update'), { status: 400, expose: true })
  },
})
