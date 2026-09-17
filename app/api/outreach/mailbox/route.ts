import { NextRequest, NextResponse } from 'next/server'
import { MAIL_PROVIDERS, MailboxInputSchema, normalizeMailboxPassword } from '@/lib/outreach/model'
import { hasEmailFormat } from '@/lib/outreach/email-check'
import { MailboxError, verifyMailbox } from '@/lib/outreach/mailbox'
import { deleteMailbox, getMailboxStatus, saveMailbox } from '@/lib/db/outreach'
import { fail, firstIssue, requireOutreachAccount } from '@/lib/outreach/server'

export const maxDuration = 60

/**
 * Connect the mailbox recruiter emails are sent from. Chills signs in to it
 * first and saves it only if that works, so a typo is caught here rather than
 * on the first send. The password is stored encrypted and never sent back.
 */
export async function PUT(req: NextRequest) {
  const auth = await requireOutreachAccount()
  if (!auth.ok) return auth.response

  const parsed = MailboxInputSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail(400, firstIssue(parsed.error))
  const { provider, host, port } = parsed.data
  const address = parsed.data.address.toLowerCase()
  if (!hasEmailFormat(address)) return fail(400, 'Enter the full email address you send from.')

  const preset = MAIL_PROVIDERS[provider]
  const login = {
    provider,
    host: provider === 'custom' ? host.toLowerCase() : preset.host,
    port: provider === 'custom' ? port : preset.port,
    address,
    password: normalizeMailboxPassword(provider, parsed.data.password),
  }

  try {
    await verifyMailbox(login)
  } catch (err) {
    if (err instanceof MailboxError) return fail(err.kind === 'settings' ? 400 : 422, err.message)
    console.error('[outreach/mailbox] verify failed:', err instanceof Error ? err.message : err)
    return fail(502, 'The mailbox couldn’t be checked just now. Try again in a moment.')
  }

  await saveMailbox(auth.userId, login)
  return NextResponse.json({ mailbox: await getMailboxStatus(auth.userId) })
}

/** Disconnect the mailbox. Its password is deleted with it. */
export async function DELETE() {
  const auth = await requireOutreachAccount()
  if (!auth.ok) return auth.response
  await deleteMailbox(auth.userId)
  return new NextResponse(null, { status: 204 })
}
