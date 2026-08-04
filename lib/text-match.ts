/**
 * Locating model-quoted text inside a Google Doc.
 *
 * The Docs `replaceAllText` request is an exact substring match, but a model
 * almost never reproduces document text byte-for-byte. Google Docs silently
 * substitutes characters as you type — straight quotes become curly ones,
 * hyphens become en-dashes, spaces become non-breaking spaces, and soft line
 * breaks are stored as vertical tabs — while the model quotes back plain ASCII.
 * Matching naively drops those changes on the floor.
 *
 * So instead of trusting the model's quote, we normalize both sides, find the
 * match, and recover the *actual* document substring to hand to the API.
 *
 * Pure and client-safe so it can be unit-tested without the Docs API.
 */

/** Characters Google Docs substitutes, folded back to their ASCII equivalent. */
const CHAR_FOLDS: Record<string, string> = {
  // Single quotes / apostrophes
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'", '´': "'",
  // Double quotes
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"',
  // Dashes and minus signs
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-',
  // Spaces that aren't U+0020
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '　': ' ',
  // Google Docs stores a soft line break (Shift+Enter) as a vertical tab
  '': ' ',
  '\t': ' ',
}

/** Invisible characters that should simply vanish before comparing. */
const CHAR_DROPS = new Set(['​', '‌', '‍', '﻿', '­'])

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '' || ch === '\f'
}

interface Normalized {
  text: string
  /** For each normalized char, where its source run starts. */
  start: number[]
  /** For each normalized char, where its source run ends (exclusive). */
  end: number[]
}

/**
 * Fold substituted characters and collapse whitespace runs, keeping a map back
 * to the source so a match can be turned into the original document substring.
 */
export function normalizeForMatch(source: string): Normalized {
  const chars: string[] = []
  const start: number[] = []
  const end: number[] = []

  let i = 0
  while (i < source.length) {
    const ch = source[i]

    if (CHAR_DROPS.has(ch)) {
      i++
      continue
    }

    if (isWhitespace(ch) || CHAR_FOLDS[ch] === ' ') {
      // Collapse the whole run of whitespace into a single space.
      const runStart = i
      while (i < source.length && (isWhitespace(source[i]) || CHAR_FOLDS[source[i]] === ' ' || CHAR_DROPS.has(source[i]))) {
        i++
      }
      chars.push(' ')
      start.push(runStart)
      end.push(i)
      continue
    }

    const folded = CHAR_FOLDS[ch] ?? ch
    // A fold can expand to several characters; they all map to the same source span.
    for (const f of folded) {
      chars.push(f)
      start.push(i)
      end.push(i + 1)
    }
    i++
  }

  return { text: chars.join(''), start, end }
}

export interface MatchResult {
  /** The exact substring as it appears in the document — safe to send to the API. */
  actual: string
  /** How the match was found, for logging. */
  how: 'exact' | 'normalized' | 'case-insensitive'
  /** Number of times it occurs in the document. */
  occurrences: number
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    count++
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return count
}

/**
 * Find `wanted` inside `documentText`, tolerating the character substitutions
 * above. Returns the true document substring, or null if it genuinely isn't there.
 */
export function findInDocument(documentText: string, wanted: string): MatchResult | null {
  const trimmed = wanted.trim()
  if (!trimmed) return null

  // Fast path: the model quoted it perfectly.
  if (documentText.includes(trimmed)) {
    return { actual: trimmed, how: 'exact', occurrences: countOccurrences(documentText, trimmed) }
  }

  const doc = normalizeForMatch(documentText)
  const want = normalizeForMatch(trimmed)
  if (!want.text) return null

  const recover = (matchIndex: number): string => {
    const from = doc.start[matchIndex]
    const to = doc.end[matchIndex + want.text.length - 1]
    return documentText.slice(from, to)
  }

  const idx = doc.text.indexOf(want.text)
  if (idx !== -1) {
    return {
      actual: recover(idx),
      how: 'normalized',
      occurrences: countOccurrences(doc.text, want.text),
    }
  }

  // Last resort: the model changed capitalisation while quoting.
  const lowerIdx = doc.text.toLowerCase().indexOf(want.text.toLowerCase())
  if (lowerIdx !== -1) {
    return {
      actual: recover(lowerIdx),
      how: 'case-insensitive',
      occurrences: countOccurrences(doc.text.toLowerCase(), want.text.toLowerCase()),
    }
  }

  return null
}

export interface ResolvableChange {
  original: string
  proposed: string
  sectionTitle?: string
  boldKeywords?: string[]
}

export interface ResolvedChange extends ResolvableChange {
  /** The document-accurate text to search for. */
  resolvedOriginal: string
  how: MatchResult['how']
  occurrences: number
}

export interface ResolveReport {
  resolved: ResolvedChange[]
  /** Changes whose text genuinely isn't in the document. */
  notFound: ResolvableChange[]
  /** Changes dropped because another change rewrites overlapping text. */
  overlapping: ResolvableChange[]
}

/**
 * Resolve every change against the real document text and drop the ones that
 * would collide.
 *
 * Overlap matters because `replaceAllText` edits are applied in sequence: if one
 * change's text sits inside another's, whichever runs first destroys the other's
 * match. Keeping the longer (more specific) edit is the better trade.
 */
export function resolveChanges(documentText: string, changes: ResolvableChange[]): ResolveReport {
  const resolved: ResolvedChange[] = []
  const notFound: ResolvableChange[] = []
  const overlapping: ResolvableChange[] = []

  // Longest first so the more specific edit wins any overlap.
  const ordered = [...changes].sort((a, b) => b.original.length - a.original.length)

  for (const change of ordered) {
    const match = findInDocument(documentText, change.original)
    if (!match) {
      notFound.push(change)
      continue
    }

    const clashes = resolved.some(
      (kept) =>
        kept.resolvedOriginal.includes(match.actual) || match.actual.includes(kept.resolvedOriginal)
    )
    if (clashes) {
      overlapping.push(change)
      continue
    }

    resolved.push({
      ...change,
      resolvedOriginal: match.actual,
      how: match.how,
      occurrences: match.occurrences,
    })
  }

  return { resolved, notFound, overlapping }
}
