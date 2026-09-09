import { parseLatexResume, EditableSpan } from '@/lib/latex/parse'
import { findSpan, MatchHow } from '@/lib/latex/match'
import { sanitizeLatexFragment, validateLatexDocument } from '@/lib/latex/sanitize'

/**
 * Writing approved rewrites back into the .tex.
 *
 * Every edit is a splice into a byte range the parser identified as a content
 * macro's argument, never a search-and-replace over the whole file. That
 * distinction is what makes this safe: a bullet whose text happens to also
 * appear in the preamble, in a frozen heading, or in another section cannot be
 * collaterally rewritten, and a change that fails to resolve to exactly one span
 * is reported instead of guessed at.
 *
 * Splices are applied back-to-front so earlier offsets stay valid.
 */

export interface LatexChangeInput {
  original: string
  proposed: string
  sectionTitle?: string
}

export interface LatexApplyResult {
  /** The rewritten document. Equal to the input when nothing could be applied. */
  latex: string
  requested: number
  applied: number
  /** Changes whose "original" matched no editable span (or matched several). */
  unmatched: string[]
  /** Changes dropped because an earlier change already rewrote the same span. */
  overlapping: string[]
  /** Changes refused by the sanitizer, with the reason. */
  rejected: Array<{ original: string; reason: string }>
  /** How many needed looser-than-exact matching to be located. */
  recovered: number
  /** Non-empty if the spliced document failed validation — then latex is unchanged. */
  documentProblems: string[]
}

export function applyLatexChanges(
  source: string,
  changes: LatexChangeInput[]
): LatexApplyResult {
  const result: LatexApplyResult = {
    latex: source,
    requested: changes.length,
    applied: 0,
    unmatched: [],
    overlapping: [],
    rejected: [],
    recovered: 0,
    documentProblems: [],
  }
  if (changes.length === 0) return result

  const { editable } = parseLatexResume(source, 'resume')

  const edits: Array<{ span: EditableSpan; text: string; how: MatchHow }> = []
  const claimed = new Set<number>()

  // Longest first: when two changes could resolve to the same bullet, the more
  // specific quote is the one more likely to have meant it.
  const ordered = [...changes].sort((a, b) => b.original.length - a.original.length)

  for (const change of ordered) {
    const match = findSpan(editable, change.original)
    if (!match) {
      result.unmatched.push(change.original)
      continue
    }
    if (claimed.has(match.span.argStart)) {
      result.overlapping.push(change.original)
      continue
    }

    const clean = sanitizeLatexFragment(change.proposed)
    if (!clean.ok) {
      result.rejected.push({ original: change.original, reason: clean.problems.join('; ') })
      continue
    }

    claimed.add(match.span.argStart)
    edits.push({ span: match.span, text: clean.text, how: match.how })
    if (match.how !== 'exact') result.recovered++
  }

  if (edits.length === 0) return result

  // Back to front so each splice leaves earlier offsets untouched.
  edits.sort((a, b) => b.span.argStart - a.span.argStart)
  let out = source
  for (const edit of edits) {
    out = out.slice(0, edit.span.argStart) + edit.text + out.slice(edit.span.argEnd)
  }

  // Never hand back a .tex that will not build.
  const problems = validateLatexDocument(out)
  if (problems.length > 0) {
    return { ...result, documentProblems: problems }
  }

  result.latex = out
  result.applied = edits.length
  return result
}
