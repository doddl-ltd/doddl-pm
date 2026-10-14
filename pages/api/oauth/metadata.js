import { baseUrl, authorizationServerMetadata, protectedResourceMetadata } from '../../../lib/server/oauth'

// Served at /.well-known/oauth-authorization-server and
// /.well-known/oauth-protected-resource[/api/mcp] via next.config.js rewrites.
export default function handler(req, res) {
  const base = baseUrl(req)
  res.setHeader('Cache-Control', 'public, max-age=300')
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.query.kind === 'resource') return res.status(200).json(protectedResourceMetadata(base))
  return res.status(200).json(authorizationServerMetadata(base))
}
