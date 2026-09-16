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
  /** False when the provider reported nothing and the counts come from the text. */
  reported: boolean
}

export interface AiUsage {
  calls: number
  inputTokens: number
  outputTokens: number
  /** How many of the calls reported real token counts. */
  reportedCalls: number
}

export const emptyUsage = (): AiUsage => ({ calls: 0, inputTokens: 0, outputTokens: 0, reportedCalls: 0 })

export function addCall(total: AiUsage, call: CallUsage): AiUsage {
  return {
    calls: total.calls + 1,
    inputTokens: total.inputTokens + Math.max(0, Math.round(call.inputTokens)),
    outputTokens: total.outputTokens + Math.max(0, Math.round(call.outputTokens)),
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

/** A provider's own numbers, whatever shape they arrived in. */
export function reportedCall(input: unknown, output: unknown): CallUsage | null {
  const inputTokens = Number(input)
  const outputTokens = Number(output)
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null
  if (inputTokens <= 0 && outputTokens <= 0) return null
  return { inputTokens, outputTokens, reported: true }
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
  return (
    `${usage.calls} model call${usage.calls === 1 ? '' : 's'} · ` +
    `${about}${formatTokens(usage.inputTokens)} in / ${formatTokens(usage.outputTokens)} out`
  )
}
