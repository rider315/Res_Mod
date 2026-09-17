import { NextRequest, NextResponse } from 'next/server'
import { RecruiterInputSchema } from '@/lib/outreach/model'
import { deleteRecruiters, updateRecruiter } from '@/lib/db/outreach'
import { fail, firstIssue, requireOutreachAccount } from '@/lib/outreach/server'

type Params = { params: { id: string } }

const EditSchema = RecruiterInputSchema.pick({ name: true, company: true, title: true })

/** Correct a recruiter's name, company or title. The address can't change: add it as a new recruiter. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireOutreachAccount()
  if (!auth.ok) return auth.response
  const parsed = EditSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail(400, firstIssue(parsed.error))
  if (!(await updateRecruiter(auth.userId, params.id, parsed.data))) return fail(404, 'Recruiter not found')
  return NextResponse.json({ ok: true })
}

/** Remove a recruiter, with every email and reply to them. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireOutreachAccount()
  if (!auth.ok) return auth.response
  if ((await deleteRecruiters(auth.userId, [params.id])) === 0) return fail(404, 'Recruiter not found')
  return new NextResponse(null, { status: 204 })
}
