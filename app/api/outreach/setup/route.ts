import { NextRequest, NextResponse } from 'next/server'
import { OutreachProfileSchema } from '@/lib/outreach/model'
import type { OutreachSetup } from '@/lib/outreach/types'
import { getMailboxStatus, getOutreachProfile, saveOutreachProfile } from '@/lib/db/outreach'
import { fail, firstIssue, requireOutreachAccount } from '@/lib/outreach/server'

/** How recruiter emails are signed and sent: the sender profile, and which mailbox is connected. */
export async function GET() {
  const auth = await requireOutreachAccount()
  if (!auth.ok) return auth.response
  const [profile, mailbox] = await Promise.all([getOutreachProfile(auth.userId), getMailboxStatus(auth.userId)])
  const setup: OutreachSetup = { profile, mailbox, defaultName: auth.userName }
  return NextResponse.json(setup)
}

export async function PUT(req: NextRequest) {
  const auth = await requireOutreachAccount()
  if (!auth.ok) return auth.response
  const parsed = OutreachProfileSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail(400, firstIssue(parsed.error))
  await saveOutreachProfile(auth.userId, parsed.data)
  return NextResponse.json({ profile: parsed.data })
}
