import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COVER_LETTER_TONES } from '@/lib/cover-letter'
import { chooseAi, settleAiFailure } from '@/lib/billing/ai-access'
import { LIMITS } from '@/lib/outreach/model'
import { UnusableAnswerError, signatureLines, writeFollowUp } from '@/lib/outreach/prompt'
import { createEmail, getOutreachProfile, getThread } from '@/lib/db/outreach'
import { fail, firstIssue, generatorFor, OwnerAiFields, puterRefusal, requireOutreachAccount, resolveSource } from '@/lib/outreach/server'
import { checkRateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/security/rate-limit'

export const maxDuration = 300

type Params = { params: { id: string } }

const schema = z.object({
  tone: z.enum(COVER_LETTER_TONES).default('professional'),
  ...OwnerAiFields,
})

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Write a follow-up to a sent email that got no answer, as a draft in the same
 * thread. It takes one of the month's AI-written emails, like a first email.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireOutreachAccount()
  if (!auth.ok) return auth.response
  const limited = await checkRateLimit(RATE_LIMITS.emailWrite, auth.userId)
  if (!limited.ok) return tooManyRequests(limited, 'Too many follow-ups were written in a short time.')

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return fail(400, firstIssue(parsed.error))
  const refusal = puterRefusal(auth.role, parsed.data.provider)
  if (refusal) return refusal

  const thread = await getThread(auth.userId, params.id)
  if (!thread) return fail(404, 'Email not found')
  const { email: first, followUps, recruiter } = thread
  if (!first.sentAt) return fail(409, 'Send the email before writing a follow-up.')
  const pending = followUps.find((followUp) => followUp.status === 'draft')
  if (pending) return NextResponse.json({ error: 'This thread already has a follow-up waiting to be sent.', emailId: pending.id }, { status: 409 })
  const sentFollowUps = followUps.filter((followUp) => followUp.sentAt)
  if (sentFollowUps.length >= LIMITS.followUps) {
    return fail(409, `You’ve followed up ${LIMITS.followUps} times. It’s best to leave it there, or try someone else at the company.`)
  }

  // The follow-up answers the newest email that went out.
  const last = [first, ...sentFollowUps].pop()!
  const resolved = await resolveSource(auth.userId, first.source)
  const profile = await getOutreachProfile(auth.userId)
  const candidateName = profile.senderName || resolved?.candidateName || auth.userName

  const ai = await chooseAi(auth, parsed.data, 'draft')
  if (!ai.ok) return ai.response

  let written: { subject: string; body: string }
  try {
    written = await writeFollowUp({
      input: {
        candidateName,
        recruiterName: recruiter.name,
        company: recruiter.company,
        jobTitle: first.jobTitle,
        sentSubject: first.subject,
        sentBody: last.body,
        daysSince: Math.max(1, Math.round((Date.now() - new Date(last.sentAt!).getTime()) / DAY_MS)),
        number: sentFollowUps.length + 1,
        tone: parsed.data.tone,
        attachResume: first.attachResume && Boolean(resolved),
      },
      signature: signatureLines(profile, candidateName),
      generate: generatorFor(ai),
    })
  } catch (err) {
    const failure = await settleAiFailure('Follow-up email', auth.role, ai, err)
    if (err instanceof UnusableAnswerError) {
      // It answered; the answer was unusable. Saying which beats "try again".
      return fail(502, `The AI wrote something Chills couldn’t use: ${err.reason}. Nothing was counted — try again, or write it yourself.`, 'ai_unusable')
    }
    return fail(failure.status, failure.message)
  }

  const email = await createEmail(auth.userId, {
    recruiterId: recruiter.id,
    threadId: first.id,
    resumeId: first.source?.kind === 'resume' ? first.source.id : null,
    tailoringId: first.source?.kind === 'tailoring' ? first.source.id : null,
    jobTitle: first.jobTitle,
    jobDescription: '',
    subject: written.subject,
    body: written.body,
    attachResume: first.attachResume && Boolean(resolved),
  })
  return NextResponse.json({ email }, { status: 201 })
}
