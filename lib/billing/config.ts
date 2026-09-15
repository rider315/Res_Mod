import { AIProvider } from '@/types/resume'
import { getProvider, isValidProvider } from '@/lib/providers'
import { DEFAULT_FREE_RUNS_PER_MONTH } from '@/lib/billing/plans'

/**
 * Billing and ResMod AI settings, read from the environment (see .env.example).
 * Each returns null while its variables are missing, and whatever needs it
 * switches off rather than half-working.
 */

const env = (name: string) => process.env[name]?.trim() ?? ''

export interface RazorpayConfig {
  keyId: string
  keySecret: string
  /** Null until the webhook is added in the Razorpay Dashboard. */
  webhookSecret: string | null
  /** Null until the Pro plan is created in the Razorpay Dashboard. */
  proPlanId: string | null
  apiBase: string
  testMode: boolean
}

export function razorpayConfig(): RazorpayConfig | null {
  const keyId = env('RAZORPAY_KEY_ID')
  const keySecret = env('RAZORPAY_KEY_SECRET')
  if (!keyId || !keySecret) return null

  // Lets the local billing checks point at a stand-in API. Never honoured in production.
  const override = process.env.NODE_ENV === 'production' ? '' : env('RAZORPAY_API_BASE')
  return {
    keyId,
    keySecret,
    webhookSecret: env('RAZORPAY_WEBHOOK_SECRET') || null,
    proPlanId: env('RAZORPAY_PRO_PLAN_ID') || null,
    apiBase: (override || 'https://api.razorpay.com/v1').replace(/\/+$/, ''),
    testMode: keyId.startsWith('rzp_test_'),
  }
}

export interface PlatformAiConfig {
  provider: AIProvider
  /** Undefined means the provider's default model. */
  model: string | undefined
  apiKey: string
}

/**
 * The model regular accounts run on when they use included runs instead of
 * their own key. Deliberately separate from the provider keys in .env, which
 * belong to the owner.
 */
export function platformAiConfig(): PlatformAiConfig | null {
  const provider = env('PLATFORM_AI_PROVIDER')
  if (!provider || !isValidProvider(provider)) return null

  const config = getProvider(provider)
  if (config.clientSide) return null
  const apiKey = env('PLATFORM_AI_KEY')
  if (config.needsKey && !apiKey) return null

  return { provider, model: env('PLATFORM_AI_MODEL') || undefined, apiKey }
}

export function freeRunsPerMonth(): number {
  const raw = env('FREE_RUNS_PER_MONTH')
  if (!raw) return DEFAULT_FREE_RUNS_PER_MONTH
  const value = Number(raw)
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_FREE_RUNS_PER_MONTH
}
