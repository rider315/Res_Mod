import { NextResponse } from 'next/server'
import { billingFailure, requireCustomer } from '@/lib/billing/http'
import { razorpayConfig } from '@/lib/billing/config'
import { subscriptionFacts } from '@/lib/billing/events'
import { subscriptionEntitles } from '@/lib/billing/quota'
import { razorpay } from '@/lib/billing/razorpay'
import {
  currentSubscription,
  getBillingStatus,
  markCancelAtCycleEnd,
  saveSubscriptionState,
} from '@/lib/billing/store'
import { checkRateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/security/rate-limit'

/**
 * Cancel Pro at the end of the cycle already paid for: the runs stay until then,
 * and it doesn't renew. Razorpay can't undo a cancellation, so the page asks first.
 */
export async function POST() {
  const auth = await requireCustomer()
  if (!auth.ok) return auth.response
  const limited = await checkRateLimit(RATE_LIMITS.checkout, auth.userId)
  if (!limited.ok) return tooManyRequests(limited, 'Too many cancellations were tried in a short time.')

  const config = razorpayConfig()
  if (!config) return NextResponse.json({ error: "Payments aren't switched on yet." }, { status: 503 })

  try {
    const now = new Date()
    const current = await currentSubscription(auth.userId, now)
    if (!current || !subscriptionEntitles(current, now)) {
      return NextResponse.json({ error: "You don't have a Pro plan to cancel." }, { status: 404 })
    }

    if (!current.cancelAtCycleEnd) {
      const asOf = new Date()
      const cancelled = await razorpay.cancelSubscription(config, current.id, { cancel_at_cycle_end: true })
      await markCancelAtCycleEnd(current.id)
      await saveSubscriptionState(subscriptionFacts(cancelled), asOf)
    }
    return NextResponse.json(await getBillingStatus(auth.userId))
  } catch (err) {
    return billingFailure('billing/cancel', err)
  }
}
