import type { Role } from '@/lib/access'

/**
 * Why a model call failed, sorted by what can be done about it, and what the
 * person who asked is told.
 *
 * Client-safe and free of any provider's SDK: each transport (lib/claude.ts,
 * lib/ai-provider.ts) sorts its own errors into these kinds, and everything
 * after it reads only the kind, never the wording.
 */

/**
 * - busy: overloaded, rate-limited, a server error, or the connection dropped.
 *   Trying again shortly works.
 * - setup: the key, model, credit balance or request was refused. Only whoever
 *   set up the AI can fix it.
 * - refused: the model declined the request.
 * - unusable: it answered, but the answer failed Chills's checks.
 * - slow: it ran out of time.
 */
export const AI_FAILURE_KINDS = ['busy', 'setup', 'refused', 'unusable', 'slow', 'unknown'] as const

export type AiFailureKind = (typeof AI_FAILURE_KINDS)[number]

export class AiCallError extends Error {
  constructor(
    message: string,
    readonly kind: AiFailureKind,
    /**
     * Worth another attempt from withRetries: a failure the provider's own
     * client doesn't retry, such as an overload reported partway through a
     * streamed answer.
     */
    readonly retry = false
  ) {
    super(message)
    this.name = 'AiCallError'
  }
}

export function failureKind(err: unknown): AiFailureKind {
  return err instanceof AiCallError ? err.kind : 'unknown'
}

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * Failures that are no fault of the request or its answer. Whatever the request
 * took from the account's allowances, the daily cap included, is given back.
 */
export const PROVIDER_FAULTS: ReadonlySet<AiFailureKind> = new Set<AiFailureKind>(['busy', 'setup', 'unknown'])

const NOTICES: Record<AiFailureKind, string> = {
  busy: "Chills AI is busy right now. Wait a minute and try again; this one wasn't counted.",
  setup: "Chills AI isn't available right now, so this one wasn't counted. Please try again later.",
  refused: 'The AI declined this request. Try rewording it.',
  unusable: "The AI's answer didn't pass Chills's checks, so nothing was saved. Please try again.",
  slow: 'The AI took too long, so this was stopped. Please try again.',
  unknown: "The AI couldn't finish this just now. It wasn't counted, so please try again.",
}

/**
 * What a failed AI request tells the person who made it. The owner sees the
 * provider's own words, which name the key or model to fix. Everyone else
 * didn't choose the AI and can't change it, so they get what they can act on;
 * the details go to the server log and the owner's AI settings.
 */
export function failureNotice(role: Role, err: unknown): string {
  return role === 'owner' ? errorText(err) : NOTICES[failureKind(err)]
}

/** Pauses before each further attempt, after a failure marked `retry`. */
export const RETRY_PAUSES_MS = [1_000, 4_000]

/** No further attempt starts this long after the first one did: the route's own time limit needs the rest. */
export const RETRY_WINDOW_MS = 60_000

/**
 * Make one model call, and make it again after a short pause when it fails in
 * a way marked worth retrying. The provider clients retry a refused request
 * themselves, but not one that fails after the answer has started arriving.
 */
export async function withRetries<T>(label: string, call: () => Promise<T>, pauses: number[] = RETRY_PAUSES_MS): Promise<T> {
  const startedAt = Date.now()
  for (let attempt = 0; ; attempt++) {
    try {
      return await call()
    } catch (err) {
      const pause = pauses[attempt]
      const retry = err instanceof AiCallError && err.retry
      if (!retry || pause === undefined || Date.now() - startedAt > RETRY_WINDOW_MS) throw err
      // Spread out, so requests that failed together don't all come back at once.
      const wait = Math.round(pause * (0.75 + Math.random() * 0.5))
      console.warn(`[${label}] Trying again in ${(wait / 1000).toFixed(1)} s (${attempt + 2} of ${pauses.length + 1}) after: ${errorText(err)}`)
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
}
