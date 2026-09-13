import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/require-auth'
import { ResumeDocSchema } from '@/lib/resume-doc'
import { renderCheckedResume } from '@/lib/import/render'
import { deleteResume, getResume, updateResume } from '@/lib/db/resumes'

type Params = { params: { id: string } }

const updateSchema = z.object({
  title: z.string().trim().max(120).optional(),
  doc: ResumeDocSchema,
})

const notFound = () => NextResponse.json({ error: 'Resume not found' }, { status: 404 })

/** One of the signed-in user's resumes. Another account's id is simply not found. */
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  if (!auth.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  try {
    const row = await getResume(auth.userId, params.id)
    if (!row) return notFound()
    return NextResponse.json({
      resume: { id: row.id, title: row.title, sourceFormat: row.sourceFormat, updatedAt: row.updatedAt },
      doc: row.doc,
      latex: row.latex,
    })
  } catch (err) {
    console.error('[resumes/:id] load failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'The resume could not be loaded right now.' }, { status: 500 })
  }
}

/** Replace a resume's structured content; the LaTeX is re-rendered from it. */
export async function PUT(req: NextRequest, { params }: Params) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  if (!auth.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const parsed = updateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json(
      { error: issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid resume' },
      { status: 400 }
    )
  }

  const rendered = renderCheckedResume(parsed.data.doc)
  if (!rendered.ok) {
    return NextResponse.json({ error: rendered.problems.join(' ') }, { status: 422 })
  }

  try {
    const resume = await updateResume(auth.userId, params.id, {
      title: parsed.data.title || parsed.data.doc.name,
      doc: parsed.data.doc,
      latex: rendered.latex,
    })
    if (!resume) return notFound()
    return NextResponse.json({ resume, latex: rendered.latex, sections: rendered.parsed.resume.sections })
  } catch (err) {
    console.error('[resumes/:id] update failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'The resume could not be saved right now.' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  if (!auth.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  try {
    return (await deleteResume(auth.userId, params.id)) ? new NextResponse(null, { status: 204 }) : notFound()
  } catch (err) {
    console.error('[resumes/:id] delete failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'The resume could not be deleted right now.' }, { status: 500 })
  }
}
