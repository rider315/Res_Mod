/**
 * What ResMod sells, and what every account gets for free.
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
 * Importing a resume on ResMod AI costs no run, but it is capped per calendar
 * month so the free tier can't become a general transcription service. Accounts
 * that pay — Pro, or credits left — get the higher cap.
 */
export const IMPORTS_PER_MONTH = { free: 10, paid: 30 } as const

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
