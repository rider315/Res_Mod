import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/require-auth'
import { getResume } from '@/lib/db/resumes'
import { saveTailoring } from '@/lib/db/tailorings'
import { renderCheckedResume } from '@/lib/import/render'
import { LatexApplyResult } from '@/lib/latex/apply'
import { ResumeDoc, ResumeDocSchema } from '@/lib/resume-doc'
import { historyCoverage } from '@/lib/tailor/history'
import { JdKeywordsSchema } from '@/lib/tailor/keywords'
import { TAILOR_LEVELS } from '@/lib/tailor/levels'
import { ChangeListSchema, tailorStoredResume } from '@/lib/tailor/splice'

type Params = { params: { id: string } }

const HistorySchema = z.object({
  level: z.enum(TAILOR_LEVELS),
  jobDescription: z.string().max(20_000).default(''),
  jobTitle: z.string().max(200).default(''),
  company: z.string().max(200).default(''),
  keywords: JdKeywordsSchema.shape.keywords.optional().catch(undefined),
})

const schema = z.object({
  changes: ChangeListSchema,
  /** What the run was for, kept with the tailored copy in the account's history. Never blocks applying. */
  history: HistorySchema.optional().catch(undefined),
})

/**
 * Splice the approved tailoring changes into a copy of one of the signed-in
 * user's resumes, and keep that copy in the account's history. The stored
 * resume is never modified.
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
    if (!row || !doc?.success) return NextResponse.json({ error: 'Resume not found' }, { status: 404 })

    const tailored = tailorStoredResume(doc.data, approved)
    if (!tailored.ok) return NextResponse.json({ error: tailored.error }, { status: tailored.status })

    const { result } = tailored
    const { history } = parsed.data
    const tailoringId =
      history && result.applied > 0
        ? await keepInHistory(auth.userId, { id: row.id, title: row.title, doc: doc.data }, approved, result, history)
        : null

    return NextResponse.json({
      latex: result.latex,
      appliedCount: result.applied,
      requestedCount: result.requested,
      unmatched: result.unmatched,
      overlapping: result.overlapping,
      rejected: result.rejected,
      tailoringId,
    })
  } catch (err) {
    console.error('[resumes/:id/apply]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'The changes could not be applied right now.' }, { status: 500 })
  }
}

/** Save the tailored copy. A failure here is logged, not passed on: the user still gets their document. */
async function keepInHistory(
  userId: string,
  resume: { id: string; title: string; doc: ResumeDoc },
  approved: Array<{ original: string; proposed: string }>,
  result: LatexApplyResult,
  history: z.infer<typeof HistorySchema>
): Promise<string | null> {
  try {
    const skipped = new Set([...result.unmatched, ...result.rejected.map((r) => r.original)])
    const applied = approved
      .filter((change) => !skipped.has(change.original))
      .map(({ original, proposed }) => ({ original, proposed }))
    const rendered = renderCheckedResume(resume.doc)
    const coverage =
      rendered.ok && history.keywords ? historyCoverage(rendered.parsed.resume, history.keywords, applied) : null

    return await saveTailoring(userId, {
      resumeId: resume.id,
      resumeTitle: resume.title,
      jobTitle: history.jobTitle.trim(),
      company: history.company.trim(),
      level: history.level,
      jobDescription: history.jobDescription,
      changes: applied,
      appliedCount: result.applied,
      coverage,
      latex: result.latex,
    })
  } catch (err) {
    console.error('[resumes/:id/apply] the tailored copy was not saved to history:', err instanceof Error ? err.message : err)
    return null
  }
}
