/**
 * Refusing writes that another website started (cross-site request forgery).
 *
 * The session cookie is SameSite=Lax, so most cross-site posts already arrive
 * without it. This is the second lock, as OWASP recommends: a browser names the
 * page that started every POST, PUT, PATCH or DELETE in its Origin header (and
 * failing that, its Referer), and a write whose page isn't on this site's own
 * host is refused. A request that names no page at all didn't come from a web
 * page, so there is no signed-in visitor for it to ride on, and it goes through
 * to the route's own sign-in check.
 *
 * Edge-safe and free of imports: it runs in middleware.ts.
 */

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Routes that aren't called by this site's pages, or check their callers their
 * own way: NextAuth has its own CSRF token, Razorpay's webhook is signed, and
 * the browser's policy reports don't carry the session.
 */
const OWN_CHECKS = [/^\/api\/auth\//, /^\/api\/billing\/webhook$/, /^\/api\/csp-report$/]

export interface WriteRequest {
  method: string
  /** The path, such as "/api/resumes". */
  path: string
  /** Where the request says it is going: the Host header, such as "chills.pro". */
  host: string | null
  origin: string | null
  referer: string | null
}

/** Whether a write was started by a page on another site, and so must be refused. */
export function isCrossSiteWrite(request: WriteRequest): boolean {
  if (!WRITES.has(request.method.toUpperCase())) return false
  if (OWN_CHECKS.some((route) => route.test(request.path))) return false

  const source = request.origin ?? request.referer
  if (!source) return false
  // Sandboxed frames, data: pages and privacy-stripped redirects say "null".
  if (source === 'null' || !request.host) return true
  try {
    return new URL(source).host.toLowerCase() !== request.host.toLowerCase()
  } catch {
    return true
  }
}
