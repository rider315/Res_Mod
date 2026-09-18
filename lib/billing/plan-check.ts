import type { RazorpayConfig } from '@/lib/billing/config'
import { CURRENCY, formatPrice, PaidTier, TIERS } from '@/lib/billing/plans'
import { razorpay, RazorpayError, RazorpayPlan } from '@/lib/billing/razorpay'

/**
 * A plan in the Razorpay Dashboard must be the one the billing page sells:
 * monthly, at that tier's price, and created in the same mode (test or live) as
 * the keys. Subscribing is refused while it isn't, and the owner's Business
 * overview says what is wrong.
 *
 * Each tier is checked against its own price, because a Premium plan created at
 * Pro's amount would charge the wrong money quietly — the subscription would
 * work, and only the bank statement would disagree with the page.
 */

/** What is wrong with a plan for this tier, or null when it matches. */
export function planProblem(tier: PaidTier, plan: Pick<RazorpayPlan, 'period' | 'interval' | 'item'>): string | null {
  const spec = TIERS[tier]
  if (plan.period !== 'monthly' || plan.interval !== 1) {
    return `The plan bills every ${plan.interval} ${plan.period}; it must bill every 1 month.`
  }
  const amount = plan.item?.amount
  const currency = plan.item?.currency
  if (amount !== spec.pricePaise || currency !== CURRENCY) {
    const charged =
      typeof amount !== 'number' ? 'an unknown amount' : currency === CURRENCY ? formatPrice(amount) : `${amount / 100} ${currency}`
    return `The plan charges ${charged}, but the billing page sells ${spec.label} at ${formatPrice(spec.pricePaise)}.`
  }
  return null
}

export interface PlanCheck {
  ok: boolean
  problem: string | null
}

const RECHECK_MS = 10 * 60 * 1000
const checked = new Map<PaidTier, { planId: string; at: number; result: PlanCheck }>()

/**
 * Checked against Razorpay at most every ten minutes per server instance. Throws
 * when Razorpay can't be reached, so a temporary outage isn't remembered as a
 * broken plan.
 */
export async function checkPlan(config: RazorpayConfig, tier: PaidTier): Promise<PlanCheck> {
  const planId = config.planIds[tier]
  if (!planId) return { ok: false, problem: `${TIERS[tier].envPlanId} is not set.` }

  const last = checked.get(tier)
  if (last?.planId === planId && Date.now() - last.at < RECHECK_MS) return last.result

  const mode = config.testMode ? 'Test' : 'Live'
  let result: PlanCheck
  try {
    const problem = planProblem(tier, await razorpay.fetchPlan(config, planId))
    result = { ok: problem === null, problem }
  } catch (err) {
    if (err instanceof RazorpayError && (err.status === 400 || err.status === 404)) {
      result = { ok: false, problem: `Razorpay has no plan ${planId} for these ${mode.toLowerCase()} keys. Create it in ${mode} mode.` }
    } else if (err instanceof RazorpayError && err.status === 401) {
      result = { ok: false, problem: 'Razorpay rejected the API keys.' }
    } else {
      throw err
    }
  }
  checked.set(tier, { planId, at: Date.now(), result })
  return result
}
