/**
 * What Chills sells, and what every account gets for free.
 *
 * Client-safe: the billing screen shows the same numbers the server charges by.
 * Amounts are in paise. PRO_PLAN's price must match the plan created in the
 * Razorpay Dashboard (RAZORPAY_PRO_PLAN_ID): the subscribe route checks, and
 * won't start a subscription at a price this page doesn't show.
 */

export const CURRENCY = 'INR'

/**
 * Tailorings every account gets free, once. After those, tailoring needs Pro or
 * a credit pack, and either can be bought at any time before that too.
 * FREE_TAILORINGS overrides it, for the local checks.
 */
export const DEFAULT_FREE_TAILORINGS = 3

export const PRO_PLAN = {
  label: 'Pro',
  pricePaise: 19_900,
  /** Tailorings included in each monthly billing cycle. */
  runsPerCycle: 100,
} as const

/**
 * Premium: the whole application in one run. The user gives a recruiter and the
 * posting they are hiring for; Chills reads that posting, tailors the resume to
 * it, and writes the recruiter email from the same reading, so the resume and
 * the email say the same thing. The email still waits to be sent.
 *
 * It costs more than Pro because one run is several model calls where a
 * tailoring is one, and because it replaces work the user would otherwise do by
 * hand across both halves of the product.
 */
export const PREMIUM_PLAN = {
  label: 'Premium',
  pricePaise: 49_900,
  runsPerCycle: 100,
  /** Complete applications — posting read, resume tailored, email written — each cycle. */
  appliesPerCycle: 40,
} as const

/** The subscriptions Chills sells, cheapest first. */
export const PAID_TIERS = ['pro', 'premium'] as const
export type PaidTier = (typeof PAID_TIERS)[number]

export const TIERS: Record<PaidTier, { label: string; pricePaise: number; runsPerCycle: number; appliesPerCycle: number; envPlanId: string }> = {
  pro: { ...PRO_PLAN, appliesPerCycle: 0, envPlanId: 'RAZORPAY_PRO_PLAN_ID' },
  premium: { ...PREMIUM_PLAN, envPlanId: 'RAZORPAY_PREMIUM_PLAN_ID' },
}

export function isPaidTier(value: unknown): value is PaidTier {
  return typeof value === 'string' && (PAID_TIERS as readonly string[]).includes(value)
}

/** Whether a tier includes the combined workflow. Only Premium does. */
export const tierHasApply = (tier: PaidTier) => TIERS[tier].appliesPerCycle > 0

export interface CreditPack {
  id: string
  runs: number
  pricePaise: number
}

/** One-time packs of tailorings. Credits never expire. */
export const CREDIT_PACKS: readonly CreditPack[] = [
  { id: 'runs_20', runs: 20, pricePaise: 9_900 },
  { id: 'runs_60', runs: 60, pricePaise: 24_900 },
]

/**
 * Importing a resume on Chills AI costs no run, but it is capped per calendar
 * month so the free tier can't become a general transcription service. Accounts
 * that pay — Pro, or credits left — get the higher cap.
 */
export const IMPORTS_PER_MONTH = { free: 10, paid: 30 } as const

/**
 * Recruiter emails the AI writes (first emails and follow-ups) per calendar
 * month. Like imports they cost no tailoring, and paying accounts get more.
 */
export const EMAIL_DRAFTS_PER_MONTH = { free: 10, paid: 200 } as const

/**
 * Recruiter emails any account can send in a UTC day. Sending goes through the
 * user's own mailbox and costs Chills nothing; the cap protects that mailbox,
 * because a burst of cold emails is what gets an address flagged as spam.
 */
export const EMAIL_SENDS_PER_DAY = 50

export function findPack(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((pack) => pack.id === id)
}

/** "₹99", or "₹99.50" when there are paise. */
export function formatPrice(paise: number, currency: string = CURRENCY): string {
  const digits = paise % 100 === 0 ? 0 : 2
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(paise / 100)
}
