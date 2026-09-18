import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { addCall, AiUsage, describeUsage, emptyUsage } from '@/lib/ai-usage'
import { AiCallError } from '@/lib/ai-errors'
import { chooseAi, settleAiFailure } from '@/lib/billing/ai-access'
import { resolveModel } from '@/lib/ai-provider'
import { applicationEmailInput, applicationLabel, analyseRole, applyStageLabel, ApplyStage } from '@/lib/apply/run'
import { tailorForJob } from '@/lib/apply/tailor'
import { fetchJobPosting, JobSourceError, MAX_POSTING_CHARS, Posting, postingFromText } from '@/lib/apply/job-source'
import { COVER_LETTER_LENGTHS, COVER_LETTER_TONES } from '@/lib/cover-letter'
import { researchStore } from '@/lib/db/company-research'
import { createEmail, getOutreachProfile, getRecruiter } from '@/lib/db/outreach'
import { getResume } from '@/lib/db/resumes'
import { renderCheckedResume } from '@/lib/import/render'
import { researchCompany } from '@/lib/outreach/company-research'
import { UnusableAnswerError, signatureLines, writeOutreachEmail } from '@/lib/outreach/prompt'
import { fail, firstIssue, generatorFor, OwnerAiFields, puterRefusal, requireOutreachAccount } from '@/lib/outreach/server'
import type { CompanyNote } from '@/lib/outreach/types'
import { ResumeDocSchema } from '@/lib/resume-doc'
import { TAILOR_LEVELS } from '@/lib/tailor/levels'

/** Reading the posting, its keywords, four tailoring passes and the email. */
export const maxDuration = 300

const schema = z
  .object({
    resumeId: z.string().uuid(),
    recruiterId: z.string().min(1),
    /** The posting to read. One of these is required. */
    jobUrl: z.string().trim().max(2_000).default(''),
    jobText: z.string().trim().max(MAX_POSTING_CHARS).default(''),
    /** Used only where neither the posting nor the model names the role. */
    jobTitle: z.string().trim().max(160).default(''),
    level: z.enum(TAILOR_LEVELS).default('hard'),
    tone: z.enum(COVER_LETTER_TONES).default('professional'),
    /** Write a cover letter in the same call as the email, and attach it too. */
    coverLetter: z.boolean().default(false),
    letterLength: z.enum(COVER_LETTER_LENGTHS).default('standard'),
    /** What the candidate says the resume must not change. */
    instructions: z.string().max(2_000).default(''),
    /** Something to mention in this email only. */
    notes: z.string().trim().max(600).default(''),
    attachResume: z.boolean().default(true),
    research: z.boolean().default(true),
    ...OwnerAiFields,
  })
  .refine((data) => data.jobUrl || data.jobText, { message: 'Give the link to the job posting, or paste it.' })

/**
 * One complete application: the posting, the tailored resume and the recruiter
 * email, from a single reading.
 *
 * It is the Premium run, and it spends one of the cycle's applications and one
 * of its runs, because an application is a tailoring that did more rather than a
 * second allowance beside it (lib/billing/store.ts).
 *
 * The answer is a stream of newline-delimited JSON, like tailoring: a progress
 * line as each stage starts and after every model call, then one `result` line.
 * The tailored copy is saved to the account's history and the email is left as a
 * draft — nothing is sent. Reading the posting happens before anything is
 * reserved, so a link that can't be read costs nothing and says so plainly.
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  const auth = await requireOutreachAccount()
  if (!auth.ok) return auth.response

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail(400, firstIssue(parsed.error))
  const data = parsed.data
  const refusal = puterRefusal(auth.role, data.provider)
  if (refusal) return refusal

  const [recruiter, row] = await Promise.all([
    getRecruiter(auth.userId, data.recruiterId),
    getResume(auth.userId, data.resumeId).catch(() => null),
  ])
  if (!recruiter) return fail(404, 'Recruiter not found')
  const doc = row ? ResumeDocSchema.safeParse(row.doc) : null
  if (!row || !doc?.success) return fail(404, 'Resume not found')

  const rendered = renderCheckedResume(doc.data)
  if (!rendered.ok) return fail(422, rendered.problems.join(' '))

  // Before anything is reserved: a posting that can't be read is the user's
  // problem to fix, and it would be unfair to charge an application for it.
  let posting: Posting
  try {
    posting = data.jobUrl ? await fetchJobPosting(data.jobUrl) : postingFromText(data.jobText, data.jobTitle)
  } catch (err) {
    if (err instanceof JobSourceError) return fail(422, err.message, `job_${err.kind}`)
    console.error('[apply] the posting could not be read:', err instanceof Error ? err.message : err)
    return fail(502, 'That posting could not be read. Paste it instead and the run will use your text.')
  }

  const ai = await chooseAi(auth, data, 'apply')
  if (!ai.ok) return ai.response

  const profile = await getOutreachProfile(auth.userId)
  const candidateName = profile.senderName || doc.data.name || auth.userName
  const signature = signatureLines(profile, candidateName)

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      let settled = false
      const send = (event: Record<string, unknown>) => {
        if (!closed) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
      }
      const close = () => {
        if (closed) return
        closed = true
        controller.close()
      }
      // An application that produced nothing is charged for nothing, however it ends.
      const stop = async (err: unknown) => {
        if (settled) return
        settled = true
        const failure = await settleAiFailure('Complete application', auth.role, ai, err)
        send({
          type: 'error',
          error: err instanceof UnusableAnswerError ? `The AI wrote something Chills couldn’t use: ${err.reason}.` : failure.message,
          rateLimited: failure.kind === 'busy',
        })
        close()
      }

      const limitS = Number(process.env.TAILOR_TIME_LIMIT_S) || maxDuration
      const stopAt = startedAt + (limitS - 10) * 1000
      const watchdog = setTimeout(() => {
        void stop(
          new AiCallError(
            `Stopped after ${Math.round((Date.now() - startedAt) / 1000)} s: the AI is too slow to finish a whole ` +
              `application within this server's ${limitS} s limit. Try a lighter level.`,
            'slow'
          )
        )
      }, stopAt - Date.now())

      let usage: AiUsage = emptyUsage()
      let stage: ApplyStage = 'posting'
      let label = applyStageLabel('posting')
      const tell = () => send({ type: 'progress', stage, label, usage })
      const at = (next: ApplyStage) => {
        stage = next
        label = applyStageLabel(next)
        tell()
      }
      const generate = generatorFor(ai, (call) => {
        usage = addCall(usage, call)
        tell()
      })

      try {
        tell()
        // The company's site needs nothing from the posting or the tailoring, so
        // it is read while those run instead of after them. It used to sit at the
        // end, adding a whole round trip to a job that was already long.
        const researching: Promise<CompanyNote | null> = data.research
          ? researchCompany(recruiter.email, generate, researchStore)
          : Promise.resolve(null)
        researching.catch(() => null)

        at('role')
        const { analysis, keywords } = await analyseRole({ posting, recruiter, typedTitle: data.jobTitle, generate })

        at('tailor')
        const tailored = await tailorForJob({
          userId: auth.userId,
          resume: { id: row.id, title: row.title, doc: doc.data },
          parsed: rendered.parsed.resume,
          jobDescription: posting.text,
          keywords,
          level: data.level,
          instructions: data.instructions,
          jobTitle: analysis.title,
          company: analysis.company,
          provider: ai.provider,
          model: resolveModel(ai.provider, ai.model),
          generate,
          onProgress: (progress) => {
            label = progress.label
            tell()
          },
          // Room for the email, which is up to two more calls, and for saving.
          deadline: stopAt - 45_000,
        })

        at('email')
        // Part of the same application: it takes nothing more, and never fails it.
        const company = await researching
        const written = await writeOutreachEmail({
          input: applicationEmailInput({
            analysis,
            candidateName,
            tailoredResumeText: tailored.resumeText,
            recruiter: { name: recruiter.name, company: recruiter.company, title: recruiter.title },
            profile,
            tone: data.tone,
            notes: data.notes,
            attachResume: data.attachResume,
            about: company?.status === 'found' ? company : null,
            withCoverLetter: data.coverLetter,
            letterLength: data.letterLength,
          }),
          signature,
          generate,
        })

        at('saving')
        const email = await createEmail(auth.userId, {
          recruiterId: recruiter.id,
          threadId: null,
          resumeId: null,
          tailoringId: tailored.tailoringId,
          jobTitle: analysis.title,
          jobDescription: posting.text,
          subject: written.subject,
          body: written.body,
          attachResume: data.attachResume,
          coverLetter: written.coverLetter ?? '',
          attachCoverLetter: Boolean(written.coverLetter),
        })

        if (!settled) {
          settled = true
          console.log(`[apply] ${applicationLabel(analysis)} on ${ai.provider}: ${describeUsage(usage)}`)
          stage = 'done'
          send({
            type: 'result',
            role: { title: analysis.title, company: analysis.company, location: analysis.location },
            posting: { url: analysis.posting.url, structured: analysis.posting.structured },
            tailoringId: tailored.tailoringId,
            appliedCount: tailored.appliedCount,
            keywordReport: tailored.keywordReport ?? null,
            unevidencedSkills: tailored.unevidencedSkills,
            email,
            company,
            usage,
          })
        }
      } catch (err) {
        await stop(err)
      } finally {
        clearTimeout(watchdog)
        close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}

export function GET() {
  return NextResponse.json({ error: 'Post a resume, a recruiter and the job posting to run an application.' }, { status: 405 })
}
