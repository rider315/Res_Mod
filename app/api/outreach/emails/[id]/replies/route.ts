import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { chooseAi, settleAiFailure } from '@/lib/billing/ai-access'
import { isThreadStage, LIMITS, stageAfterReply } from '@/lib/outreach/model'
import { UnusableAnswerError, analyzeReply } from '@/lib/outreach/prompt'
import { getOutreachProfile, getThread, saveReply } from '@/lib/db/outreach'
import { fail, firstIssue, generatorFor, OwnerAiFields, puterRefusal, requireOutreachAccount, resolveSource } from '@/lib/outreach/server'
import { checkRateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/security/rate-limit'

export const maxDuration = 300

type Params = { params: { id: string } }

const schema = z.object({
  reply: z
    .string()
    .trim()
    .min(10, 'Paste the recruiter’s reply.')
    .max(LIMITS.reply, `Keep the pasted reply under ${LIMITS.reply} characters.`),
  ...OwnerAiFields,
})

/**
 * Read a recruiter's reply, pasted in by the user: what they want, a suggested
 * answer, and where the thread now stands. It uses no AI-written email, only one
 * of the day's AI requests.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireOutreachAccount()
  if (!auth.ok) return auth.response
  const limited = await checkRateLimit(RATE_LIMITS.aiLight, auth.userId)
  if (!limited.ok) return tooManyRequests(limited, 'Too many replies were read in a short time.')

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail(400, firstIssue(parsed.error))
  const refusal = puterRefusal(auth.role, parsed.data.provider)
  if (refusal) return refusal

  const thread = await getThread(auth.userId, params.id)
  if (!thread) return fail(404, 'Email not found')
  const { email: first, followUps, recruiter } = thread
  if (!first.sentAt || !isThreadStage(first.status)) return fail(409, 'Send the email before adding a reply to it.')

  const last = [first, ...followUps.filter((followUp) => followUp.sentAt)].pop()!
  const [profile, resolved] = await Promise.all([getOutreachProfile(auth.userId), resolveSource(auth.userId, first.source)])

  const ai = await chooseAi(auth, parsed.data, 'free')
  if (!ai.ok) return ai.response

  try {
    const analysis = await analyzeReply({
      input: {
        candidateName: profile.senderName || resolved?.candidateName || auth.userName,
        recruiterName: recruiter.name,
        company: recruiter.company,
        sentSubject: last.subject,
        sentBody: last.body,
        reply: parsed.data.reply,
        availability: profile.availability,
      },
      generate: generatorFor(ai),
    })
    const stage = stageAfterReply(first.status, analysis.intent)
    const reply = await saveReply(auth.userId, first.id, { body: parsed.data.reply, ...analysis }, stage)
    return NextResponse.json({ reply, stage }, { status: 201 })
  } catch (err) {
    const failure = await settleAiFailure('Reading a reply', auth.role, ai, err)
    if (err instanceof UnusableAnswerError) {
      // It answered; the answer was unusable. Saying which beats "try again".
      return fail(502, `The AI wrote something Chills couldn’t use: ${err.reason}. Nothing was counted — try again.`, 'ai_unusable')
    }
    return fail(failure.status, failure.message)
  }
}
