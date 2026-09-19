import { NextRequest, NextResponse } from 'next/server'
import { releaseReservation, Reservation, reserveEmailSend } from '@/lib/billing/store'
import { BILLING_CODES } from '@/lib/billing/types'
import { EMAIL_SENDS_PER_DAY } from '@/lib/billing/plans'
import { attachmentName, coverLetterPdf, newTrackingToken, publicOrigin, resumePdf, trackingUrl } from '@/lib/outreach/delivery'
import { emailHtml, MailboxError, sendFromMailbox } from '@/lib/outreach/mailbox'
import {
  claimForSending,
  getEmailRow,
  getMailboxLogin,
  getMailboxStatus,
  getOutreachProfile,
  getRecruiter,
  markSendFailed,
  markSent,
} from '@/lib/db/outreach'
import { fail, requireOutreachAccount, resolveSource } from '@/lib/outreach/server'
import { checkRateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/security/rate-limit'

export const maxDuration = 120

type Params = { params: { id: string } }

/** The letterhead: the address the letter is actually sent from, and today's date. */
const mailboxAddress = (mailbox: { address: string }) => mailbox.address
const today = () => new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })

/**
 * Send a draft from the account's own mailbox, with the resume it was written
 * from attached as a PDF. Every check that can fail runs before the draft is
 * claimed, and a failed send puts the draft back with the reason, so nothing
 * is ever half sent.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireOutreachAccount()
  if (!auth.ok) return auth.response
  const limited = await checkRateLimit(RATE_LIMITS.emailSend, auth.userId)
  if (!limited.ok) return tooManyRequests(limited, 'Too many emails were sent in a short time.')

  const email = await getEmailRow(auth.userId, params.id)
  if (!email) return fail(404, 'Email not found')
  if (email.status !== 'draft' && email.status !== 'sending') return fail(409, 'That email was already sent.')
  if (!email.subject.trim()) return fail(400, 'Add a subject before sending.')
  if (email.body.replace(/\s+/g, ' ').trim().length < 40) return fail(400, 'Write the email before sending it.')

  const recruiter = await getRecruiter(auth.userId, email.recruiterId)
  if (!recruiter) return fail(404, 'Recruiter not found')

  let inReplyTo: string | null = null
  if (email.threadId) {
    const first = await getEmailRow(auth.userId, email.threadId)
    if (!first?.sentAt) return fail(409, 'Send the first email before its follow-up.')
    inReplyTo = first.messageId
  }

  const mailbox = await getMailboxLogin(auth.userId)
  if (!mailbox) {
    const connected = await getMailboxStatus(auth.userId)
    return fail(
      409,
      connected
        ? 'Your mailbox needs to be connected again. Open Sender setup and enter its app password.'
        : 'Connect your mailbox in Sender setup first, or open the email in Gmail or Outlook to send it yourself.',
      'mailbox_missing'
    )
  }

  const source = email.tailoringId
    ? ({ kind: 'tailoring', id: email.tailoringId } as const)
    : email.resumeId
      ? ({ kind: 'resume', id: email.resumeId } as const)
      : null
  const resolved = await resolveSource(auth.userId, source)
  if (email.attachResume && !resolved) {
    return fail(409, 'The resume this email attaches was deleted. Choose another resume, or send it without an attachment.')
  }

  // Both PDFs are built before the draft is claimed: a letter that won't typeset
  // must not leave an email half sent, any more than a resume that won't.
  const profile = await getOutreachProfile(auth.userId)
  const candidateName = profile.senderName || resolved?.candidateName || auth.userName
  const attachments: Array<{ filename: string; content: Buffer }> = []
  try {
    if (email.attachResume && resolved) {
      attachments.push({ filename: attachmentName(resolved.candidateName), content: await resumePdf(resolved.latex) })
    }
    if (email.attachCoverLetter && email.coverLetter.trim()) {
      attachments.push({
        filename: attachmentName(candidateName, 'cover letter'),
        content: await coverLetterPdf(
          { name: candidateName, contact: [mailboxAddress(mailbox), profile.phone].filter(Boolean), date: today() },
          email.coverLetter
        ),
      })
    }
  } catch (err) {
    return fail(502, err instanceof Error ? err.message : 'Your attachment couldn’t be built.')
  }

  // The owner has no limits; everyone else can send so many a day, to protect their mailbox.
  let reservation: Reservation | null = null
  if (auth.role !== 'owner') {
    reservation = await reserveEmailSend(auth.userId)
    if (!reservation) {
      return fail(
        429,
        `You’ve sent ${EMAIL_SENDS_PER_DAY} emails today, the daily limit that keeps your mailbox safe from spam filters. Sending starts again at midnight UTC.`,
        BILLING_CODES.sendLimit
      )
    }
  }

  const claimed = await claimForSending(auth.userId, email.id)
  if (!claimed) {
    if (reservation) await releaseReservation(reservation)
    return fail(409, 'That email is already being sent.')
  }

  const origin = profile.trackOpens ? publicOrigin(req.url) : null
  const token = origin ? newTrackingToken() : null

  let messageId: string
  try {
    const result = await sendFromMailbox(mailbox, {
      fromName: candidateName,
      to: { name: recruiter.name, address: recruiter.email },
      subject: claimed.subject.trim(),
      text: claimed.body,
      html: emailHtml(claimed.body, origin && token ? trackingUrl(origin, token) : null),
      attachments,
      inReplyTo,
    })
    messageId = result.messageId
  } catch (err) {
    if (reservation) await releaseReservation(reservation)
    const reason = err instanceof MailboxError ? err.message : 'The email couldn’t be sent just now. Try again in a moment.'
    if (!(err instanceof MailboxError)) console.error('[outreach/send]', err instanceof Error ? err.message : err)
    await markSendFailed(auth.userId, claimed.id, reason)
    // The code tells a batch whether to go on: a refused recipient affects one email, a refused sign-in all of them.
    const kind = err instanceof MailboxError ? err.kind : 'connection'
    return fail(kind === 'connection' ? 502 : 422, reason, `mailbox_${kind}`)
  }

  // It is out. From here on, the draft must never go back to being sendable.
  try {
    const sent = await markSent(auth.userId, claimed, { messageId: messageId || null, trackingToken: token })
    return NextResponse.json({ email: sent })
  } catch (err) {
    console.error('[outreach/send] sent but not recorded:', err instanceof Error ? err.message : err)
    return fail(500, 'The email was sent, but Chills couldn’t record it. Check your Sent folder before sending it again.')
  }
}
