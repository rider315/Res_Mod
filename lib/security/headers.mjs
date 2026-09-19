/**
 * The security headers every response carries (next.config.mjs). Plain
 * JavaScript, because the Next config can't import TypeScript, and the checks
 * read it too (scripts/latex-pipeline-test.js).
 *
 * The Content-Security-Policy names every outside origin a page may use:
 *   - Razorpay Checkout: its scripts, its iframes and the requests they make
 *   - Puter, which the owner's AI settings can run in the browser
 *   - Google's tag, which counts the ad campaign's conversions (components/Analytics.tsx)
 *   - Overleaf and Google sign-in, as the only places a form may post to
 * Anything else a page tries to load is blocked, and the browser reports it to
 * /api/csp-report, so a new third party shows up in the logs the day it breaks.
 *
 * Scripts keep 'unsafe-inline': Next.js writes its own inline bootstrap scripts,
 * and the nonces that would replace it make every page render per request. So
 * the policy's job here is to fence in where scripts, requests and frames may
 * come from and go to, and to stop the site being framed.
 */

/** Checkout's own script also loads Razorpay's fraud check from cdn.razorpay.com. */
const RAZORPAY = 'https://*.razorpay.com'
const PUTER = ['https://puter.com', 'https://*.puter.com']
/** The tag sends conversions to ad.doubleclick.net, and remarketing frames come from td.doubleclick.net. */
const DOUBLECLICK = 'https://*.doubleclick.net'

/** What Google's own guide lists for its tag with Ads conversions. */
const GOOGLE_TAG = [
  'https://www.googletagmanager.com',
  'https://www.googleadservices.com',
  'https://googleads.g.doubleclick.net',
  'https://www.google.com',
]

/** @param {{ development?: boolean }} options */
export function contentSecurityPolicy({ development = false } = {}) {
  /** @type {Record<string, string[]>} */
  const directives = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      "'unsafe-inline'",
      // The dev server's hot reload evaluates code; a production build never does.
      ...(development ? ["'unsafe-eval'"] : []),
      RAZORPAY,
      'https://js.puter.com',
      ...GOOGLE_TAG,
    ],
    'style-src': ["'self'", "'unsafe-inline'"],
    // Images can't run anything, and ad pixels land on a Google domain per country.
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': [
      "'self'",
      RAZORPAY,
      ...PUTER,
      'wss://*.puter.com',
      ...GOOGLE_TAG,
      DOUBLECLICK,
      'https://pagead2.googlesyndication.com',
      'https://www.google.co.in',
      'https://*.google-analytics.com',
      'https://*.analytics.google.com',
      ...(development ? ['ws:', 'wss:'] : []),
    ],
    'frame-src': [RAZORPAY, ...PUTER, DOUBLECLICK, 'https://www.googletagmanager.com'],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'", 'https://www.overleaf.com', 'https://accounts.google.com'],
    'frame-ancestors': ["'none'"],
    'report-uri': ['/api/csp-report'],
  }
  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`)
  if (!development) policy.push('upgrade-insecure-requests')
  return policy.join('; ')
}

/** @param {{ development?: boolean }} options */
export function securityHeaders({ development = false } = {}) {
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy({ development }) },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    // Older browsers ignore frame-ancestors; this says the same to them.
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
    // Puter's sign-in and Razorpay's bank pages open popups that must still reach back.
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  ]
}
