import { NextResponse } from 'next/server'
import { AIProvider } from '@/types/resume'
import type { Role } from '@/lib/access'
import { resolveApiKey } from '@/lib/ai-provider'
import type { PlatformAiConfig } from '@/lib/billing/config'
import { getPlatformAi } from '@/lib/billing/platform-ai'
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
  /** The owner's own AI settings. Ignored for everyone else. */
  provider?: AIProvider
  apiKey?: string
  model?: string
  /** The owner only: run on ResMod AI, to see what users get. Everyone else always does. */
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

const unavailable = () =>
  refuse(
    503,
    "Importing and tailoring aren't available right now. Please try again later.",
    BILLING_CODES.platformUnavailable
  )

/**
 * Which model an AI route runs on, and who pays for it.
 *
 * The owner uses their own AI settings, falling back to the server's provider
 * keys, or ResMod AI with `usePlatform`, and is never counted or capped.
 *
 * Everyone else always runs on ResMod AI: the model the owner chose in AI
 * settings. A provider or key in their request is ignored. A tailoring takes one
 * run (Pro, then the free tailorings, then credits) and an import takes one from
 * the month's import allowance, before any model is called — pass the
 * reservation to releaseReservation if the work then fails. Every request also
 * counts toward a daily cap.
 */
export async function chooseAi(account: Account, request: AiRequest, meter: 'run' | 'import'): Promise<AiChoice> {
  if (account.role === 'owner') return ownerAi(request)
  if (!account.userId) return refuse(401, 'Not authenticated')

  const platform = await getPlatformAi()
  if (!platform) return unavailable()

  try {
    await ensureUser({ id: account.userId, email: account.email, name: account.userName || null })

    // The run is taken first, so a request refused for want of runs doesn't also use up the day's cap.
    const reservation = meter === 'run' ? await reserveRun(account.userId) : await reserveImport(account.userId)
    if (!reservation) {
      return meter === 'run'
        ? refuse(
            402,
            'You have no tailorings left. Get Pro or a credit pack on the Plans page to keep tailoring.',
            BILLING_CODES.quotaExhausted
          )
        : refuse(
            429,
            "You've reached this month's limit for importing resumes. It starts again next month.",
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

/**
 * What a failed AI request tells the person who made it. The owner sees the
 * provider's own message, which names the key or model to fix. Everyone else
 * didn't choose the AI and can't change it, so they get what they can act on,
 * and the details stay in the server log.
 */
export function aiFailureMessage(role: Role, message: string): string {
  if (role === 'owner') return message
  if (/429|rate limit/i.test(message)) {
    return "ResMod AI is busy right now. Wait a minute and try again; this one wasn't counted."
  }
  return "The AI couldn't finish this just now. It wasn't counted, so please try again."
}

async function ownerAi(request: AiRequest): Promise<AiChoice> {
  if (request.usePlatform) {
    const platform: PlatformAiConfig | null = await getPlatformAi()
    return platform ? { ok: true, ...platform, reservation: null } : unavailable()
  }
  if (!request.provider) return refuse(400, 'Choose an AI provider in AI settings.')
  try {
    const apiKey = resolveApiKey(request.provider, request.apiKey, { allowServerKey: true })
    return { ok: true, provider: request.provider, apiKey, model: request.model, reservation: null }
  } catch (err) {
    return refuse(400, err instanceof Error ? err.message : String(err))
  }
}
