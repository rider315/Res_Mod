import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COVER_LETTER_LENGTHS, COVER_LETTER_TONES } from '@/lib/cover-letter'
import { AiMeter, chooseAi, settleAiFailure } from '@/lib/billing/ai-access'
import { resolveModel } from '@/lib/ai-provider'
import { readyToTailor, tailorForJob } from '@/lib/apply/tailor'
import { LIMITS } from '@/lib/outreach/model'
import { UnusableAnswerError, composeEmailBody, signatureLines, writeOutreachEmail } from '@/lib/outreach/prompt'
import { researchCompany } from '@/lib/outreach/company-research'
import type { CompanyNote } from '@/lib/outreach/types'
import { researchStore } from '@/lib/db/company-research'
import { getResume } from '@/lib/db/resumes'
import { ResumeDocSchema } from '@/lib/resume-doc'
import { extractJdKeywords } from '@/lib/tailor/keywords'
import { TAILOR_LEVELS } from '@/lib/tailor/levels'
import {
  createEmail,
  getEmailRow,
  getOutreachProfile,
  getRecruiter,
  listThreads,
  outreachByTailoring,
  updateDraft,
} from '@/lib/db/outreach'
import {
  EmailSourceSchema,
  fail,
  firstIssue,
  generatorFor,
  OwnerAiFields,
  puterRefusal,
  requireOutreachAccount,
  resolveSource,
} from '@/lib/outreach/server'
import { checkRateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/security/rate-limit'

export const maxDuration = 300

/** Every thread for the tracker, and how many emails each tailored copy has led to. */
export async function GET() {
  const auth = await requireOutreachAccount()
  if (!auth.ok) return auth.response
  const [threads, byTailoring] = await Promise.all([listThreads(auth.userId), outreachByTailoring(auth.userId)])
  return NextResponse.json({ threads, byTailoring })
}

const schema = z.object({
  recruiterId: z.string().min(1),
  /** The resume or tailored copy to write from and attach. */
  source: EmailSourceSchema.default(null),
  /**
   * "original" attaches the chosen resume as it is. "tailored" rewrites a copy of
   * it for this job first and attaches that; the stored resume never changes.
   */
  resumeMode: z.enum(['original', 'tailored']).default('original'),
  /** How far to tailor, when tailoring. */
  level: z.enum(TAILOR_LEVELS).default('hard'),
  jobTitle: z.string().trim().max(160).default(''),
  jobDescription: z.string().trim().max(LIMITS.jobDescription, 'That job post is too long.').default(''),
  tone: z.enum(COVER_LETTER_TONES).default('professional'),
  /** Write a cover letter with the email and attach it too. */
  coverLetter: z.boolean().default(false),
  letterLength: z.enum(COVER_LETTER_LENGTHS).default('standard'),
  /** Something to mention in this email only. */
  notes: z.string().trim().max(600).default(''),
  attachResume: z.boolean().default(true),
  /** Write it again into this draft, rather than starting another. */
  replaceDraftId: z.string().optional(),
  /** An empty draft to write by hand. It uses no AI. */
  blank: z.boolean().default(false),
  /** Read the company's own website first, so the email can say what the company does. */
  research: z.boolean().default(true),
  ...OwnerAiFields,
})

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? ''

/**
 * Write a first email to a recruiter, from one of the account's resumes or
 * tailored copies.
 *
 * Three things can be asked for, and they are deliberately not three requests:
 *
 *   - the email itself, always;
 *   - a resume tailored to this job first, which the email is then written from
 *     and which is what gets attached;
 *   - a cover letter, written in the same model call as the email.
 *
 * Doing them together is what makes them cheap. The job's keywords are found
 * once and used by the tailoring; the company's website is read at the same time
 * as the tailoring runs rather than after it, because it depends on none of it;
 * and the letter costs no second reading of the resume and the job post, since
 * it comes back from the call that already had both in front of it.
 *
 * With the AI it takes one of the month's AI-written emails, and a tailoring run
 * as well when it tailors. A blank draft takes nothing.
 */
export async function POST(req: NextRequest) {
  const auth = await requireOutreachAccount()
  if (!auth.ok) return auth.response
  const limited = await checkRateLimit(RATE_LIMITS.emailWrite, auth.userId)
  if (!limited.ok) return tooManyRequests(limited, 'Too many emails were written in a short time.')

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail(400, firstIssue(parsed.error))
  const data = parsed.data
  const refusal = puterRefusal(auth.role, data.provider)
  if (refusal) return refusal

  const recruiter = await getRecruiter(auth.userId, data.recruiterId)
  if (!recruiter) return fail(404, 'Recruiter not found')

  if (data.replaceDraftId) {
    const existing = await getEmailRow(auth.userId, data.replaceDraftId)
    if (!existing || existing.recruiterId !== recruiter.id || existing.threadId) return fail(404, 'Draft not found')
    if (existing.status !== 'draft') return fail(409, 'That email was already sent, so it can’t be rewritten.')
  }

  const resolved = await resolveSource(auth.userId, data.source)
  if (data.source && !resolved) return fail(404, 'That resume or tailored copy was not found.')
  if (!data.blank && !resolved) return fail(400, 'Choose the resume to write the email from.')

  // Tailoring rewrites one of the account's own saved resumes. A copy that was
  // already tailored is left alone: tailoring it again would be a copy of a copy.
  const tailoring = !data.blank && data.resumeMode === 'tailored'
  if (tailoring && data.source?.kind !== 'resume') {
    return fail(400, 'Pick one of your saved resumes to tailor. A tailored copy is already written for its own job.')
  }
  const jobPost = data.jobDescription.trim()
  if (tailoring && jobPost.length < 80) {
    return fail(400, 'Paste the job post to tailor the resume to it, or attach your resume as it is.')
  }

  const profile = await getOutreachProfile(auth.userId)
  const candidateName = profile.senderName || resolved?.candidateName || auth.userName
  const signature = signatureLines(profile, candidateName)
  const job = { title: data.jobTitle || resolved?.job?.title || '', description: jobPost }

  if (data.blank || !resolved) {
    const written = {
      subject: job.title ? `${job.title} role` : '',
      body: composeEmailBody(
        { greeting: recruiter.name ? `Hi ${firstName(recruiter.name)},` : 'Hi there,', paragraphs: [], closing: 'Best regards,' },
        signature
      ),
      coverLetter: null,
    }
    return save(auth.userId, data, recruiter.id, resolved?.source ?? null, job, written, null)
  }

  const meters: AiMeter[] = tailoring ? ['run', 'draft'] : ['draft']
  const ai = await chooseAi(auth, data, meters)
  if (!ai.ok) return ai.response
  const generate = generatorFor(ai)

  let source = resolved.source
  let resumeText = resolved.resumeText
  let company: CompanyNote | null = null
  let written: { subject: string; body: string; coverLetter: string | null }

  try {
    // Reading the company's site needs nothing from the tailoring, so it goes off
    // now and is waited for at the end. On a tailored run that is four model calls
    // of cover; on a plain one it costs nothing to have started early.
    const researching: Promise<CompanyNote | null> = data.research
      ? researchCompany(recruiter.email, generate, researchStore)
      : Promise.resolve(null)
    // Nothing must be able to fail the email; researchCompany already swallows
    // its own trouble, and this is the belt for the braces.
    researching.catch(() => null)

    if (tailoring) {
      const row = await getResume(auth.userId, data.source!.id)
      const doc = row ? ResumeDocSchema.safeParse(row.doc) : null
      if (!row || !doc?.success) throw new Error('That resume could not be read.')
      const ready = readyToTailor(doc.data)
      if (!ready.ok) throw new Error(ready.problems)

      const keywords = await extractJdKeywords({ jobDescription: jobPost, generate })
      const tailored = await tailorForJob({
        userId: auth.userId,
        resume: { id: row.id, title: row.title, doc: doc.data },
        parsed: ready.parsed,
        jobDescription: jobPost,
        keywords,
        level: data.level,
        jobTitle: job.title || keywords.jobTitle,
        company: recruiter.company || keywords.company,
        provider: ai.provider,
        model: resolveModel(ai.provider, ai.model),
        generate,
      })
      // From here the email is written from the tailored copy, and attaches it.
      source = { kind: 'tailoring', id: tailored.tailoringId }
      resumeText = tailored.resumeText
      job.title = job.title || keywords.jobTitle
    }

    company = await researching
    written = await writeOutreachEmail({
      input: {
        candidateName,
        resumeText,
        recruiter: { name: recruiter.name, company: recruiter.company, title: recruiter.title },
        jobTitle: job.title,
        company: resolved.job?.company || recruiter.company || (company?.status === 'found' ? company.company : ''),
        jobDescription: jobPost || resolved.job?.description || '',
        tone: data.tone,
        availability: profile.availability,
        highlights: [profile.highlights, data.notes].filter(Boolean).join('\n'),
        attachResume: data.attachResume,
        about: company?.status === 'found' ? company : null,
        withCoverLetter: data.coverLetter,
        letterLength: data.letterLength,
      },
      signature,
      generate,
    })
  } catch (err) {
    const failure = await settleAiFailure('Recruiter email', auth.role, ai, err)
    if (err instanceof UnusableAnswerError) {
      // It answered; the answer was unusable. Saying which beats "try again".
      return fail(502, `The AI wrote something Chills couldn’t use: ${err.reason}. Nothing was counted — try again, or write it yourself.`, 'ai_unusable')
    }
    return fail(failure.status, failure.message)
  }

  return save(auth.userId, data, recruiter.id, source, job, written, company)
}

/** Keep the draft, whether it was written by the AI or left blank to type into. */
async function save(
  userId: string,
  data: z.infer<typeof schema>,
  recruiterId: string,
  source: { kind: 'resume' | 'tailoring'; id: string } | null,
  job: { title: string; description: string },
  written: { subject: string; body: string; coverLetter: string | null },
  company: CompanyNote | null
): Promise<NextResponse> {
  const letter = { coverLetter: written.coverLetter ?? '', attachCoverLetter: Boolean(written.coverLetter) }
  const email = data.replaceDraftId
    ? await updateDraft(userId, data.replaceDraftId, {
        subject: written.subject,
        body: written.body,
        attachResume: data.attachResume,
        source,
        job,
        ...letter,
      })
    : await createEmail(userId, {
        recruiterId,
        threadId: null,
        resumeId: source?.kind === 'resume' ? source.id : null,
        tailoringId: source?.kind === 'tailoring' ? source.id : null,
        jobTitle: job.title,
        jobDescription: job.description,
        subject: written.subject,
        body: written.body,
        attachResume: data.attachResume,
        ...letter,
      })
  if (!email) return fail(409, 'That draft changed while it was being rewritten. Open it again.')
  return NextResponse.json({ email, company }, { status: data.replaceDraftId ? 200 : 201 })
}
