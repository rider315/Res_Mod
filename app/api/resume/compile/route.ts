import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, sanitizeFileName } from '@/lib/require-auth'
import { compileLatexToPdf, compileHost } from '@/lib/latex/compile'
import { validateLatexDocument } from '@/lib/latex/sanitize'
import { getResume } from '@/lib/db/resumes'
import { renderResumeLatex } from '@/lib/import/render'
import { ResumeDocSchema } from '@/lib/resume-doc'

const schema = z.object({
  /** Owner only: the LaTeX to compile, straight from the dashboard. */
  latex: z.string().min(1).max(400_000).optional(),
  /** Any user: one of their saved resumes, re-rendered here from its structured doc. */
  resumeId: z.string().optional(),
  fileName: z.string().optional(),
})

/**
 * Compile a .tex to PDF.
 *
 * This is the one route that sends the resume off this machine, so it only ever
 * runs from an explicit click on "Compile PDF" — never as part of the optimize
 * or apply flow. The UI names the destination host next to the button.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success || (!parsed.data.latex && !parsed.data.resumeId)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  let latex: string
  if (parsed.data.resumeId) {
    const row = auth.userId ? await getResume(auth.userId, parsed.data.resumeId) : null
    const doc = row ? ResumeDocSchema.safeParse(row.doc) : null
    if (!doc?.success) {
      return NextResponse.json({ error: 'Resume not found' }, { status: 404 })
    }
    latex = renderResumeLatex(doc.data)
  } else {
    // Arbitrary LaTeX is the owner's alone; for anyone else this route would be
    // a free LaTeX build proxy.
    if (auth.role !== 'owner') {
      return NextResponse.json(
        { error: 'This part of ResMod is only available to the account owner.' },
        { status: 403 }
      )
    }
    latex = parsed.data.latex as string
  }

  const problems = validateLatexDocument(latex)
  if (problems.length > 0) {
    return NextResponse.json(
      { error: `That .tex is not a complete document: ${problems.join('; ')}` },
      { status: 400 }
    )
  }

  const result = await compileLatexToPdf(latex)

  if (!result.ok) {
    console.error('[resume/compile] failed via', compileHost())
    return NextResponse.json(
      { error: 'LaTeX compilation failed', log: result.log, host: compileHost() },
      { status: 502 }
    )
  }

  const name = sanitizeFileName(parsed.data.fileName ?? '') || 'Resume'
  return new NextResponse(new Uint8Array(result.pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${name}.pdf"`,
    },
  })
}
