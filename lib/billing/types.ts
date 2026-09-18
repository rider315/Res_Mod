import type { AIProvider } from '@/types/resume'
import type { AiFailureKind } from '@/lib/ai-errors'
import type { CreditPack, PaidTier, TierSpec } from '@/lib/billing/plans'
import type { Allowance } from '@/lib/billing/quota'

/** Codes the AI and billing routes send next to their error message, for the screens to act on. */
export const BILLING_CODES = {
  quotaExhausted: 'quota_exhausted',
  importLimit: 'import_limit_reached',
  platformUnavailable: 'platform_ai_unavailable',
  dailyLimit: 'daily_limit_reached',
  draftLimit: 'email_draft_limit_reached',
  sendLimit: 'email_send_limit_reached',
  /** The account's plan doesn't include complete applications. */
  applyTier: 'apply_needs_premium',
  /** It does, but this cycle's applications are used up. */
  applyLimit: 'apply_limit_reached',
} as const

/** GET /api/billing for a regular account. */
export interface BillingStatus {
  role: 'user'
  /** Chills AI is configured, so accounts can import and tailor, and plans can be sold. */
  platformAi: boolean
  checkout: {
    /** Credit packs can be bought. */
    packs: boolean
    /** The tiers that can be subscribed to right now: a plan exists for them in the Razorpay Dashboard. */
    tiers: PaidTier[]
    /** Razorpay test keys are in use, so no real money moves. */
    testMode: boolean
  }
  runs: {
    left: number
    /** The free tailorings every account gets once. */
    free: Allowance
    /** This cycle's runs; null without a plan in force. */
    subscription: Allowance | null
    credits: number
  }
  /**
   * How many of this cycle's runs may still be complete applications. Null
   * unless the plan in force includes them, which today means Premium.
   */
  applies: (Allowance & { resetsAt: string }) | null
  imports: Allowance & { resetsAt: string }
  /** Recruiter emails the AI can write this month. */
  emailDrafts: Allowance & { resetsAt: string }
  /** Recruiter emails sent today; the count starts again at midnight UTC. */
  emailSends: Allowance & { resetsAt: string }
  subscription: {
    /** Which plan is in force; null when its plan id no longer matches a tier we sell. */
    tier: PaidTier | null
    status: string
    /** The plan's runs can be used right now. */
    entitled: boolean
    currentEnd: string | null
    cancelAtCycleEnd: boolean
  } | null
  /** What each tier costs and includes, so the billing page shows the numbers the server charges by. */
  tiers: Record<PaidTier, TierSpec>
  packs: CreditPack[]
  payments: Array<{ id: string; kind: 'pack' | 'subscription'; amount: number; currency: string; createdAt: string }>
}

export type BillingResponse = BillingStatus | { role: 'owner' }

interface Prefill {
  name: string
  email: string
}

/** What the order and subscribe routes hand the browser to open Razorpay Checkout with. */
export type CheckoutStart =
  | { kind: 'order'; keyId: string; orderId: string; amount: number; currency: string; description: string; prefill: Prefill }
  | { kind: 'subscription'; keyId: string; subscriptionId: string; description: string; prefill: Prefill }

/** /api/admin/platform-ai: Chills AI as the owner set it in AI settings. The key is never included. */
export interface PlatformAiStatus {
  current: {
    provider: AIProvider
    model: string
    /** "saved": a key saved from AI settings. "server": the provider's key in the server environment. */
    keySource: 'saved' | 'server'
    /** The saved key's last four characters. */
    keyHint: string | null
    updatedAt: string | null
  } | null
  /** The setting can run: its provider is usable and its key is present and readable. */
  working: boolean
  /** PLATFORM_AI_* environment variables are set on this server, and are used instead. */
  overriddenByEnv: boolean
  /** Requests that failed on Chills AI since it was last saved, newest first. */
  recentFailures: PlatformAiFailure[]
}

/**
 * A request that failed on Chills AI, kept for the owner: the person who made it
 * only saw a plain notice (lib/ai-errors.ts), so this is where the provider's
 * own words end up.
 */
export interface PlatformAiFailure {
  /** ISO time. */
  at: string
  /** What the person was doing, such as "Tailoring". */
  feature: string
  kind: AiFailureKind
  message: string
}
