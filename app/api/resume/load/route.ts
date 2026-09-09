import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/require-auth'
import { getProfile, PROFILE_ORDER } from '@/lib/profiles'
import { loadResumeSource } from '@/lib/latex/source'
import { parseLatexResume } from '@/lib/latex/parse'
import { compileHost } from '@/lib/latex/compile'

const schema = z.object({
  profileId: z.enum(PROFILE_ORDER as [string, ...string[]]),
})

/**
 * Load a profile's LaTeX resume and parse it into sections.
 *
 * Replaces the old copy-the-Google-Doc step: there is nothing to copy, because
 * the .tex on disk is read-only as far as this app is concerned and every
 * optimization produces a fresh copy in memory.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Unknown resume profile' }, { status: 400 })
  }

  const profile = getProfile(parsed.data.profileId)

  try {
    const latex = await loadResumeSource(profile)
    const { resume, editable } = parseLatexResume(latex, `${profile.personName} Resume`)
    resume.documentId = profile.id

    if (editable.length === 0) {
      return NextResponse.json(
        {
          error:
            `No editable content found in resumes/${profile.texFile}. Bullets must live inside ` +
            `\\resumeItem{...}, \\skillLine{...} or \\resumeSummary{...} for the optimizer to see them.`,
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      resume,
      latex,
      editableCount: editable.length,
      // So the UI can name the compile destination accurately rather than
      // hard-coding a host that LATEX_COMPILE_URL may have changed.
      compileHost: compileHost(),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[resume/load]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
