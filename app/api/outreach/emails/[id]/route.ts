import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { LIMITS, THREAD_STAGES } from '@/lib/outreach/model'
import { deleteEmail, getEmailRow, getThread, markSentByHand, setThreadStage, updateDraft } from '@/lib/db/outreach'
import { EmailSourceSchema, fail, firstIssue, requireOutreachAccount, resolveSource } from '@/lib/outreach/server'

type Params = { params: { id: string } }

/** A thread: its first email, follow-ups and replies. Any email in the thread can be asked for. */
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireOutreachAccount()
  if (!auth.ok) return auth.response
  const thread = await getThread(auth.userId, params.id)
  if (!thread) return fail(404, 'Email not found')
  return NextResponse.json(thread)
}

const schema = z.discriminatedUnion('action', [
  /** Save a draft's text and settings. */
  z.object({
    action: z.literal('edit'),
    subject: z.string().trim().max(LIMITS.subject, `Keep the subject under ${LIMITS.subject} characters.`),
    body: z.string().max(LIMITS.body, `Keep the email under ${LIMITS.body} characters.`),
    attachResume: z.boolean(),
    /** Whether the cover letter written with it goes out too. */
    attachCoverLetter: z.boolean().optional(),
    source: EmailSourceSchema.optional(),
  }),
  /** Move a sent thread along the tracker. */
  z.object({ action: z.literal('stage'), stage: z.enum(THREAD_STAGES) }),
  /** The user sent this draft from their own mail app. */
  z.object({ action: z.literal('sentByHand') }),
])

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireOutreachAccount()
  if (!auth.ok) return auth.response
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail(400, firstIssue(parsed.error))
  const change = parsed.data

  if (change.action === 'stage') {
    if (!(await setThreadStage(auth.userId, params.id, change.stage))) {
      return fail(404, 'Only a sent email’s progress can be changed.')
    }
    return NextResponse.json(await getThread(auth.userId, params.id))
  }

  const existing = await getEmailRow(auth.userId, params.id)
  if (!existing) return fail(404, 'Email not found')
  if (existing.status !== 'draft') return fail(409, 'That email was already sent, so it can’t be changed.')

  if (change.action === 'sentByHand') {
    if (existing.threadId) {
      const first = await getEmailRow(auth.userId, existing.threadId)
      if (!first?.sentAt) return fail(409, 'Send the first email before its follow-up.')
    }
    const email = await markSentByHand(auth.userId, params.id)
    if (!email) return fail(409, 'That email was already sent.')
    return NextResponse.json({ email })
  }

  // A different resume to attach must be this account's own.
  if (change.source && !(await resolveSource(auth.userId, change.source))) {
    return fail(404, 'That resume or tailored copy was not found.')
  }
  const email = await updateDraft(auth.userId, params.id, {
    subject: change.subject,
    body: change.body.replace(/\r\n?/g, '\n'),
    attachResume: change.attachResume,
    attachCoverLetter: change.attachCoverLetter,
    source: change.source,
  })
  if (!email) return fail(409, 'That email was already sent, so it can’t be changed.')
  return NextResponse.json({ email })
}

/** Delete an email. Deleting a first email deletes its whole thread. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireOutreachAccount()
  if (!auth.ok) return auth.response
  if (!(await deleteEmail(auth.userId, params.id))) return fail(404, 'Email not found')
  return new NextResponse(null, { status: 204 })
}
