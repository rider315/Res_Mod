import { NextResponse } from 'next/server'
import { countRecruiters, getMailboxStatus, listThreads, outreachByTailoring } from '@/lib/db/outreach'
import { summarizeThreads } from '@/lib/outreach/stats'
import { requireOutreachAccount } from '@/lib/outreach/server'

export const dynamic = 'force-dynamic'

/** Outreach at a glance, for the dashboard and History: the counts, and emails per tailored copy. */
export async function GET() {
  const auth = await requireOutreachAccount()
  if (!auth.ok) return auth.response
  const [threads, recruiters, byTailoring, mailbox] = await Promise.all([
    listThreads(auth.userId),
    countRecruiters(auth.userId),
    outreachByTailoring(auth.userId),
    getMailboxStatus(auth.userId),
  ])
  return NextResponse.json({
    stats: summarizeThreads(threads, recruiters),
    byTailoring,
    mailboxConnected: mailbox !== null,
  })
}
