import { NextRequest, NextResponse } from 'next/server'
import { isCrossSiteWrite } from '@/lib/security/origin'

/**
 * Every API request passes through here first. It refuses writes that another
 * website started (lib/security/origin.ts); everything else goes on to the
 * route, which does its own sign-in and ownership checks.
 */
export function middleware(req: NextRequest) {
  const request = {
    method: req.method,
    path: req.nextUrl.pathname,
    host: req.headers.get('host'),
    origin: req.headers.get('origin'),
    referer: req.headers.get('referer'),
  }
  if (isCrossSiteWrite(request)) {
    console.warn(`[security] refused a cross-site ${request.method} to ${request.path} from ${request.origin ?? request.referer}`)
    return NextResponse.json({ error: 'This request came from another website, so it was refused.' }, { status: 403 })
  }
  return NextResponse.next()
}

export const config = { matcher: '/api/:path*' }
