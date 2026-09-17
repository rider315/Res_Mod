import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COVER_LETTER_TONES } from '@/lib/cover-letter'
import { aiFailureMessage, chooseAi } from '@/lib/billing/ai-access'
import { releaseReservation } from '@/lib/billing/store'
import { LIMITS } from '@/lib/outreach/model'
import { composeEmailBody, signatureLines, writeOutreachEmail } from '@/lib/outreach/prompt'
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

export const maxDuration = 120

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
  jobTitle: z.string().trim().max(160).default(''),
  jobDescription: z.string().trim().max(LIMITS.jobDescription, 'That job post is too long.').default(''),
  tone: z.enum(COVER_LETTER_TONES).default('professional'),
  /** Something to mention in this email only. */
  notes: z.string().trim().max(600).default(''),
  attachResume: z.boolean().default(true),
  /** Write it again into this draft, rather than starting another. */
  replaceDraftId: z.string().optional(),
  /** An empty draft to write by hand. It uses no AI. */
  blank: z.boolean().default(false),
  ...OwnerAiFields,
})

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? ''

/**
 * Write a first email to a recruiter, from one of the account's resumes or
 * tailored copies. With the AI, it takes one of the month's AI-written emails;
 * a blank draft takes nothing.
 */
export async function POST(req: NextRequest) {
  const auth = await requireOutreachAccount()
  if (!auth.ok) return auth.response

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

  const profile = await getOutreachProfile(auth.userId)
  const candidateName = profile.senderName || resolved?.candidateName || auth.userName
  const signature = signatureLines(profile, candidateName)
  const job = {
    title: data.jobTitle || resolved?.job?.title || '',
    description: data.jobDescription,
  }

  let written: { subject: string; body: string }
  if (data.blank || !resolved) {
    written = {
      subject: job.title ? `${job.title} role` : '',
      body: composeEmailBody(
        { greeting: recruiter.name ? `Hi ${firstName(recruiter.name)},` : 'Hi there,', paragraphs: [], closing: 'Best regards,' },
        signature
      ),
    }
  } else {
    const ai = await chooseAi(auth, data, 'draft')
    if (!ai.ok) return ai.response
    try {
      written = await writeOutreachEmail({
        input: {
          candidateName,
          resumeText: resolved.resumeText,
          recruiter: { name: recruiter.name, company: recruiter.company, title: recruiter.title },
          jobTitle: job.title,
          company: resolved.job?.company || recruiter.company,
          jobDescription: data.jobDescription || resolved.job?.description || '',
          tone: data.tone,
          availability: profile.availability,
          highlights: [profile.highlights, data.notes].filter(Boolean).join('\n'),
          attachResume: data.attachResume,
        },
        signature,
        generate: generatorFor(ai),
      })
    } catch (err) {
      if (ai.reservation) await releaseReservation(ai.reservation)
      const message = err instanceof Error ? err.message : String(err)
      console.error('[outreach/emails] writing failed:', message)
      return fail(/429|rate limit/i.test(message) ? 429 : 502, aiFailureMessage(auth.role, message))
    }
  }

  const source = resolved?.source ?? null
  const email = data.replaceDraftId
    ? await updateDraft(auth.userId, data.replaceDraftId, { ...written, attachResume: data.attachResume, source, job })
    : await createEmail(auth.userId, {
        recruiterId: recruiter.id,
        threadId: null,
        resumeId: source?.kind === 'resume' ? source.id : null,
        tailoringId: source?.kind === 'tailoring' ? source.id : null,
        jobTitle: job.title,
        jobDescription: job.description,
        subject: written.subject,
        body: written.body,
        attachResume: data.attachResume,
      })
  if (!email) return fail(409, 'That draft changed while it was being rewritten. Open it again.')
  return NextResponse.json({ email }, { status: data.replaceDraftId ? 200 : 201 })
}
