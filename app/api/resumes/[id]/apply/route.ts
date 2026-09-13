import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/require-auth'
import { getResume } from '@/lib/db/resumes'
import { ResumeDocSchema } from '@/lib/resume-doc'
import { ChangeListSchema, tailorStoredResume } from '@/lib/tailor/splice'

type Params = { params: { id: string } }

const schema = z.object({ changes: ChangeListSchema })

/**
 * Splice the approved tailoring changes into a copy of one of the signed-in
 * user's resumes. The stored resume is never modified.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  if (!auth.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid changes' }, { status: 400 })

  const approved = parsed.data.changes.filter((change) => change.approved === true)
  if (approved.length === 0) {
    return NextResponse.json({ error: 'No approved changes to apply' }, { status: 400 })
  }

  try {
    const row = await getResume(auth.userId, params.id)
    const doc = row ? ResumeDocSchema.safeParse(row.doc) : null
    if (!doc?.success) return NextResponse.json({ error: 'Resume not found' }, { status: 404 })

    const tailored = tailorStoredResume(doc.data, approved)
    if (!tailored.ok) return NextResponse.json({ error: tailored.error }, { status: tailored.status })

    const { result } = tailored
    return NextResponse.json({
      latex: result.latex,
      appliedCount: result.applied,
      requestedCount: result.requested,
      unmatched: result.unmatched,
      overlapping: result.overlapping,
      rejected: result.rejected,
    })
  } catch (err) {
    console.error('[resumes/:id/apply]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'The changes could not be applied right now.' }, { status: 500 })
  }
}
