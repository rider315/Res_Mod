import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOwner, sanitizeFileName } from '@/lib/require-auth'
import { compileLatexToPdf, compileHost } from '@/lib/latex/compile'
import { validateLatexDocument } from '@/lib/latex/sanitize'

const schema = z.object({
  latex: z.string().min(1).max(400_000),
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
  // Owner-only for now: regular users have no resume stored on the server to
  // compile yet, and an open endpoint would be a free LaTeX build proxy.
  const auth = await requireOwner()
  if (!auth.ok) return auth.response

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const problems = validateLatexDocument(parsed.data.latex)
  if (problems.length > 0) {
    return NextResponse.json(
      { error: `That .tex is not a complete document: ${problems.join('; ')}` },
      { status: 400 }
    )
  }

  const result = await compileLatexToPdf(parsed.data.latex)

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
