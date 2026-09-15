import type { CreditPack } from '@/lib/billing/plans'
import type { Allowance } from '@/lib/billing/quota'

/** Codes the AI and billing routes send next to their error message, for the screens to act on. */
export const BILLING_CODES = {
  quotaExhausted: 'quota_exhausted',
  importLimit: 'import_limit_reached',
  platformUnavailable: 'platform_ai_unavailable',
  dailyLimit: 'daily_limit_reached',
} as const

/** GET /api/billing for a regular account. */
export interface BillingStatus {
  role: 'user'
  /** ResMod AI is configured, so included runs can be used, and sold. */
  platformAi: boolean
  checkout: {
    /** Credit packs can be bought. */
    packs: boolean
    /** Pro can be subscribed to. */
    pro: boolean
    /** Razorpay test keys are in use, so no real money moves. */
    testMode: boolean
  }
  runs: {
    left: number
    free: Allowance & { resetsAt: string }
    /** This Pro cycle's runs; null without a Pro plan in force. */
    subscription: Allowance | null
    credits: number
  }
  imports: Allowance & { resetsAt: string }
  subscription: {
    status: string
    /** The plan's runs can be used right now. */
    entitled: boolean
    currentEnd: string | null
    cancelAtCycleEnd: boolean
  } | null
  pro: { label: string; pricePaise: number; runsPerCycle: number }
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
