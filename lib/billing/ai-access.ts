import { NextResponse } from 'next/server'
import { AIProvider } from '@/types/resume'
import type { Role } from '@/lib/access'
import { resolveApiKey } from '@/lib/ai-provider'
import { PlatformAiConfig, platformAiConfig } from '@/lib/billing/config'
import { DAILY_AI_REQUESTS } from '@/lib/billing/quota'
import { releaseReservation, Reservation, reserveImport, reserveRun, takeDailyAiRequest } from '@/lib/billing/store'
import { BILLING_CODES } from '@/lib/billing/types'
import { ensureUser } from '@/lib/db/resumes'

interface Account {
  role: Role
  userId: string
  email: string
  userName: string
}

export interface AiRequest {
  provider?: AIProvider
  apiKey?: string
  model?: string
  /** Run on ResMod AI, paid for with included runs, instead of the account's own key. */
  usePlatform?: boolean
}

export type AiChoice =
  | { ok: true; provider: AIProvider; apiKey: string; model: string | undefined; reservation: Reservation | null }
  | { ok: false; response: NextResponse }

function refuse(status: number, error: string, code?: string): AiChoice {
  return { ok: false, response: NextResponse.json(code ? { error, code } : { error }, { status }) }
}

const dailyLimitReached = () =>
  refuse(
    429,
    `You've reached today's limit of ${DAILY_AI_REQUESTS} AI requests. It starts again at midnight UTC.`,
    BILLING_CODES.dailyLimit
  )

/**
 * Which model an AI route runs on, and who pays for it.
 *
 * With `usePlatform`, a regular account runs on ResMod AI. A tailoring run takes
 * one included run and an import takes one from the month's import allowance,
 * before any model is called — pass the reservation to releaseReservation if the
 * work then fails. Without it, the account's own key is used and no run is
 * counted, and only the owner may fall back to the server's provider keys.
 *
 * Every request from a regular account also counts toward a daily cap, whichever
 * AI it uses. The owner is never counted or capped.
 */
export async function chooseAi(account: Account, request: AiRequest, meter: 'run' | 'import'): Promise<AiChoice> {
  let platform: PlatformAiConfig | null = null
  let own: { provider: AIProvider; apiKey: string } | null = null

  if (request.usePlatform) {
    platform = platformAiConfig()
    if (!platform) {
      return refuse(
        503,
        "ResMod AI isn't available right now. Use your own AI key from AI settings instead.",
        BILLING_CODES.platformUnavailable
      )
    }
  } else {
    if (!request.provider) return refuse(400, 'Choose an AI provider in AI settings.')
    try {
      const apiKey = resolveApiKey(request.provider, request.apiKey, { allowServerKey: account.role === 'owner' })
      own = { provider: request.provider, apiKey }
    } catch (err) {
      return refuse(400, err instanceof Error ? err.message : String(err))
    }
  }

  if (account.role === 'owner') {
    return platform
      ? { ok: true, ...platform, reservation: null }
      : { ok: true, provider: own!.provider, apiKey: own!.apiKey, model: request.model, reservation: null }
  }
  if (!account.userId) return refuse(401, 'Not authenticated')

  try {
    await ensureUser({ id: account.userId, email: account.email, name: account.userName || null })

    if (!platform) {
      if (!(await takeDailyAiRequest(account.userId))) return dailyLimitReached()
      return { ok: true, provider: own!.provider, apiKey: own!.apiKey, model: request.model, reservation: null }
    }

    // The run is taken first, so a request refused for want of runs doesn't also use up the day's cap.
    const reservation = meter === 'run' ? await reserveRun(account.userId) : await reserveImport(account.userId)
    if (!reservation) {
      return meter === 'run'
        ? refuse(
            402,
            "You've used all your included runs. Get more on the Billing page, or use your own AI key.",
            BILLING_CODES.quotaExhausted
          )
        : refuse(
            429,
            "You've reached this month's limit for imports on ResMod AI. Use your own AI key, or wait until next month.",
            BILLING_CODES.importLimit
          )
    }
    if (!(await takeDailyAiRequest(account.userId))) {
      await releaseReservation(reservation)
      return dailyLimitReached()
    }
    return { ok: true, ...platform, reservation }
  } catch (err) {
    console.error('[billing] could not check usage:', err instanceof Error ? err.message : err)
    return refuse(503, 'Your usage could not be checked right now. Try again in a moment.')
  }
}
