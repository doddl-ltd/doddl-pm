/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // OAuth discovery for the MCP connector (lib/server/oauth.js).
  async rewrites() {
    return [
      { source: '/.well-known/oauth-protected-resource', destination: '/api/oauth/metadata?kind=resource' },
      { source: '/.well-known/oauth-protected-resource/:path*', destination: '/api/oauth/metadata?kind=resource' },
      { source: '/.well-known/oauth-authorization-server', destination: '/api/oauth/metadata?kind=server' },
      { source: '/.well-known/oauth-authorization-server/:path*', destination: '/api/oauth/metadata?kind=server' },
    ]
  },
}
module.exports = nextConfig
