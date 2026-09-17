import { NextRequest, NextResponse } from 'next/server'
import { LIMITS, RecruiterInputSchema } from '@/lib/outreach/model'
import { checkEmail } from '@/lib/outreach/email-check'
import { addRecruiters, countRecruiters, existingRecruiterEmails, listRecruiters } from '@/lib/db/outreach'
import { fail, firstIssue, requireOutreachAccount } from '@/lib/outreach/server'

export async function GET() {
  const auth = await requireOutreachAccount()
  if (!auth.ok) return auth.response
  return NextResponse.json({ recruiters: await listRecruiters(auth.userId), limit: LIMITS.recruitersPerAccount })
}

/** Add one recruiter, after checking the address can receive email. */
export async function POST(req: NextRequest) {
  const auth = await requireOutreachAccount()
  if (!auth.ok) return auth.response

  const parsed = RecruiterInputSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail(400, firstIssue(parsed.error))

  const check = await checkEmail(parsed.data.email)
  if (!check.valid) {
    return NextResponse.json(
      {
        error: check.suggestion ? `${check.message} Did you mean ${check.suggestion}?` : check.message,
        reason: check.reason,
        ...(check.suggestion ? { suggestion: check.suggestion } : {}),
      },
      { status: 400 }
    )
  }
  if ((await existingRecruiterEmails(auth.userId)).has(check.email)) {
    return fail(409, `${check.email} is already in your recruiters.`)
  }
  if ((await countRecruiters(auth.userId)) >= LIMITS.recruitersPerAccount) {
    return fail(409, `Your list is full at ${LIMITS.recruitersPerAccount} recruiters. Remove some to add more.`)
  }

  const { ids } = await addRecruiters(auth.userId, [{ ...parsed.data, email: check.email }], 'manual')
  if (ids.length === 0) return fail(409, `${check.email} is already in your recruiters.`)
  const recruiter = (await listRecruiters(auth.userId)).find((row) => row.id === ids[0])
  return NextResponse.json({ recruiter }, { status: 201 })
}
