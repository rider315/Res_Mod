import { ResumeChange } from '@/types/resume'

/**
 * Turn whatever the model returned into well-formed ResumeChange objects.
 *
 * Models routinely omit fields or invent values outside the schema, so nothing
 * here may assume a field exists or has the right type — a missing "proposed"
 * used to crash the whole request with a TypeError.
 */

const CHANGE_TYPES: ResumeChange['type'][] = [
  'rewrite',
  'add_keywords',
  'improve_clarity',
  'action_verb',
]

/** Reject rewrites that drift too far from the original length — see the prompts' length rule. */
const MAX_CHAR_DIFF = 8

export interface NormalizeResult {
  changes: ResumeChange[]
  /** Entries thrown away because they were malformed or too long/short. */
  skipped: number
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** The model often invents type values ("keyword_injection"); fall back rather than render a blank badge. */
function asChangeType(value: unknown): ResumeChange['type'] {
  return CHANGE_TYPES.includes(value as ResumeChange['type'])
    ? (value as ResumeChange['type'])
    : 'rewrite'
}

export function normalizeChanges(
  rawChanges: unknown,
  opts: { idPrefix: string; logLabel: string; withBoldKeywords?: boolean }
): NormalizeResult {
  if (!Array.isArray(rawChanges)) return { changes: [], skipped: 0 }

  const changes: ResumeChange[] = []
  let skipped = 0
  const stamp = Date.now()

  rawChanges.forEach((entry: unknown, i: number) => {
    if (!entry || typeof entry !== 'object') {
      skipped++
      return
    }
    const c = entry as Record<string, unknown>

    // Both sides of the replacement must be real text or the change is unusable.
    const original = asString(c.original)
    const proposed = asString(c.proposed)
    if (!original.trim() || !proposed.trim()) {
      console.warn(`[${opts.logLabel}] Skipped a change missing original/proposed text`)
      skipped++
      return
    }

    const diff = Math.abs(proposed.length - original.length)
    if (diff > MAX_CHAR_DIFF) {
      console.warn(
        `[${opts.logLabel}] Rejected change (±${diff} chars): "${original.slice(0, 50)}..." → "${proposed.slice(0, 50)}..."`
      )
      skipped++
      return
    }

    const change: ResumeChange = {
      id: `${opts.idPrefix}_${i}_${stamp}`,
      sectionId: asString(c.sectionId),
      sectionTitle: asString(c.sectionTitle, 'Other'),
      original,
      proposed,
      reason: asString(c.reason),
      type: asChangeType(c.type),
      approved: null,
    }

    if (opts.withBoldKeywords) {
      const keywords = Array.isArray(c.boldKeywords) ? c.boldKeywords : []
      change.boldKeywords = keywords.filter(
        (kw: unknown): kw is string => typeof kw === 'string' && kw.length > 0 && proposed.includes(kw)
      )
    }

    changes.push(change)
  })

  return { changes, skipped }
}

/** Defensive coercion for the top-level result fields, which models also get wrong. */
export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v: unknown): v is string => typeof v === 'string')
}
