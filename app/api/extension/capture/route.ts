import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/require-auth'
import { checkRateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/security/rate-limit'
import {
  captureJob,
  countJobs,
  deleteJob,
  getJob,
  JOB_STATUSES,
  jobByUrl,
  listJobs,
  MAX_CAPTURED_JOBS,
  updateJob,
} from '@/lib/db/extension'
import { ensureUser } from '@/lib/db/resumes'

/**
 * The jobs the extension picks up off a page, and what became of them.
 *
 * A posting is kept so the description does not have to be carried by hand from
 * a job board into Chills, and so the list can answer "what have I applied to" —
 * which the email tracker cannot, because it only knows the jobs that led to an
 * email.
 */

const captureSchema = z.object({
  url: z.string().trim().url('That page has no address Chills can keep.').max(2_000),
  source: z.string().trim().max(40).default('other'),
  title: z.string().trim().max(200).default(''),
  company: z.string().trim().max(200).default(''),
  location: z.string().trim().max(200).default(''),
  description: z.string().trim().max(20_000).default(''),
})

const patchSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(JOB_STATUSES).optional(),
  score: z.number().int().min(0).max(100).nullable().optional(),
})

const fail = (status: number, error: string) => NextResponse.json({ error }, { status })

/**
 * This account's captured jobs — all of them, the one for a URL the panel is
 * asking about, or the one the dashboard was opened for.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth({ allowExtension: true })
  if (!auth.ok) return auth.response

  const url = req.nextUrl.searchParams.get('url')?.trim()
  const id = req.nextUrl.searchParams.get('id')?.trim()
  try {
    if (id) return NextResponse.json({ job: await getJob(auth.userId, id) })
    if (url) return NextResponse.json({ job: await jobByUrl(auth.userId, url) })
    return NextResponse.json({ jobs: await listJobs(auth.userId) })
  } catch (err) {
    console.error('[extension/capture] list failed:', err instanceof Error ? err.message : err)
    return fail(500, 'Your saved jobs could not be loaded right now.')
  }
}

/**
 * Keep a posting. Capturing the same page again refreshes what is stored rather
 * than adding a second row, so re-reading a job after it was edited does not
 * leave two of it in the list — and the status already on it is left alone.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth({ allowExtension: true })
  if (!auth.ok) return auth.response
  const limited = await checkRateLimit(RATE_LIMITS.capture, auth.userId)
  if (!limited.ok) return tooManyRequests(limited, 'Too many jobs were captured in a short time.')

  const parsed = captureSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? 'Invalid request')

  try {
    // The extension can be the first thing an account touches after signing in,
    // and a captured job points at a user row that has to be there.
    await ensureUser({ id: auth.userId, email: auth.email, name: auth.userName || null })

    const existing = await jobByUrl(auth.userId, parsed.data.url)
    if (!existing && (await countJobs(auth.userId)) >= MAX_CAPTURED_JOBS) {
      return fail(409, `You have ${MAX_CAPTURED_JOBS} saved jobs, the most Chills keeps. Delete a few to save more.`)
    }

    const job = await captureJob(auth.userId, parsed.data)
    return NextResponse.json({ job }, { status: existing ? 200 : 201 })
  } catch (err) {
    console.error('[extension/capture] save failed:', err instanceof Error ? err.message : err)
    return fail(500, 'That job could not be saved right now.')
  }
}

/** Move a job along: saved → applied → interviewing → offer → closed. */
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth({ allowExtension: true })
  if (!auth.ok) return auth.response
  const limited = await checkRateLimit(RATE_LIMITS.mutation, auth.userId)
  if (!limited.ok) return tooManyRequests(limited, 'Too many changes were made in a short time.')

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? 'Invalid request')

  const { id, ...patch } = parsed.data
  const job = await updateJob(auth.userId, id, patch)
  if (!job) return fail(404, 'That job is not on your list.')
  return NextResponse.json({ job })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth({ allowExtension: true })
  if (!auth.ok) return auth.response
  const limited = await checkRateLimit(RATE_LIMITS.mutation, auth.userId)
  if (!limited.ok) return tooManyRequests(limited, 'Too many changes were made in a short time.')

  const id = req.nextUrl.searchParams.get('id')?.trim() ?? ''
  if (!id) return fail(400, 'Which job?')
  if (!(await deleteJob(auth.userId, id))) return fail(404, 'That job is not on your list.')
  return NextResponse.json({ ok: true })
}
