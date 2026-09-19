import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

/**
 * How often a sensitive route may be called.
 *
 * Signed-in routes are counted per account in the database, since every
 * serverless instance has to see the same count: one row per limit and account,
 * in fixed windows. A count that can't be taken lets the request through, so a
 * database hiccup never locks anyone out of their own account.
 *
 * The one route anyone can call, the policy reports, is counted in memory per
 * instance instead. Counting it in the database would turn every request of a
 * flood into a database write, which is what a limit is meant to prevent.
 *
 * These stop bursts and guessing. What things cost is metered separately, by the
 * daily AI cap and the monthly allowances (lib/billing).
 */

export interface RateLimit {
  /** Names the counter. */
  name: string
  limit: number
  windowSeconds: number
}

export const RATE_LIMITS = {
  /** Connecting a mailbox signs in to a mail server; without a limit Chills would test stolen passwords for free. */
  mailbox: { name: 'mailbox', limit: 5, windowSeconds: 15 * 60 },
  /** Each starts an order or a subscription at Razorpay. */
  checkout: { name: 'checkout', limit: 10, windowSeconds: 60 * 60 },
  /** Each asks Razorpay about a payment. */
  paymentCheck: { name: 'payment-check', limit: 30, windowSeconds: 60 * 60 },
  /** Reading an uploaded list, a workbook or a Google Sheet is heavy work. */
  recruiterImport: { name: 'recruiter-import', limit: 20, windowSeconds: 60 * 60 },
  /** Reading a PDF or Word file is heavy work. */
  resumeUpload: { name: 'resume-upload', limit: 30, windowSeconds: 60 * 60 },
  /** Each sends a document to the outside LaTeX service. */
  pdfBuild: { name: 'pdf-build', limit: 60, windowSeconds: 60 * 60 },
  /** A page with a policy problem reports a few times, not hundreds. */
  cspReport: { name: 'csp-report', limit: 30, windowSeconds: 60 },
  /**
   * A whole run: a tailoring, a complete application, an optimize or a revamp.
   * Each can hold a serverless function for five minutes, so a burst ties up far
   * more than it spends. Set above the daily AI cap's pace, since what a run
   * costs is already metered; this only stops someone firing twenty at once.
   */
  aiRun: { name: 'ai-run', limit: 20, windowSeconds: 60 * 60 },
  /** The shorter model calls: keywords, a cover letter, structuring an import, reading a reply. */
  aiLight: { name: 'ai-light', limit: 60, windowSeconds: 60 * 60 },
  /** Writing or rewriting a draft, which is a model call and a row. */
  emailWrite: { name: 'email-write', limit: 40, windowSeconds: 60 * 60 },
  /** Sending signs in to the user's own mail server; the daily cap is separate. */
  emailSend: { name: 'email-send', limit: 60, windowSeconds: 60 * 60 },
  /**
   * Anything that writes a row: saving a resume, adding or deleting recruiters,
   * editing a draft, deleting an account. Plain reads are deliberately not
   * limited — every check here is itself a database write, so counting reads
   * would double the app's traffic to guard against something that costs a
   * query.
   */
  mutation: { name: 'mutation', limit: 120, windowSeconds: 60 * 60 },
  /** The owner's own screens. Generous: it is one person, and publishing a list is real work. */
  admin: { name: 'admin', limit: 120, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimit>

export type RateVerdict = { ok: true } | { ok: false; retryAfterSeconds: number }

/** Count one request toward an account's limit, and say whether it may go ahead. */
export async function checkRateLimit(limit: RateLimit, accountId: string): Promise<RateVerdict> {
  const key = `${limit.name}:${accountId}`
  try {
    const result = await getDb().execute(sql`
      insert into rate_limits (key, window_start, hits) values (${key}, now(), 1)
      on conflict (key) do update set
        window_start = case when rate_limits.window_start <= now() - make_interval(secs => ${limit.windowSeconds})
          then now() else rate_limits.window_start end,
        hits = case when rate_limits.window_start <= now() - make_interval(secs => ${limit.windowSeconds})
          then 1 else rate_limits.hits + 1 end
      returning hits, ceil(extract(epoch from window_start + make_interval(secs => ${limit.windowSeconds}) - now()))::int as seconds_left`)
    // Old windows are cleared now and then, rather than by a scheduled job.
    if (Math.random() < 0.01) {
      void getDb().execute(sql`delete from rate_limits where window_start < now() - interval '1 day'`).catch(() => undefined)
    }
    const row = result.rows[0] as { hits: number | string; seconds_left: number | string } | undefined
    if (!row || Number(row.hits) <= limit.limit) return { ok: true }
    return { ok: false, retryAfterSeconds: Math.max(1, Number(row.seconds_left) || limit.windowSeconds) }
  } catch (err) {
    console.warn(`[rate-limit] ${limit.name} could not be counted, so the request goes through:`, err instanceof Error ? err.message : err)
    return { ok: true }
  }
}

const inMemory = new Map<string, { windowStart: number; hits: number }>()

/** The same count kept in this instance's memory, for routes anyone can call. */
export function checkLocalRateLimit(limit: RateLimit, subject: string, now = Date.now()): RateVerdict {
  const key = `${limit.name}:${subject}`
  const windowMs = limit.windowSeconds * 1000
  const entry = inMemory.get(key)
  if (!entry || now - entry.windowStart >= windowMs) {
    // A flood from many addresses mustn't grow the map without end.
    if (inMemory.size > 10_000) inMemory.clear()
    inMemory.set(key, { windowStart: now, hits: 1 })
    return { ok: true }
  }
  entry.hits++
  if (entry.hits <= limit.limit) return { ok: true }
  return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.windowStart + windowMs - now) / 1000)) }
}

/** The caller's address as Vercel saw it; Vercel sets x-real-ip itself, so it can't be forged. */
export function clientAddress(headers: Headers): string {
  return headers.get('x-real-ip') ?? headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

/** The answer to a request over its limit: what happened, and how long to wait. */
export function tooManyRequests(verdict: { retryAfterSeconds: number }, what: string): NextResponse {
  const minutes = Math.ceil(verdict.retryAfterSeconds / 60)
  return NextResponse.json(
    { error: `${what} Try again in ${minutes <= 1 ? 'a minute' : `${minutes} minutes`}.`, code: 'rate_limited' },
    { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSeconds) } }
  )
}
