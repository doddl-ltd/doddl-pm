import { adminClient } from '../../lib/server/admin'
import { requireCaller, pick } from '../../lib/server/caller'

// Task groups REST route. Requires a signed-in doddl person or an agent
// credential. DELETE archives the group and moves its tasks to "ungrouped".
export default async function handler(req, res) {
  const write = req.method !== 'GET'
  const caller = await requireCaller(req, res, { agentScope: write ? 'tasks:write' : 'tasks:read' })
  if (!caller) return
  const supabase = adminClient(caller.actor)
  const { id, project_id } = req.query

  if (req.method === 'GET') {
    let query = supabase.from('task_groups').select('*').is('archived_at', null).order('position', { ascending: true })
    if (project_id) query = query.eq('project_id', project_id)
    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data)
  }

  if (req.method === 'POST') {
    const { project_id: bodyProjectId, name, position } = req.body || {}
    if (!bodyProjectId) return res.status(400).json({ error: 'project_id is required' })
    if (!name) return res.status(400).json({ error: 'name is required' })
    const { data, error } = await supabase.from('task_groups').insert([{ project_id: bodyProjectId, name, position: position ?? 0 }]).select().single()
    if (error) return res.status(400).json({ error: error.message })
    return res.status(201).json(data)
  }

  if (req.method === 'PATCH') {
    if (!id) return res.status(400).json({ error: 'id query param is required' })
    const { data, error } = await supabase.from('task_groups').update(pick(req.body, ['name', 'position'])).eq('id', id).select().single()
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json(data)
  }

  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ error: 'id query param is required' })
    const { error } = await supabase.from('task_groups').update({ archived_at: new Date().toISOString() }).eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    const { error: e2 } = await supabase.from('tasks').update({ group_id: null }).eq('group_id', id)
    if (e2) return res.status(500).json({ error: e2.message })
    return res.status(204).end()
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
