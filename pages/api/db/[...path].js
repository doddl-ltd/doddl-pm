import { createDbProxy } from '../../../lib/server/dbProxy'
import { verifyIdToken, bearerFrom } from '../../../lib/server/msalVerify'
import { SUPABASE_URL, serviceRoleKey } from '../../../lib/server/admin'

// Raw body is forwarded to PostgREST, so Next must not parse it.
export const config = { api: { bodyParser: false } }

export default createDbProxy({
  verifyUser: (req) => verifyIdToken(bearerFrom(req)),
  supabaseUrl: SUPABASE_URL,
  get serviceKey() { return serviceRoleKey() },
})
