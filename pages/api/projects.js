import { adminClient } from '../../lib/server/admin'
import { requireCaller, pick } from '../../lib/server/caller'

// Projects REST route. Requires a signed-in doddl person or an agent
// credential. DELETE archives (Hard Rule 9: never hard-delete).
const EDITABLE = ['name', 'description', 'status', 'priority', 'owner', 'start_date', 'due_date', 'color']

export default async function handler(req, res) {
  const write = req.method !== 'GET'
  const caller = await requireCaller(req, res, { agentScope: write ? 'tasks:write' : 'tasks:read' })
  if (!caller) return
  const supabase = adminClient(caller.actor)
  const { id } = req.query

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('projects').select('*').is('archived_at', null).order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data)
  }

  if (req.method === 'POST') {
    const body = req.body || {}
    if (!body.name) return res.status(400).json({ error: 'name is required' })
    const { data, error } = await supabase.from('projects').insert([{
      status: 'active', priority: 'medium', ...pick(body, EDITABLE),
    }]).select().single()
    if (error) return res.status(400).json({ error: error.message })
    return res.status(201).json(data)
  }

  if (req.method === 'PATCH') {
    if (!id) return res.status(400).json({ error: 'id query param is required' })
    const { data, error } = await supabase.from('projects').update(pick(req.body, EDITABLE)).eq('id', id).select().single()
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json(data)
  }

  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ error: 'id query param is required' })
    const now = new Date().toISOString()
    const { error } = await supabase.from('projects').update({ archived_at: now }).eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(204).end()
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
