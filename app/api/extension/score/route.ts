import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/require-auth'
import { chooseAi, settleAiFailure } from '@/lib/billing/ai-access'
import { generateAIResponse } from '@/lib/ai-provider'
import { readyToTailor } from '@/lib/apply/tailor'
import { getResume } from '@/lib/db/resumes'
import { updateJob } from '@/lib/db/extension'
import { ResumeDocSchema } from '@/lib/resume-doc'
import { extractJdKeywords, keywordCoverage } from '@/lib/tailor/keywords'
import { checkRateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/security/rate-limit'

// Keyword extraction is one model call, not a tailoring run.
export const maxDuration = 120

/**
 * How well one saved resume already covers a job, without changing anything.
 *
 * This is the whole reason the panel is worth opening. Standing on a posting,
 * the question is not "rewrite this for me" but "is this worth an hour" — and a
 * number answers that in the seconds before the tab is closed. Tailoring is the
 * next step and happens in the app, where each change can be read and kept or
 * dropped; nothing here writes to the resume.
 *
 * It costs no tailoring run, only one of the day's light calls, which is what
 * lets it be used on every posting somebody glances at.
 */

const schema = z.object({
  resumeId: z.string().uuid(),
  jobDescription: z
    .string()
    .trim()
    .min(80, 'There is not enough of that job post to score against.')
    .max(20_000, 'That job post is longer than 20,000 characters.'),
  /** Keep the number against this captured job, so the list can show it later. */
  jobId: z.string().uuid().optional(),
})

const fail = (status: number, error: string) => NextResponse.json({ error }, { status })

export async function POST(req: NextRequest) {
  const auth = await requireAuth({ allowExtension: true })
  if (!auth.ok) return auth.response
  const limited = await checkRateLimit(RATE_LIMITS.aiLight, auth.userId)
  if (!limited.ok) return tooManyRequests(limited, 'Too many job posts were read in a short time.')

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? 'Invalid request')
  const { resumeId, jobDescription, jobId } = parsed.data

  const row = await getResume(auth.userId, resumeId)
  if (!row) return fail(404, 'That resume was not found.')
  const doc = ResumeDocSchema.safeParse(row.doc)
  if (!doc.success) return fail(422, 'That resume could not be read.')
  const ready = readyToTailor(doc.data)
  if (!ready.ok) return fail(422, ready.problems)

  const ai = await chooseAi(auth, {}, 'free')
  if (!ai.ok) return ai.response

  try {
    const found = await extractJdKeywords({
      jobDescription,
      generate: ({ systemInstruction, prompt, temperature }) =>
        generateAIResponse({
          provider: ai.provider,
          apiKey: ai.apiKey,
          systemInstruction,
          prompt,
          temperature,
          model: ai.model,
        }),
    })
    const coverage = keywordCoverage(ready.parsed, found.keywords)

    // Keeping the number on the job is what lets the saved list rank by fit
    // later without paying for the reading a second time.
    if (jobId) await updateJob(auth.userId, jobId, { score: coverage.score }).catch(() => null)

    return NextResponse.json({
      jobTitle: found.jobTitle,
      company: found.company,
      resume: { id: row.id, title: row.title },
      score: coverage.score,
      requiredPresent: coverage.requiredPresent,
      requiredTotal: coverage.requiredTotal,
      present: coverage.present,
      total: coverage.total,
      // The panel only ever shows what is absent: the covered ones need no
      // action, and a list of forty terms in a sidebar is read by nobody.
      missing: coverage.statuses
        .filter((entry) => entry.status !== 'covered')
        .map((entry) => ({ term: entry.keyword.term, required: entry.keyword.required, status: entry.status }))
        .slice(0, 24),
    })
  } catch (err) {
    const failure = await settleAiFailure('Extension score', auth.role, ai, err)
    return fail(failure.status, failure.message)
  }
}
