import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/require-auth'
import { ResumeDocSchema, SOURCE_FORMATS } from '@/lib/resume-doc'
import { renderCheckedResume } from '@/lib/import/render'
import {
  countResumes,
  createResume,
  ensureUser,
  listResumes,
  MAX_RESUMES_PER_USER,
} from '@/lib/db/resumes'

const createSchema = z.object({
  title: z.string().trim().max(120).optional(),
  sourceFormat: z.enum(SOURCE_FORMATS),
  doc: ResumeDocSchema,
})

/** The signed-in user's saved resumes, newest first. */
export async function GET() {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  if (!auth.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  try {
    return NextResponse.json({ resumes: await listResumes(auth.userId) })
  } catch (err) {
    console.error('[resumes] list failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Your resumes could not be loaded right now.' }, { status: 500 })
  }
}

/**
 * Save a structured resume. The LaTeX is rendered here from the structured doc,
 * never accepted from the browser.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  if (!auth.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json(
      { error: issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid resume' },
      { status: 400 }
    )
  }

  const { doc, sourceFormat } = parsed.data
  const rendered = renderCheckedResume(doc)
  if (!rendered.ok) {
    return NextResponse.json({ error: rendered.problems.join(' ') }, { status: 422 })
  }

  try {
    if ((await countResumes(auth.userId)) >= MAX_RESUMES_PER_USER) {
      return NextResponse.json(
        { error: `You can keep up to ${MAX_RESUMES_PER_USER} resumes. Delete one to save another.` },
        { status: 409 }
      )
    }

    await ensureUser({ id: auth.userId, email: auth.email, name: auth.userName || null })
    const resume = await createResume(auth.userId, {
      title: parsed.data.title || doc.name,
      sourceFormat,
      doc,
      latex: rendered.latex,
    })
    return NextResponse.json(
      { resume, latex: rendered.latex, sections: rendered.parsed.resume.sections },
      { status: 201 }
    )
  } catch (err) {
    console.error('[resumes] save failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'The resume could not be saved right now.' }, { status: 500 })
  }
}
