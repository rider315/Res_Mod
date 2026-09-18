import { estimateTokens } from '@/lib/json-repair'

/**
 * What a tailoring run is spending on AI, as it spends it.
 *
 * A run is several model calls — keywords, the rewrite, then the top-up passes —
 * and the user watching the screen has no way of telling how much that costs on
 * their own key. Every call reports what it used, the run adds them up, and the
 * meter shows the total as it grows.
 *
 * Most providers return token counts with the response. The ones that don't get
 * an estimate from the text, marked as such, so a number is never presented as
 * measured when it isn't.
 *
 * Client-safe.
 */

export interface CallUsage {
  inputTokens: number
  outputTokens: number
  /**
   * Of `inputTokens`, how many the provider served from its prompt cache — a
   * tenth of the price of reading them again. A run repeats the job description
   * and the rules in every pass, so after the first call most of the input is
   * this (lib/claude.ts).
   */
  cachedInputTokens?: number
  /** False when the provider reported nothing and the counts come from the text. */
  reported: boolean
}

export interface AiUsage {
  calls: number
  inputTokens: number
  outputTokens: number
  /** Of `inputTokens`, how many came back from the provider's prompt cache. */
  cachedInputTokens: number
  /** How many of the calls reported real token counts. */
  reportedCalls: number
}

export const emptyUsage = (): AiUsage => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  reportedCalls: 0,
})

const whole = (value: unknown): number => {
  const count = Math.round(Number(value))
  return Number.isFinite(count) ? Math.max(0, count) : 0
}

export function addCall(total: AiUsage, call: CallUsage): AiUsage {
  return {
    calls: total.calls + 1,
    inputTokens: total.inputTokens + whole(call.inputTokens),
    outputTokens: total.outputTokens + whole(call.outputTokens),
    cachedInputTokens: total.cachedInputTokens + whole(call.cachedInputTokens),
    reportedCalls: total.reportedCalls + (call.reported ? 1 : 0),
  }
}

export const totalTokens = (usage: AiUsage): number => usage.inputTokens + usage.outputTokens

/** True when nothing in the total was measured, so the meter should say "about". */
export const isEstimated = (usage: AiUsage): boolean => usage.reportedCalls < usage.calls

/** Counts from the text of a call, for providers that report none. */
export const estimateCall = (input: string, output: string): CallUsage => ({
  inputTokens: estimateTokens(input),
  outputTokens: estimateTokens(output),
  reported: false,
})

/**
 * A provider's own numbers, whatever shape they arrived in. `cached` is the part
 * of the input that came from the prompt cache; it is counted inside
 * `inputTokens`, not on top of it.
 */
export function reportedCall(input: unknown, output: unknown, cached: unknown = 0): CallUsage | null {
  const inputTokens = Number(input)
  const outputTokens = Number(output)
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null
  if (inputTokens <= 0 && outputTokens <= 0) return null
  return { inputTokens, outputTokens, cachedInputTokens: whole(cached), reported: true }
}

export function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`
  return `${(count / 1_000_000).toFixed(1)}M`
}

/** A one-line summary for the review screen and the run log. */
export function describeUsage(usage: AiUsage): string {
  const about = isEstimated(usage) ? 'about ' : ''
  const reused = cachedShare(usage)
  return (
    `${usage.calls} model call${usage.calls === 1 ? '' : 's'} · ` +
    `${about}${formatTokens(usage.inputTokens)} in / ${formatTokens(usage.outputTokens)} out` +
    (reused > 0 ? ` · ${formatTokens(reused)} of the input reused from cache` : '')
  )
}

/**
 * How much of the input the provider did not have to read again. Tolerant of a
 * total that arrived over the wire before this field existed.
 */
export const cachedShare = (usage: AiUsage): number => Math.min(whole(usage.cachedInputTokens), usage.inputTokens)
