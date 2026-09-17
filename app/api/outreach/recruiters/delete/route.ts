import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { LIMITS } from '@/lib/outreach/model'
import { deleteRecruiters } from '@/lib/db/outreach'
import { fail, firstIssue, requireOutreachAccount } from '@/lib/outreach/server'

const schema = z.object({ ids: z.array(z.string()).min(1, 'Choose the recruiters to remove.').max(LIMITS.recruitersPerAccount) })

/** Remove several recruiters at once, with their emails and replies. */
export async function POST(req: NextRequest) {
  const auth = await requireOutreachAccount()
  if (!auth.ok) return auth.response
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail(400, firstIssue(parsed.error))
  return NextResponse.json({ deleted: await deleteRecruiters(auth.userId, parsed.data.ids) })
}
