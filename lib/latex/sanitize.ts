/**
 * Making model output safe to splice into a .tex file.
 *
 * Two separate risks, both real:
 *
 * 1. Correctness. A model writes "cut latency by 40%" and, unescaped, the "%"
 *    comments out the rest of the line — the bullet silently loses its ending.
 *    Same for & _ # and unbalanced braces, which break the build outright.
 *
 * 2. Safety. The .tex produced here is compiled, by the user or by a compile
 *    service. A job description is untrusted text: it can carry instructions
 *    aimed at the model, and a model that follows them could emit \input,
 *    \write18 or \openout — file reads and shell escapes at compile time. So
 *    macros are allow-listed rather than deny-listed: anything not on the list
 *    rejects the change instead of being written out and hoped about.
 */

/** Macros a rewritten bullet may legitimately contain. */
const ALLOWED_MACROS = new Set([
  // inline formatting
  'textbf', 'textit', 'emph', 'underline', 'texttt', 'textsc',
  // links
  'href', 'url',
  // harmless symbols
  'ldots', 'dots', 'textbullet', 'textendash', 'textemdash',
  'textasciitilde', 'textasciicircum', 'textbackslash', 'checkmark',
  'textless', 'textgreater',
])

/** Named so the rejection message can say *why*, not just "not allowed". */
const DANGEROUS_MACROS = new Set([
  'input', 'include', 'write', 'immediate', 'openout', 'openin', 'read',
  'catcode', 'def', 'gdef', 'edef', 'xdef', 'csname', 'expandafter',
  'usepackage', 'documentclass', 'newcommand', 'renewcommand', 'let',
  'special', 'pdfliteral', 'shipout', 'jobname', 'ShellEscape', 'write18',
  'lstinputlisting', 'verbatiminput', 'includegraphics',
])

export interface SanitizeResult {
  ok: boolean
  /** The safe LaTeX to write. Meaningful only when ok. */
  text: string
  /** Why the fragment was rejected. */
  problems: string[]
}

/** Markdown leaks out of models constantly; translate the unambiguous forms. */
function convertMarkdown(s: string): string {
  return s
    .replace(/\*\*([^*\n]+)\*\*/g, '\\textbf{$1}')
    .replace(/__([^_\n]+)__/g, '\\textbf{$1}')
    .replace(/`([^`\n]+)`/g, '\\texttt{$1}')
}

/**
 * Built from code points so this source file stays pure ASCII — literal
 * zero-width and control characters in a regex are invisible to whoever reads
 * this next, and some tooling treats a file containing them as binary.
 */
function charClass(codes: number[]): RegExp {
  const body = codes.map((c) => '\\u' + c.toString(16).padStart(4, '0')).join('')
  return new RegExp('[' + body + ']', 'g')
}

/** Non-breaking and typographic spaces, folded to a plain space. */
const EXOTIC_SPACE = charClass([
  0x00a0, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
  0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f, 0x3000,
])

/** Zero-width joiners, BOM and the soft hyphen: dropped outright. */
const INVISIBLE = charClass([0x200b, 0x200c, 0x200d, 0xfeff, 0x00ad])

/** Control characters have no place in a bullet and can confuse TeX. */
function stripControlChars(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.charCodeAt(0)
    if (code >= 32 && code !== 127) out += ch
  }
  return out
}

/** Unicode punctuation models emit, folded to ASCII / TeX equivalents. */
function foldUnicode(s: string): string {
  return s
    .replace(/[‘’‚‛′´]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–−]/g, '-')
    .replace(/[—―]/g, '--')
    .replace(/…/g, '\\ldots{}')
    .replace(/[•·]/g, '')
    .replace(EXOTIC_SPACE, ' ')
    .replace(INVISIBLE, '')
}

/**
 * Escape the characters that are special to TeX, leaving already-escaped ones
 * and allow-listed macros alone.
 */
export function sanitizeLatexFragment(input: string): SanitizeResult {
  const problems: string[] = []

  // A bullet is a single line: fold newlines away before anything else so a
  // stray blank line can't start a new paragraph inside a macro argument.
  let s = input.replace(/\r\n?/g, '\n').replace(/\s*\n\s*/g, ' ')
  s = stripControlChars(s)
  s = convertMarkdown(s)
  s = foldUnicode(s)

  const out: string[] = []
  let depth = 0
  let i = 0

  while (i < s.length) {
    const ch = s[i]

    if (ch === '\\') {
      const nameMatch = /^[a-zA-Z]+/.exec(s.slice(i + 1))

      if (nameMatch) {
        const name = nameMatch[0]
        if (DANGEROUS_MACROS.has(name)) {
          problems.push(`\\${name} is not permitted (file or shell access at compile time)`)
          return { ok: false, text: '', problems }
        }
        if (!ALLOWED_MACROS.has(name)) {
          problems.push(`\\${name} is not an allowed macro`)
          return { ok: false, text: '', problems }
        }
        out.push('\\' + name)
        i += 1 + name.length
        continue
      }

      const next = s[i + 1]
      if (next === undefined) {
        i++ // trailing lone backslash
        continue
      }
      if ('%&_#${}'.includes(next)) {
        out.push('\\' + next)
        i += 2
        continue
      }
      if (next === '\\') {
        // A forced line break has no place inside a resume bullet.
        out.push(' ')
        i += 2
        continue
      }
      if (next === ' ') {
        out.push('\\ ')
        i += 2
        continue
      }
      problems.push(`unsupported escape "\\${next}"`)
      return { ok: false, text: '', problems }
    }

    // The templates use $|$ as a separator; keep it, but allow no other math.
    if (s.startsWith('$|$', i)) {
      out.push('$|$')
      i += 3
      continue
    }

    if (ch === '{') {
      depth++
      out.push(ch)
      i++
      continue
    }
    if (ch === '}') {
      depth--
      if (depth < 0) {
        problems.push('unbalanced closing brace')
        return { ok: false, text: '', problems }
      }
      out.push(ch)
      i++
      continue
    }

    if (ch === '%' || ch === '&' || ch === '#' || ch === '_' || ch === '$') {
      out.push('\\' + ch)
      i++
      continue
    }
    if (ch === '~') {
      out.push('\\textasciitilde{}')
      i++
      continue
    }
    if (ch === '^') {
      out.push('\\textasciicircum{}')
      i++
      continue
    }
    // Not special to TeX, but in text mode these typeset as the inverted
    // punctuation glyphs: a bullet reading "<400ms p95" comes out "¡400ms p95".
    if (ch === '<') {
      out.push('\\textless{}')
      i++
      continue
    }
    if (ch === '>') {
      out.push('\\textgreater{}')
      i++
      continue
    }

    out.push(ch)
    i++
  }

  if (depth !== 0) {
    problems.push(`${depth} unclosed brace${depth === 1 ? '' : 's'}`)
    return { ok: false, text: '', problems }
  }

  const text = out.join('').replace(/\s+/g, ' ').trim()
  if (!text) {
    problems.push('empty after sanitizing')
    return { ok: false, text: '', problems }
  }

  return { ok: true, text, problems }
}

/**
 * Whole-document check, run before the optimized .tex is handed back.
 * Catches a splice that unbalanced the file even though each fragment was fine.
 */
export function validateLatexDocument(source: string): string[] {
  const problems: string[] = []

  for (const required of ['\\documentclass', '\\begin{document}', '\\end{document}']) {
    if (!source.includes(required)) problems.push(`missing ${required}`)
  }

  let depth = 0
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '%') {
      const nl = source.indexOf('\n', i)
      i = nl === -1 ? source.length : nl
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth < 0) {
        problems.push('unbalanced closing brace in document')
        break
      }
    }
    i++
  }
  if (depth > 0) problems.push(`${depth} unclosed brace(s) in document`)

  const collect = (pattern: RegExp): string[] => {
    const found: string[] = []
    let m: RegExpExecArray | null
    while ((m = pattern.exec(source)) !== null) found.push(m[1])
    return found.sort()
  }
  const begins = collect(/\\begin\{(\w+\*?)\}/g)
  const ends = collect(/\\end\{(\w+\*?)\}/g)
  if (begins.join(',') !== ends.join(',')) {
    problems.push('mismatched \\begin/\\end environments')
  }

  return problems
}
