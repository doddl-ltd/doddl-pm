// Who sees what (migration 23-pm-visibility; Jon, 2026-10-22). The rules live in the database as PostgREST
// computed fields, pm_visible(<table>). Server code that reads or changes PM rows *for a person* names that
// person in the x-doddl-viewer header and adds pm_visible=is.true, so the database returns and touches only
// what they may see. Server code acting for itself (auto-triage, agent keys, scripts) sends no viewer and
// sees everything. The browser never reaches PostgREST directly (17-pm-lockdown), so it cannot set either.

export const VIEWER_HEADER = 'x-doddl-viewer'

// Tables with a pm_visible computed field (migration 23).
export const VISIBILITY_TABLES = new Set([
  'projects', 'tasks', 'task_groups', 'comments', 'task_links', 'task_history', 'notifications', 'inbox_items',
])

const FILTERED_METHODS = new Set(['GET', 'HEAD', 'PATCH', 'DELETE'])

/**
 * The PostgREST query string with the visibility filter added for a person's request. PostgREST ANDs every
 * top-level filter, so nothing else in the query (an `or=`, a client-sent pm_visible) can widen it.
 */
export function withVisibility(table, method, query = '') {
  if (!VISIBILITY_TABLES.has(table) || !FILTERED_METHODS.has(String(method).toUpperCase())) return query
  return query ? `${query}&pm_visible=is.true` : 'pm_visible=is.true'
}

/**
 * A fetch for supabase-js that applies withVisibility to every /rest/v1/<table> call, so library code
 * (lib/pm/ops.js etc.) stays the same whether it runs for a person or for the system.
 */
export function visibilityFetch(fetchImpl = globalThis.fetch) {
  return (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const m = /\/rest\/v1\/([^/?]+)$/.exec(url.pathname)
    if (m && VISIBILITY_TABLES.has(m[1]) && FILTERED_METHODS.has(String(init.method || 'GET').toUpperCase())) {
      url.searchParams.append('pm_visible', 'is.true')
    }
    return fetchImpl(url.toString(), init)
  }
}

/** The doddl person a credential acts for: a signed-in person or an OAuth (Claude connector) principal. */
export function viewerFor({ user, principal } = {}) {
  if (user && user.name) return user.name
  if (principal && principal.kind === 'oauth' && principal.on_behalf_of) return principal.on_behalf_of
  return null
}
