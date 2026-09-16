import { visible } from '@/lib/latex/match'
import { ALLOWED_MACROS, sanitizeLatexFragment } from '@/lib/latex/sanitize'
import { LengthLimits } from '@/lib/normalize-changes'
import { STRUCTURAL_LINE } from '@/lib/profiles/types'
import { ParsedResume, ResumeChange, ResumeSection } from '@/types/resume'

/**
 * Making sure every change a run returns can actually be applied.
 *
 * Each pass after the first sees the resume as the changes so far would leave
 * it, so a model can quote a line that only exists once an earlier change is
 * applied, quote it with the markup moved around, or rewrite a line another
 * pass already rewrote. Those reach the review screen looking fine and then
 * fail at splice time as "the text no longer matched a line" — after the user
 * approved them.
 *
 * So the last thing a run does is point every change back at a real line of the
 * resume, fold a rewrite of a rewrite into the change it builds on, keep one
 * change per line, and repair or drop a proposal the sanitizer would refuse.
 *
 * Client-safe and pure: the Puter path runs this in the browser too.
 */

export interface ResolveResult {
  changes: ResumeChange[]
  dropped: Array<{ change: ResumeChange; reason: string }>
}

interface SourceLine {
  text: string
  section: ResumeSection
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()
const unescape = (text: string) => text.replace(/\\([%&_#$])/g, '$1')

/** The same ladder the splice step matches on, loosest last. */
const KEYS: Array<(text: string) => string> = [
  (text) => text.trim(),
  collapse,
  (text) => collapse(unescape(text)),
  visible,
  (text) => visible(text).toLowerCase(),
]

const proposalKey = (text: string) => visible(text).toLowerCase()

function sourceLines(resume: ParsedResume, frozen?: (section: ResumeSection) => boolean): SourceLine[] {
  const lines: SourceLine[] = []
  for (const section of resume.sections) {
    if (frozen?.(section)) continue
    for (const text of section.content) {
      if (!STRUCTURAL_LINE.test(text)) lines.push({ text, section })
    }
  }
  return lines
}

/** One lookup per level, holding only the keys that identify a single line: ambiguity must not be guessed at. */
function indexLines(lines: SourceLine[]): Array<Map<string, SourceLine>> {
  return KEYS.map((key) => {
    const found = new Map<string, SourceLine>()
    const ambiguous = new Set<string>()
    for (const line of lines) {
      const value = key(line.text)
      if (!value) continue
      if (found.has(value)) ambiguous.add(value)
      else found.set(value, line)
    }
    ambiguous.forEach((value) => found.delete(value))
    return found
  })
}

function locateLine(indexes: Array<Map<string, SourceLine>>, lines: SourceLine[], wanted: string): SourceLine | null {
  const target = wanted.trim()
  if (!target) return null

  for (let level = 0; level < KEYS.length; level++) {
    const hit = indexes[level].get(KEYS[level](target))
    if (hit) return hit
  }

  // Last resort, as the splice step does: a quote that contains the line, or sits inside it.
  const key = proposalKey(target)
  if (key.length >= 25) {
    const hits = lines.filter((line) => {
      const text = proposalKey(line.text)
      if (!text.includes(key) && !key.includes(text)) return false
      return Math.min(text.length, key.length) / Math.max(text.length, key.length) >= 0.6
    })
    if (hits.length === 1) return hits[0]
  }
  return null
}

/** The index just past the `{...}` that starts at `open`, or -1 if it never closes. */
function closingBrace(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '\\') {
      i++
      continue
    }
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return i
  }
  return -1
}

/**
 * Keep the words, lose the markup the sanitizer doesn't allow: a macro it
 * doesn't know becomes its last argument, which is where a wrapper like
 * `\textcolor{red}{Kubernetes}` keeps the actual text.
 */
function dropUnknownMacros(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    if (text[i] !== '\\') {
      out += text[i]
      i++
      continue
    }
    const name = /^\\([a-zA-Z]+)/.exec(text.slice(i))
    if (!name) {
      // An escaped character such as \% or a \\ line break, not a macro.
      out += text.slice(i, i + 2)
      i += 2
      continue
    }

    let cursor = i + name[0].length
    const args: string[] = []
    for (;;) {
      const open = cursor + (/^\s*/.exec(text.slice(cursor)) as RegExpExecArray)[0].length
      if (text[open] !== '{') break
      const close = closingBrace(text, open)
      if (close < 0) break
      args.push(text.slice(open + 1, close))
      cursor = close + 1
    }

    if (ALLOWED_MACROS.has(name[1])) {
      out += '\\' + name[1] + args.map((arg) => `{${dropUnknownMacros(arg)}}`).join('')
    } else if (args.length > 0) {
      out += dropUnknownMacros(args[args.length - 1])
    }
    i = cursor
  }
  return out
}

/** Close a brace the model forgot, or drop one it added. */
function balanceBraces(text: string): string {
  let depth = 0
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '\\') {
      out += text.slice(i, i + 2)
      i++
      continue
    }
    if (char === '}' && depth === 0) continue
    if (char === '{') depth++
    if (char === '}') depth--
    out += char
  }
  return out + '}'.repeat(depth)
}

type Proposal = { ok: true; text: string } | { ok: false; reason: string }

/**
 * A proposal the sanitizer accepts. Markup it merely doesn't know, and a stray
 * brace, are repaired; anything that could read a file or reach the shell at
 * compile time is refused outright, never repaired.
 */
function usableProposal(proposed: string): Proposal {
  const asWritten = sanitizeLatexFragment(proposed)
  if (asWritten.ok) return { ok: true, text: proposed }
  if (asWritten.problems.some((problem) => /not permitted/.test(problem))) {
    return { ok: false, reason: asWritten.problems.join('; ') }
  }

  const repaired = balanceBraces(dropUnknownMacros(proposed))
  const afterRepair = sanitizeLatexFragment(repaired)
  return afterRepair.ok ? { ok: true, text: repaired } : { ok: false, reason: afterRepair.problems.join('; ') }
}

function withinLength(source: string, proposed: string, length: LengthLimits): boolean {
  return (
    proposed.length - source.length <= length.maxGrowth(source.length) &&
    proposed.length >= length.minLength(source.length)
  )
}

export interface ResolveOptions {
  /** Sections a change may never be moved onto, however closely it reads: the header and anything holding facts. */
  frozen?: (section: ResumeSection) => boolean
}

export function resolveChanges(
  resume: ParsedResume,
  changes: ResumeChange[],
  length: LengthLimits,
  options: ResolveOptions = {}
): ResolveResult {
  const lines = sourceLines(resume, options.frozen)
  const indexes = indexLines(lines)

  const kept: ResumeChange[] = []
  const dropped: ResolveResult['dropped'] = []
  /** Source line text → where its change sits in `kept`. */
  const byLine = new Map<string, number>()
  /** How a kept change currently reads → where it sits, so a rewrite of it is recognised. */
  const byProposal = new Map<string, number>()

  for (const change of changes) {
    const line = locateLine(indexes, lines, change.original)
    const chained = line ? undefined : byProposal.get(proposalKey(change.original))
    if (!line && chained === undefined) {
      dropped.push({ change, reason: 'it quotes text that is not in the resume' })
      continue
    }

    const proposal = usableProposal(change.proposed)
    if (!proposal.ok) {
      dropped.push({ change, reason: proposal.reason })
      continue
    }

    const existing = line ? byLine.get(line.text) : chained
    if (existing !== undefined) {
      // A second rewrite of the same line: the newest wording wins, as long as it still fits the real line.
      const base = kept[existing]
      if (!withinLength(base.original, proposal.text, length)) {
        dropped.push({ change, reason: 'the rewrite no longer fits the length rules for that line' })
        continue
      }
      kept[existing] = { ...base, proposed: proposal.text, reason: change.reason || base.reason, type: change.type }
      byProposal.delete(proposalKey(base.proposed))
      byProposal.set(proposalKey(proposal.text), existing)
      continue
    }

    const source = line as SourceLine
    kept.push({
      ...change,
      original: source.text,
      proposed: proposal.text,
      sectionId: source.section.id,
      sectionTitle: source.section.title,
    })
    byLine.set(source.text, kept.length - 1)
    byProposal.set(proposalKey(proposal.text), kept.length - 1)
  }

  return { changes: kept, dropped }
}
