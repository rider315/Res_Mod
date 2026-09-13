import { z } from 'zod'
import { applyLatexChanges, LatexApplyResult } from '@/lib/latex/apply'
import { renderCheckedResume } from '@/lib/import/render'
import { ResumeDoc } from '@/lib/resume-doc'

/**
 * Splicing approved tailoring changes into a regular user's resume.
 *
 * The base LaTeX is always rendered from the stored structured resume, and every
 * change goes through applyLatexChanges, which sanitizes each proposed line and
 * only replaces lines that already exist. Nothing a browser sends reaches the
 * document except as a checked rewrite of one of its own lines.
 */

export const ChangeListSchema = z
  .array(
    z.object({
      original: z.string().max(4000),
      proposed: z.string().max(4000),
      approved: z.boolean().nullable(),
    })
  )
  .max(200)

export type TailorSplice =
  | { ok: true; result: LatexApplyResult }
  | { ok: false; status: number; error: string }

export function tailorStoredResume(
  doc: ResumeDoc,
  changes: Array<{ original: string; proposed: string }>
): TailorSplice {
  const rendered = renderCheckedResume(doc)
  if (!rendered.ok) return { ok: false, status: 422, error: rendered.problems.join(' ') }

  const result = applyLatexChanges(
    rendered.latex,
    changes.map(({ original, proposed }) => ({ original, proposed }))
  )
  if (result.documentProblems.length > 0) {
    return {
      ok: false,
      status: 422,
      error:
        `Those changes would leave a .tex that does not compile (${result.documentProblems.join('; ')}). ` +
        'Nothing was changed. Try rejecting the most heavily rewritten change.',
    }
  }
  return { ok: true, result }
}
