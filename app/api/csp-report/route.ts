import { NextRequest, NextResponse } from 'next/server'
import { checkLocalRateLimit, clientAddress, RATE_LIMITS } from '@/lib/security/rate-limit'

/**
 * Where browsers report what the Content-Security-Policy blocked
 * (lib/security/headers.mjs). Each report becomes one log line, so a third
 * party the policy doesn't know about shows up in the logs the day it breaks.
 *
 * Anyone can post here, so reports are capped per address and in size, and
 * only the parts of a URL before any query are logged: a query can carry a
 * token.
 */

const MAX_REPORT_BYTES = 16 * 1024

const done = () => new NextResponse(null, { status: 204 })

/** A URL without its query and fragment; the keywords browsers use ("inline", "eval") as they are. */
function withoutQuery(value: unknown): string {
  if (typeof value !== 'string' || !value) return '?'
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return value.slice(0, 80)
  }
}

export async function POST(req: NextRequest) {
  if (!checkLocalRateLimit(RATE_LIMITS.cspReport, clientAddress(req.headers)).ok) return done()
  if (Number(req.headers.get('content-length') ?? 0) > MAX_REPORT_BYTES) return done()

  let body: unknown
  try {
    body = JSON.parse((await req.text()).slice(0, MAX_REPORT_BYTES))
  } catch {
    return done()
  }

  // report-uri sends { "csp-report": {…} }; the Reporting API sends [{ type, body }].
  const reports = Array.isArray(body)
    ? body.map((entry) => (entry as { body?: Record<string, unknown> })?.body ?? {})
    : [((body as { 'csp-report'?: Record<string, unknown> })?.['csp-report'] ?? {}) as Record<string, unknown>]
  for (const report of reports.slice(0, 5)) {
    const directive = report['effective-directive'] ?? report.effectiveDirective ?? report['violated-directive'] ?? '?'
    const blocked = withoutQuery(report['blocked-uri'] ?? report.blockedURL)
    const page = withoutQuery(report['document-uri'] ?? report.documentURL)
    console.warn(`[csp] ${String(directive).slice(0, 40)} blocked ${blocked} on ${page}`)
  }
  return done()
}
