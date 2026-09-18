import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { LIMITS } from '@/lib/outreach/model'
import { takeFromDirectory } from '@/lib/db/directory'
import { addRecruiters } from '@/lib/db/outreach'
import { fail, firstIssue, requireOutreachAccount } from '@/lib/outreach/server'

export const dynamic = 'force-dynamic'

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Choose at least one recruiter.').max(LIMITS.directoryPerWeek),
})

/**
 * Take published recruiters into the account's own list, where the rest of
 * Outreach already knows what to do with them: an email is written from a
 * resume, reviewed, and sent from the user's own mailbox.
 *
 * The count is raised as they are taken, so a contact closes once enough
 * accounts have it. Nothing is emailed here.
 */
export async function POST(req: NextRequest) {
  const auth = await requireOutreachAccount()
  if (!auth.ok) return auth.response

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail(400, firstIssue(parsed.error))

  const result = await takeFromDirectory(auth.userId, parsed.data.ids)
  if (result.taken.length === 0) {
    return fail(
      409,
      result.weeklyLeft === 0
        ? `You’ve taken ${LIMITS.directoryPerWeek} recruiters from the directory this week. More next week — write to the ones you have first.`
        : 'Those recruiters are already in your list, or have been taken by as many people as they are open to.',
      'directory_none'
    )
  }

  // 'directory' marks where they came from, so the list can tell them apart later.
  const added = await addRecruiters(auth.userId, result.taken, 'directory')
  return NextResponse.json({
    added: added.added,
    skipped: result.skipped,
    overLimit: added.overLimit,
    weeklyLeft: result.weeklyLeft,
  })
}
