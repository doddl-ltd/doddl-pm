// doddlHQ serves the Hub (doddl-reports) from this address: its pages, its API and its public files. The Hub loads
// its scripts from its own address (assetPrefix in doddl-reports next.config.js), so only these paths need routing.
const HUB = 'https://doddl-reports.vercel.app'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // OAuth discovery for the MCP connector (lib/server/oauth.js), and the Hub under /hub.
  async rewrites() {
    return [
      { source: '/hub', destination: `${HUB}/hub` },
      { source: '/hub/:path*', destination: `${HUB}/hub/:path*` },
      { source: '/api/hub/:path*', destination: `${HUB}/api/hub/:path*` },
      { source: '/.well-known/oauth-protected-resource', destination: '/api/oauth/metadata?kind=resource' },
      { source: '/.well-known/oauth-protected-resource/:path*', destination: '/api/oauth/metadata?kind=resource' },
      { source: '/.well-known/oauth-authorization-server', destination: '/api/oauth/metadata?kind=server' },
      { source: '/.well-known/oauth-authorization-server/:path*', destination: '/api/oauth/metadata?kind=server' },
    ]
  },
}
module.exports = nextConfig
