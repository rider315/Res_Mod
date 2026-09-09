import { EditableSpan, stripMarkup } from '@/lib/latex/parse'

/**
 * Locating the span a model-proposed change refers to.
 *
 * A model almost never quotes source back byte-for-byte: it collapses the
 * indentation inside a macro argument, drops a LaTeX escape ("40\%" comes back
 * as "40%"), or quotes the *rendered* sentence with the \textbf{} markup gone.
 * Matching only on equality throws those rewrites away silently, which is how
 * the Google Docs version of this pipeline used to lose edits.
 *
 * Because every editable line is one whole macro argument, this is a
 * whole-string comparison rather than a substring hunt: normalize both sides at
 * progressively looser levels and take the first level that identifies exactly
 * one span.
 */

export type MatchHow =
  | 'exact'
  | 'whitespace'
  | 'unescaped'
  | 'visible'
  | 'visible-ci'
  | 'contains'

/** Collapse whitespace runs; the source indents macro arguments, models don't. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Fold LaTeX escapes back to the bare character the model probably typed. */
function unescape(s: string): string {
  return s
    .replace(/\\%/g, '%')
    .replace(/\\&/g, '&')
    .replace(/\\_/g, '_')
    .replace(/\\#/g, '#')
    .replace(/\\\$/g, '$')
}

/** The sentence as a human reads it, with all inline markup removed. */
export function visible(s: string): string {
  return collapse(stripMarkup(s))
}

const LEVELS: Array<{ how: MatchHow; key: (s: string) => string }> = [
  { how: 'exact', key: (s) => s },
  { how: 'whitespace', key: collapse },
  { how: 'unescaped', key: (s) => collapse(unescape(s)) },
  { how: 'visible', key: visible },
  { how: 'visible-ci', key: (s) => visible(s).toLowerCase() },
]

export interface SpanMatch {
  span: EditableSpan
  how: MatchHow
}

/**
 * Find the one span `wanted` refers to.
 *
 * Ambiguity is treated as failure: if two spans normalize identically at the
 * first level that matches at all, rewriting either one is a guess, and a wrong
 * guess silently rewrites the wrong bullet.
 */
export function findSpan(spans: EditableSpan[], wanted: string): SpanMatch | null {
  const target = wanted.trim()
  if (!target) return null

  for (const level of LEVELS) {
    const key = level.key(target)
    if (!key) continue
    const hits = spans.filter((s) => level.key(s.text) === key)
    if (hits.length === 1) return { span: hits[0], how: level.how }
    if (hits.length > 1) return null
  }

  // Last resort: the model quoted only part of the bullet, or padded it. Accept
  // containment only when the two are close enough in length that there is no
  // real doubt about which bullet was meant.
  const key = visible(target).toLowerCase()
  if (key.length >= 25) {
    const hits = spans.filter((s) => {
      const v = visible(s.text).toLowerCase()
      if (!v.includes(key) && !key.includes(v)) return false
      const ratio = Math.min(v.length, key.length) / Math.max(v.length, key.length)
      return ratio >= 0.6
    })
    if (hits.length === 1) return { span: hits[0], how: 'contains' }
  }

  return null
}
