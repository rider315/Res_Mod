import { securityHeaders } from './lib/security/headers.mjs'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't announce the framework to anyone probing for its known holes.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders({ development: process.env.NODE_ENV !== 'production' }) }]
  },
}

export default nextConfig
