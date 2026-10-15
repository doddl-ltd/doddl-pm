// Browser Supabase client. Requests go to our own /api/db proxy with the
// signed-in person's Microsoft ID token instead of straight to Supabase with
// the public anon key, so the database is only reachable by doddl staff.
// Component code is unchanged: it still uses supabase.from(...) as before.

import { createClient } from '@supabase/supabase-js'
import { getIdToken } from './msal'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL

async function proxiedFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input.url
  const target = url.startsWith(SUPABASE_URL) ? `/api/db${url.slice(SUPABASE_URL.length)}` : url
  const headers = new Headers(init.headers || {})
  headers.delete('apikey')
  headers.delete('authorization')
  const token = await getIdToken()
  if (token) headers.set('authorization', `Bearer ${token}`)
  return fetch(target, { ...init, headers })
}

export const supabase = createClient(SUPABASE_URL, 'via-api-db-proxy', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: proxiedFetch },
})

// Same auth for calls to our other API routes (triage, audit log).
export async function apiFetch(path, init = {}) {
  const headers = new Headers(init.headers || {})
  const token = await getIdToken()
  if (token) headers.set('authorization', `Bearer ${token}`)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  return fetch(path, { ...init, headers })
}
