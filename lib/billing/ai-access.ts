import { NextResponse } from 'next/server'
import { AIProvider } from '@/types/resume'
import type { Role } from '@/lib/access'
import { resolveApiKey } from '@/lib/ai-provider'
import { AiFailureKind, errorText, failureKind, failureNotice, PROVIDER_FAULTS } from '@/lib/ai-errors'
import type { PlatformAiConfig } from '@/lib/billing/config'
import { getPlatformAi, recordPlatformAiFailure } from '@/lib/billing/platform-ai'
import { DAILY_AI_REQUESTS } from '@/lib/billing/quota'
import {
  releaseReservation,
  Reservation,
  reserveEmailDraft,
  reserveImport,
  reserveRun,
  takeDailyAiRequest,
} from '@/lib/billing/store'
import { BILLING_CODES } from '@/lib/billing/types'
import { ensureUser } from '@/lib/db/resumes'

interface Account {
  role: Role
  userId: string
  email: string
  userName: string
}

export interface AiRequest {
  /** The owner's own AI settings. Ignored for everyone else. */
  provider?: AIProvider
  apiKey?: string
  model?: string
  /** The owner only: run on Chills AI, to see what users get. Everyone else always does. */
  usePlatform?: boolean
}

export interface AiGrant {
  ok: true
  provider: AIProvider
  apiKey: string
  model: string | undefined
  /** The tailoring, import or recruiter email this request took; null when it took none. */
  reservation: Reservation | null
  /** Its place in the account's daily cap; null for the owner, who has none. */
  daily: Reservation | null
  /** It runs on Chills AI, so a failure is noted for the owner (settleAiFailure). */
  onPlatform: boolean
}

export type AiChoice = AiGrant | { ok: false; response: NextResponse }

function refuse(status: number, error: string, code?: string): AiChoice {
  return { ok: false, response: NextResponse.json(code ? { error, code } : { error }, { status }) }
}

const dailyLimitReached = () =>
  refuse(
    429,
    `You've reached today's limit of ${DAILY_AI_REQUESTS} AI requests. It starts again at midnight UTC.`,
    BILLING_CODES.dailyLimit
  )

const unavailable = () =>
  refuse(
    503,
    "Chills's AI isn't available right now. Please try again later.",
    BILLING_CODES.platformUnavailable
  )

/**
 * What a request spends: a tailoring, an import or a recruiter email from the
 * month's allowance, or nothing beyond the daily cap (finding keywords, writing
 * a cover letter, reading a recruiter's reply).
 */
export type AiMeter = 'run' | 'import' | 'draft' | 'free'

/**
 * Which model an AI route runs on, and who pays for it.
 *
 * The owner uses their own AI settings, falling back to the server's provider
 * keys, or Chills AI with `usePlatform`, and is never counted or capped.
 *
 * Everyone else always runs on Chills AI: the model the owner chose in AI
 * settings. A provider or key in their request is ignored. A tailoring takes one
 * run (Pro, then the free tailorings, then credits), and an import or a recruiter
 * email takes one from that month's allowance, before any model is called. Every
 * request also counts toward a daily cap. If the work then fails, pass the grant
 * to settleAiFailure, which gives back what is owed.
 */
export async function chooseAi(account: Account, request: AiRequest, meter: AiMeter): Promise<AiChoice> {
  if (account.role === 'owner') return ownerAi(request)
  if (!account.userId) return refuse(401, 'Not authenticated')

  const platform = await getPlatformAi()
  if (!platform) return unavailable()

  try {
    await ensureUser({ id: account.userId, email: account.email, name: account.userName || null })

    // The run is taken first, so a request refused for want of runs doesn't also use up the day's cap.
    let reservation: Reservation | null = null
    if (meter === 'run') {
      reservation = await reserveRun(account.userId)
      if (!reservation) {
        return refuse(
          402,
          'You have no tailorings left. Get Pro or a credit pack on the Plans page to keep tailoring.',
          BILLING_CODES.quotaExhausted
        )
      }
    } else if (meter === 'import') {
      reservation = await reserveImport(account.userId)
      if (!reservation) {
        return refuse(
          429,
          "You've reached this month's limit for importing resumes. It starts again next month.",
          BILLING_CODES.importLimit
        )
      }
    } else if (meter === 'draft') {
      reservation = await reserveEmailDraft(account.userId)
      if (!reservation) {
        return refuse(
          429,
          "You've used this month's AI-written recruiter emails. Pro or a credit pack raises the limit, and it starts again next month. You can still write and send emails yourself.",
          BILLING_CODES.draftLimit
        )
      }
    }
    const daily = await takeDailyAiRequest(account.userId)
    if (!daily) {
      if (reservation) await releaseReservation(reservation)
      return dailyLimitReached()
    }
    return { ok: true, ...platform, reservation, daily, onPlatform: true }
  } catch (err) {
    console.error('[billing] could not check usage:', err instanceof Error ? err.message : err)
    return refuse(503, 'Your usage could not be checked right now. Try again in a moment.')
  }
}

/** How each kind of failure (lib/ai-errors.ts) answers over HTTP. */
const FAILURE_STATUS: Record<AiFailureKind, number> = {
  busy: 503,
  setup: 503,
  refused: 422,
  unusable: 502,
  slow: 504,
  unknown: 502,
}

export interface AiFailure {
  kind: AiFailureKind
  /** What to tell the person who asked: the provider's own words for the owner, a plain notice for everyone else. */
  message: string
  status: number
}

/**
 * Everything a route does when its AI work fails. It gives back the tailoring,
 * import or email the request took, and its place in the daily cap too when the
 * fault was the provider's rather than the answer's. It notes a failure on
 * Chills AI for the owner's AI settings, since the person who hit it sees only a
 * notice. Then it says what happened, in words that person can act on.
 */
export async function settleAiFailure(feature: string, role: Role, ai: AiGrant, err: unknown): Promise<AiFailure> {
  const kind = failureKind(err)
  const detail = errorText(err)
  console.error(`[${feature}] ${kind}:`, detail)
  if (ai.reservation) await releaseReservation(ai.reservation)
  if (ai.daily && PROVIDER_FAULTS.has(kind)) await releaseReservation(ai.daily)
  if (ai.onPlatform) await recordPlatformAiFailure({ feature, kind, message: detail })
  return { kind, message: failureNotice(role, err), status: FAILURE_STATUS[kind] }
}

async function ownerAi(request: AiRequest): Promise<AiChoice> {
  if (request.usePlatform) {
    const platform: PlatformAiConfig | null = await getPlatformAi()
    return platform ? { ok: true, ...platform, reservation: null, daily: null, onPlatform: true } : unavailable()
  }
  if (!request.provider) return refuse(400, 'Choose an AI provider in AI settings.')
  try {
    const apiKey = resolveApiKey(request.provider, request.apiKey, { allowServerKey: true })
    return { ok: true, provider: request.provider, apiKey, model: request.model, reservation: null, daily: null, onPlatform: false }
  } catch (err) {
    return refuse(400, err instanceof Error ? err.message : String(err))
  }
}
