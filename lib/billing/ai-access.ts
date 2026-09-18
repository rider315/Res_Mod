import { NextResponse } from 'next/server'
import { AIProvider } from '@/types/resume'
import type { Role } from '@/lib/access'
import { resolveApiKey } from '@/lib/ai-provider'
import { AiFailureKind, errorText, failureKind, failureNotice, PROVIDER_FAULTS } from '@/lib/ai-errors'
import type { PlatformAiConfig } from '@/lib/billing/config'
import { getPlatformAi, recordPlatformAiFailure } from '@/lib/billing/platform-ai'
import { DAILY_AI_REQUESTS } from '@/lib/billing/quota'
import {
  ApplyRefusal,
  releaseReservation,
  Reservation,
  reserveApply,
  reserveEmailDraft,
  reserveImport,
  reserveRun,
  takeDailyAiRequest,
} from '@/lib/billing/store'
import { APPLY_TIER, TIERS } from '@/lib/billing/plans'
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
  /**
   * What this request took: a tailoring, an import, a recruiter email — or, for
   * a complete application, both an application and the run it spends. Empty
   * when it took nothing, as for the owner.
   */
  reservations: Reservation[]
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
export type AiMeter = 'run' | 'import' | 'draft' | 'apply' | 'free'

/** What each way of running out of applications says, and the code the screen acts on. */
function applyRefused(reason: ApplyRefusal): AiChoice {
  const premium = TIERS[APPLY_TIER]
  if (reason === 'tier') {
    return refuse(
      402,
      `Complete applications come with ${premium.label}: ${premium.appliesPerCycle} a month, each reading the posting, ` +
        'tailoring your resume to it and writing the recruiter email from that same reading.',
      BILLING_CODES.applyTier
    )
  }
  if (reason === 'applies') {
    return refuse(
      402,
      `You've used this month's ${premium.appliesPerCycle} complete applications. They start again next cycle; ` +
        'you can still tailor a resume and write the email separately.',
      BILLING_CODES.applyLimit
    )
  }
  return refuse(
    402,
    'You have no tailorings left, and a complete application spends one. Get a credit pack on the Plans page.',
    BILLING_CODES.quotaExhausted
  )
}

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
export async function chooseAi(account: Account, request: AiRequest, meters: AiMeter | AiMeter[]): Promise<AiChoice> {
  if (account.role === 'owner') return ownerAi(request)
  if (!account.userId) return refuse(401, 'Not authenticated')

  const platform = await getPlatformAi()
  if (!platform) return unavailable()

  try {
    await ensureUser({ id: account.userId, email: account.email, name: account.userName || null })

    // Everything is taken before the first model call, and a request that can't
    // have all of it gives back whatever it already took: one job that writes an
    // email from a resume it tailored first spends both, or neither.
    const reservations: Reservation[] = []
    const giveBack = async () => {
      for (const taken of reservations) await releaseReservation(taken)
    }
    for (const meter of [meters].flat()) {
      const refusal = await takeOne(account.userId, meter, reservations)
      if (refusal) {
        await giveBack()
        return refusal
      }
    }

    const daily = await takeDailyAiRequest(account.userId)
    if (!daily) {
      await giveBack()
      return dailyLimitReached()
    }
    return { ok: true, ...platform, reservations, daily, onPlatform: true }
  } catch (err) {
    console.error('[billing] could not check usage:', err instanceof Error ? err.message : err)
    return refuse(503, 'Your usage could not be checked right now. Try again in a moment.')
  }
}

/** Take what one meter costs, pushing it onto `into`. Returns the refusal when there is none left. */
async function takeOne(userId: string, meter: AiMeter, into: Reservation[]): Promise<AiChoice | null> {
  if (meter === 'free') return null

  if (meter === 'apply') {
    const application = await reserveApply(userId)
    if (!application.ok) return applyRefused(application.reason)
    into.push(...application.reservations)
    return null
  }

  const taken =
    meter === 'run'
      ? await reserveRun(userId)
      : meter === 'import'
        ? await reserveImport(userId)
        : await reserveEmailDraft(userId)
  if (taken) {
    into.push(taken)
    return null
  }

  if (meter === 'run') {
    return refuse(
      402,
      'You have no tailorings left. Get Pro or a credit pack on the Plans page to keep tailoring.',
      BILLING_CODES.quotaExhausted
    )
  }
  if (meter === 'import') {
    return refuse(429, "You've reached this month's limit for importing resumes. It starts again next month.", BILLING_CODES.importLimit)
  }
  return refuse(
    429,
    "You've used this month's AI-written recruiter emails. Pro or a credit pack raises the limit, and it starts again next month. You can still write and send emails yourself.",
    BILLING_CODES.draftLimit
  )
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
 * Everything a route does when its AI work fails. It gives back everything the
 * request took — a tailoring, an import, an email, or an application and the run
 * it spent — and its place in the daily cap too when the fault was the
 * provider's rather than the answer's. It notes a failure on
 * Chills AI for the owner's AI settings, since the person who hit it sees only a
 * notice. Then it says what happened, in words that person can act on.
 */
export async function settleAiFailure(feature: string, role: Role, ai: AiGrant, err: unknown): Promise<AiFailure> {
  const kind = failureKind(err)
  const detail = errorText(err)
  console.error(`[${feature}] ${kind}:`, detail)
  for (const taken of ai.reservations) await releaseReservation(taken)
  if (ai.daily && PROVIDER_FAULTS.has(kind)) await releaseReservation(ai.daily)
  if (ai.onPlatform) await recordPlatformAiFailure({ feature, kind, message: detail })
  return { kind, message: failureNotice(role, err), status: FAILURE_STATUS[kind] }
}

async function ownerAi(request: AiRequest): Promise<AiChoice> {
  if (request.usePlatform) {
    const platform: PlatformAiConfig | null = await getPlatformAi()
    return platform ? { ok: true, ...platform, reservations: [], daily: null, onPlatform: true } : unavailable()
  }
  if (!request.provider) return refuse(400, 'Choose an AI provider in AI settings.')
  try {
    const apiKey = resolveApiKey(request.provider, request.apiKey, { allowServerKey: true })
    return { ok: true, provider: request.provider, apiKey, model: request.model, reservations: [], daily: null, onPlatform: false }
  } catch (err) {
    return refuse(400, err instanceof Error ? err.message : String(err))
  }
}
