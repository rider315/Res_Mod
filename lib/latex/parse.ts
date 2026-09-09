import { ParsedResume, ResumeSection } from '@/types/resume'

/**
 * Turning a resume .tex into the section model the optimizer already speaks.
 *
 * The templates in resumes/ keep every piece of editable prose inside one of
 * three single-argument macros — \resumeSummary, \skillLine, \resumeItem — and
 * every structural fact (employer, role, dates, project title) inside a macro we
 * never touch. That split is the whole trick: it means a "content line" can be
 * the *exact source text* of a macro argument, so a rewrite is a precise splice
 * into a known byte range rather than a search-and-replace over the document.
 *
 * Structural lines are still emitted into the section content, tagged with a
 * [Role]/[Project]/[Group] prefix, because the model needs to know which
 * employer a bullet belongs to. The profiles freeze those prefixes so no rewrite
 * can ever target one.
 */

/** Macros whose single argument is editable prose. */
const CONTENT_MACROS = ['resumeSummary', 'skillLine', 'resumeItem'] as const
export type ContentMacro = (typeof CONTENT_MACROS)[number]

/** Prefixes marking a structural line. Profiles freeze these. */
export const ROLE_PREFIX = '[Role]'
export const PROJECT_PREFIX = '[Project]'
export const GROUP_PREFIX = '[Group]'

export interface EditableSpan {
  sectionId: string
  sectionTitle: string
  macro: ContentMacro
  /** Index of the first character *inside* the argument braces. */
  argStart: number
  /** Index one past the last character inside the argument braces. */
  argEnd: number
  /** The exact source text of the argument. */
  text: string
}

export interface ParsedLatexResume {
  resume: ParsedResume
  /** Every editable macro argument, in document order. */
  editable: EditableSpan[]
}

/**
 * Read a brace-balanced argument starting at `open` (which must be a '{').
 * Returns null if the braces never close.
 */
export function readArg(src: string, open: number): { text: string; end: number } | null {
  if (src[open] !== '{') return null
  let depth = 0
  let i = open
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return { text: src.slice(open + 1, i), end: i + 1 }
    }
    i++
  }
  return null
}

/** Skip whitespace, then read `count` consecutive brace-balanced arguments. */
function readArgs(
  src: string,
  from: number,
  count: number
): { args: Array<{ text: string; start: number; end: number }>; end: number } | null {
  const args: Array<{ text: string; start: number; end: number }> = []
  let i = from
  for (let n = 0; n < count; n++) {
    while (i < src.length && (src[i] === ' ' || src[i] === '\n' || src[i] === '\r' || src[i] === '\t')) i++
    const arg = readArg(src, i)
    if (!arg) return null
    args.push({ text: arg.text, start: i + 1, end: arg.end - 1 })
    i = arg.end
  }
  return { args, end: i }
}

/** True when `src` has `\name` at `i` and it is not a prefix of a longer macro. */
function macroAt(src: string, i: number, name: string): boolean {
  if (src[i] !== '\\') return false
  if (!src.startsWith(name, i + 1)) return false
  const after = src[i + 1 + name.length]
  return after === undefined || !/[a-zA-Z]/.test(after)
}

/**
 * Strip inline formatting so a structural line reads as plain text in the prompt.
 * Only used for context lines the model must never rewrite, so it can be lossy.
 */
export function stripMarkup(latex: string): string {
  let out = latex
  // \href{url}{label} -> label
  out = out.replace(/\\href\s*\{[^{}]*\}\s*\{/g, '{')
  // \textbf{x} / \emph{x} / ... -> x   (repeat for nesting)
  for (let pass = 0; pass < 4; pass++) {
    out = out.replace(/\\(?:textbf|textit|emph|underline|texttt|textsc|small|scshape)\s*\{([^{}]*)\}/g, '$1')
  }
  out = out
    .replace(/\$\|\$/g, '|')
    .replace(/\$\\cdot\$/g, '-')
    .replace(/\\&/g, '&')
    .replace(/\\%/g, '%')
    .replace(/\\_/g, '_')
    .replace(/\\#/g, '#')
    .replace(/\\\$/g, '$')
    .replace(/\\\\/g, ' ')
    .replace(/--/g, '-')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return out
}

/**
 * Parse a resume .tex into sections plus the list of editable spans.
 *
 * Scanning starts after \begin{document} so the macro *definitions* in the
 * preamble — which contain \resumeItem{...} shaped text — are never mistaken for
 * content.
 */
export function parseLatexResume(source: string, title: string): ParsedLatexResume {
  const bodyStart = source.indexOf('\\begin{document}')
  const start = bodyStart === -1 ? 0 : bodyStart + '\\begin{document}'.length

  const sections: ResumeSection[] = []
  const editable: EditableSpan[] = []
  let sectionIdx = 0
  let current: ResumeSection | null = null

  const ensureSection = (): ResumeSection => {
    if (!current) {
      current = { id: 'section_header', title: 'Header / Contact', content: [] }
    }
    return current
  }

  const pushStructural = (line: string) => {
    const text = line.trim()
    if (text) ensureSection().content.push(text)
  }

  let i = start
  while (i < source.length) {
    const ch = source[i]

    // Comments are not content.
    if (ch === '%') {
      const nl = source.indexOf('\n', i)
      i = nl === -1 ? source.length : nl + 1
      continue
    }
    if (ch !== '\\') {
      i++
      continue
    }
    if (source.startsWith('\\%', i) || source.startsWith('\\&', i) || source.startsWith('\\_', i)) {
      i += 2
      continue
    }

    // ---- section boundary ----
    if (macroAt(source, i, 'section')) {
      const read = readArgs(source, i + '\\section'.length, 1)
      if (read) {
        if (current) sections.push(current)
        current = {
          id: `section_${sectionIdx++}`,
          title: stripMarkup(read.args[0].text) || `Section ${sectionIdx}`,
          content: [],
        }
        i = read.end
        continue
      }
    }

    // ---- the contact block before the first \section ----
    if (macroAt(source, i, 'begin') && source.startsWith('\\begin{center}', i)) {
      const close = source.indexOf('\\end{center}', i)
      if (close !== -1) {
        const inner = source.slice(i + '\\begin{center}'.length, close)
        const text = stripMarkup(inner.replace(/\\Huge|\\vspace\{[^}]*\}|\\small/g, ''))
        if (text) pushStructural(text)
        i = close + '\\end{center}'.length
        continue
      }
    }

    // ---- structural headings (frozen, but kept for context) ----
    if (macroAt(source, i, 'resumeSubheading')) {
      const read = readArgs(source, i + '\\resumeSubheading'.length, 4)
      if (read) {
        const [org, dates, role, place] = read.args.map((a) => stripMarkup(a.text))
        pushStructural(`${ROLE_PREFIX} ${org} | ${role} | ${dates} | ${place}`)
        i = read.end
        continue
      }
    }
    if (macroAt(source, i, 'resumeProjectHeading')) {
      const read = readArgs(source, i + '\\resumeProjectHeading'.length, 2)
      if (read) {
        pushStructural(`${PROJECT_PREFIX} ${stripMarkup(read.args[0].text)} (${stripMarkup(read.args[1].text)})`)
        i = read.end
        continue
      }
    }
    if (macroAt(source, i, 'resumeGroupHeading')) {
      const read = readArgs(source, i + '\\resumeGroupHeading'.length, 1)
      if (read) {
        pushStructural(`${GROUP_PREFIX} ${stripMarkup(read.args[0].text)}`)
        i = read.end
        continue
      }
    }

    // ---- editable content macros ----
    let matched = false
    for (const macro of CONTENT_MACROS) {
      if (!macroAt(source, i, macro)) continue
      const read = readArgs(source, i + macro.length + 1, 1)
      if (!read) break
      const arg = read.args[0]
      const section = ensureSection()
      const text = arg.text.trim()
      if (text) {
        section.content.push(text)
        editable.push({
          sectionId: section.id,
          sectionTitle: section.title,
          macro,
          // Trim leading/trailing whitespace out of the recorded span so a
          // replacement cannot smuggle indentation into the rewritten text.
          argStart: arg.start + (arg.text.length - arg.text.trimStart().length),
          argEnd: arg.end - (arg.text.length - arg.text.trimEnd().length),
          text,
        })
      }
      i = read.end
      matched = true
      break
    }
    if (matched) continue

    i++
  }

  if (current) sections.push(current)

  return {
    resume: { documentId: title, title, sections },
    editable,
  }
}
