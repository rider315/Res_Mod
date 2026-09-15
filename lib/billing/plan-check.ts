import type { RazorpayConfig } from '@/lib/billing/config'
import { CURRENCY, formatPrice, PRO_PLAN } from '@/lib/billing/plans'
import { razorpay, RazorpayError, RazorpayPlan } from '@/lib/billing/razorpay'

/**
 * The Pro plan in the Razorpay Dashboard must be the one the billing page sells:
 * monthly, at PRO_PLAN's price, and created in the same mode (test or live) as
 * the keys. Subscribing is refused while it isn't, and the owner's Business
 * overview says what is wrong.
 */

/** What is wrong with a plan, or null when it matches. */
export function planProblem(plan: Pick<RazorpayPlan, 'period' | 'interval' | 'item'>): string | null {
  if (plan.period !== 'monthly' || plan.interval !== 1) {
    return `The plan bills every ${plan.interval} ${plan.period}; it must bill every 1 month.`
  }
  const amount = plan.item?.amount
  const currency = plan.item?.currency
  if (amount !== PRO_PLAN.pricePaise || currency !== CURRENCY) {
    const charged =
      typeof amount !== 'number' ? 'an unknown amount' : currency === CURRENCY ? formatPrice(amount) : `${amount / 100} ${currency}`
    return `The plan charges ${charged}, but the billing page sells Pro at ${formatPrice(PRO_PLAN.pricePaise)}.`
  }
  return null
}

export interface ProPlanCheck {
  ok: boolean
  problem: string | null
}

const RECHECK_MS = 10 * 60 * 1000
let checked: { planId: string; at: number; result: ProPlanCheck } | null = null

/**
 * Checked against Razorpay at most every ten minutes per server instance. Throws
 * when Razorpay can't be reached, so a temporary outage isn't remembered as a
 * broken plan.
 */
export async function checkProPlan(config: RazorpayConfig): Promise<ProPlanCheck> {
  const planId = config.proPlanId
  if (!planId) return { ok: false, problem: 'RAZORPAY_PRO_PLAN_ID is not set.' }
  if (checked?.planId === planId && Date.now() - checked.at < RECHECK_MS) return checked.result

  const mode = config.testMode ? 'Test' : 'Live'
  let result: ProPlanCheck
  try {
    const problem = planProblem(await razorpay.fetchPlan(config, planId))
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
  checked = { planId, at: Date.now(), result }
  return result
}
