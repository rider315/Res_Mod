import { sanitizeLatexFragment } from '@/lib/latex/sanitize'

/**
 * Editing a suggested change as ordinary text. A suggestion is a line of LaTeX;
 * a person edits it with **double asterisks** for bold and plain % & _ # $, and
 * the sanitizer turns it back into LaTeX, refusing anything it can't make safe.
 *
 * Client-safe.
 */

const UNESCAPES: Array<[RegExp, string]> = [
  [/\\textless\{\}/g, '<'],
  [/\\textgreater\{\}/g, '>'],
  [/\\textasciitilde\{\}/g, '~'],
  [/\\textasciicircum\{\}/g, '^'],
  [/\\([%&_#$])/g, '$1'],
]

/** A LaTeX line as text a person can edit. */
export function latexToEditable(latex: string): string {
  let text = latex
  // Bold without nested braces becomes **bold**; anything more elaborate stays as it is.
  text = text.replace(/\\textbf\{([^{}]*)\}/g, '**$1**')
  for (const [pattern, replacement] of UNESCAPES) text = text.replace(pattern, replacement)
  return text
}

export type EditResult = { ok: true; latex: string } | { ok: false; problem: string }

/** Edited text back to a LaTeX line, or the reason it can't be used. */
export function editableToLatex(text: string): EditResult {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, problem: 'The line is empty.' }
  const result = sanitizeLatexFragment(trimmed)
  if (!result.ok) {
    return { ok: false, problem: `That can't go into the resume: ${result.problems.join('; ')}.` }
  }
  return { ok: true, latex: result.text }
}
