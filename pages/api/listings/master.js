import { uiRoute } from '../../../lib/server/uiRoute'
import { saveMasterChange } from '../../../lib/pm/hq'
import { planSend, saveVariantChange, sendMaster, translateVariant } from '../../../lib/pm/masterSend'

// POST /api/listings/master { asin, op, ... }
//   copy | attribute | keep | images | approve | reopen      change the master (UK English, one attribute set, images per locale)
//   translate { locale }                                       Claude translates the master for one non-English market (about $0.04)
//   variant_copy | variant_attr | variant_approve { locale }   a person checks and approves the translation (the language review)
//   plan { markets? }                                          what each market would change to match the master
//   send { markets }                                           those changes become submitted edits: HQ checks them, one approval per market
// Nothing here writes to Amazon.
export const config = { maxDuration: 120 }

export default uiRoute({
  POST: async ({ req, db, user }) => {
    const b = req.body || {}
    const asin = typeof b.asin === 'string' ? b.asin.trim().toUpperCase() : ''
    if (b.op === 'translate') return translateVariant(db, user, { asin, locale: b.locale })
    if (['variant_copy', 'variant_attr', 'variant_approve'].includes(b.op)) return saveVariantChange(db, user, { ...b, asin })
    if (b.op === 'plan') { const r = await planSend(db, { asin, markets: b.markets }); return { asin, plans: r.plans } }
    if (b.op === 'send') return sendMaster(db, user, { asin, markets: b.markets })
    return saveMasterChange(db, user, b)
  },
})
