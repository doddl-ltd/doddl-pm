// Service-role Supabase client for server-side code only. The actor string is
// sent as the x-doddl-actor header; the task_history trigger (migration 16)
// records it against every change, e.g. "Jon", "agent:doddl-transcribe",
// "claude-chat (Jon)".

import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export function adminClient(actor = 'system') {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Supabase server credentials are not configured')
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-doddl-actor': String(actor).slice(0, 120) } },
  })
}

export function serviceRoleKey() {
  if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  return SERVICE_KEY
}
