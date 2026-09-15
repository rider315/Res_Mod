import { NextResponse } from 'next/server'
import { AIProvider } from '@/types/resume'
import type { Role } from '@/lib/access'
import { resolveApiKey } from '@/lib/ai-provider'
import { platformAiConfig } from '@/lib/billing/config'
import { Reservation, reserveImport, reserveRun } from '@/lib/billing/store'
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

/**
 * Which model an AI route runs on, and who pays for it.
 *
 * With `usePlatform`, a regular account runs on ResMod AI. A tailoring run takes
 * one included run and an import takes one from the month's import allowance,
 * before any model is called — pass the reservation to releaseReservation if the
 * work then fails. Without it, the account's own key is used and nothing is
 * counted, and only the owner may fall back to the server's provider keys. The
 * owner is never counted.
 */
export async function chooseAi(account: Account, request: AiRequest, meter: 'run' | 'import'): Promise<AiChoice> {
  if (!request.usePlatform) {
    if (!request.provider) return refuse(400, 'Choose an AI provider in AI settings.')
    try {
      const apiKey = resolveApiKey(request.provider, request.apiKey, { allowServerKey: account.role === 'owner' })
      return { ok: true, provider: request.provider, apiKey, model: request.model, reservation: null }
    } catch (err) {
      return refuse(400, err instanceof Error ? err.message : String(err))
    }
  }

  const platform = platformAiConfig()
  if (!platform) {
    return refuse(
      503,
      "ResMod AI isn't available right now. Use your own AI key from AI settings instead.",
      BILLING_CODES.platformUnavailable
    )
  }
  if (account.role === 'owner') return { ok: true, ...platform, reservation: null }
  if (!account.userId) return refuse(401, 'Not authenticated')

  let reservation: Reservation | null
  try {
    await ensureUser({ id: account.userId, email: account.email, name: account.userName || null })
    reservation = meter === 'run' ? await reserveRun(account.userId) : await reserveImport(account.userId)
  } catch (err) {
    console.error('[billing] could not check included runs:', err instanceof Error ? err.message : err)
    return refuse(503, 'Your included runs could not be checked right now. Try again in a moment.')
  }

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
  return { ok: true, ...platform, reservation }
}
