// Service-role Supabase client for server-side code only. The actor string is
// sent as the x-doddl-actor header; the task_history trigger (migration 16)
// records it against every change, e.g. "Jon", "agent:doddl-transcribe",
// "claude-chat (Jon)".
//
// Pass { viewer } when the client works for a person (a signed-in user, or a
// person's Claude via OAuth): reads, updates and deletes are then limited to
// what that person may see (lib/server/visibility.js, migration 23).

import { createClient } from '@supabase/supabase-js'
import { VIEWER_HEADER, visibilityFetch } from './visibility'

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export function adminClient(actor = 'system', { viewer = null } = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Supabase server credentials are not configured')
  const headers = { 'x-doddl-actor': String(actor).slice(0, 120) }
  if (viewer) headers[VIEWER_HEADER] = String(viewer).slice(0, 120)
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers, ...(viewer ? { fetch: visibilityFetch() } : {}) },
  })
}

export function serviceRoleKey() {
  if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  return SERVICE_KEY
}
