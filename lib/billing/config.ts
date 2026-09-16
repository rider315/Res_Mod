import { z } from 'zod'
import { AIProvider } from '@/types/resume'
import { getProvider, isValidProvider } from '@/lib/providers'
import { DEFAULT_FREE_TAILORINGS } from '@/lib/billing/plans'

/**
 * Billing settings from the environment (see .env.example), and the rules for
 * ResMod AI, which the owner chooses in AI settings. Each returns null while it
 * isn't set, and whatever needs it switches off rather than half-working.
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
 * ResMod AI from PLATFORM_AI_* environment variables. Usually these are unset,
 * because the owner chooses ResMod AI in AI settings (lib/billing/platform-ai.ts).
 * When they are set they take precedence, which is how the local checks point
 * ResMod AI at a stand-in model.
 */
export function platformAiFromEnv(): PlatformAiConfig | null {
  const provider = env('PLATFORM_AI_PROVIDER')
  if (!provider || !isValidProvider(provider)) return null

  const config = getProvider(provider)
  if (config.clientSide) return null
  const apiKey = env('PLATFORM_AI_KEY')
  if (config.needsKey && !apiKey) return null

  return { provider, model: env('PLATFORM_AI_MODEL') || undefined, apiKey }
}

const StoredPlatformAiSchema = z.object({
  provider: z.string(),
  model: z.string().default(''),
  /** "saved": encryptedKey holds the key. "server": the provider's own env var, such as GEMINI_API_KEY, is used. */
  keySource: z.enum(['saved', 'server']),
  encryptedKey: z.string().optional(),
  /** The saved key's last four characters, so the owner can tell which key is in use. */
  keyHint: z.string().optional(),
})

/** ResMod AI as the owner saved it in AI settings. The key is encrypted (lib/secrets.ts). */
export type StoredPlatformAi = z.infer<typeof StoredPlatformAiSchema>

export function parseStoredPlatformAi(value: unknown): StoredPlatformAi | null {
  const parsed = StoredPlatformAiSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * The model and key a saved setting points at, or null when it can't run: an
 * unknown or browser-only provider, or a key that is missing or can't be decrypted.
 */
export function resolveStoredPlatformAi(
  stored: StoredPlatformAi | null,
  environment: Record<string, string | undefined>,
  decrypt: (sealed: string) => string | null
): PlatformAiConfig | null {
  if (!stored || !isValidProvider(stored.provider)) return null
  const config = getProvider(stored.provider)
  if (config.clientSide) return null

  let apiKey = ''
  if (config.needsKey) {
    apiKey =
      stored.keySource === 'saved'
        ? (stored.encryptedKey && decrypt(stored.encryptedKey)) || ''
        : (config.envVar && environment[config.envVar]?.trim()) || ''
    if (!apiKey) return null
  }
  return { provider: stored.provider, model: stored.model.trim() || undefined, apiKey }
}

/** How many free tailorings an account gets, once. */
export function freeTailorings(): number {
  const raw = env('FREE_TAILORINGS')
  if (!raw) return DEFAULT_FREE_TAILORINGS
  const value = Number(raw)
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_FREE_TAILORINGS
}
