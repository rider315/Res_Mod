import { NextResponse } from 'next/server'
import { billingFailure, requireCustomer } from '@/lib/billing/http'
import { razorpayConfig } from '@/lib/billing/config'
import { checkProPlan } from '@/lib/billing/plan-check'
import { getPlatformAi } from '@/lib/billing/platform-ai'
import { PRO_PLAN } from '@/lib/billing/plans'
import { subscriptionEntitles } from '@/lib/billing/quota'
import { razorpay } from '@/lib/billing/razorpay'
import { currentSubscription, recentUnpaidSubscription, recordSubscription } from '@/lib/billing/store'
import type { CheckoutStart } from '@/lib/billing/types'
import { ensureUser } from '@/lib/db/resumes'

/**
 * Razorpay needs a cycle count for every subscription: ten years of monthly
 * cycles, which in practice means "until cancelled".
 */
const TOTAL_CYCLES = 120

/** A checkout abandoned within this long is offered again instead of creating another subscription. */
const REUSE_UNPAID_MS = 12 * 60 * 60 * 1000

/** Start a Pro subscription: create it at Razorpay, for Checkout to authorise. */
export async function POST() {
  const auth = await requireCustomer()
  if (!auth.ok) return auth.response

  const config = razorpayConfig()
  if (!config?.proPlanId || !(await getPlatformAi())) {
    return NextResponse.json({ error: "Pro isn't switched on yet." }, { status: 503 })
  }

  try {
    await ensureUser({ id: auth.userId, email: auth.email, name: auth.userName || null })
    const now = new Date()
    const current = await currentSubscription(auth.userId, now)
    if (current?.status === 'authenticated') {
      return NextResponse.json({ error: 'Your Pro plan is being switched on. Give it a minute.' }, { status: 409 })
    }
    if (current && subscriptionEntitles(current, now)) {
      const until = current.currentEnd?.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      return NextResponse.json(
        {
          error:
            current.cancelAtCycleEnd && until
              ? `Your Pro plan runs until ${until}. You can subscribe again once it ends.`
              : 'You already have Pro.',
        },
        { status: 409 }
      )
    }

    const plan = await checkProPlan(config)
    if (!plan.ok) {
      console.error(`[billing/subscribe] ${plan.problem}`)
      return NextResponse.json({ error: "Pro isn't set up correctly yet." }, { status: 503 })
    }

    const unpaid = await recentUnpaidSubscription(auth.userId, config.proPlanId, new Date(now.getTime() - REUSE_UNPAID_MS))
    let subscriptionId = unpaid?.id
    if (!subscriptionId) {
      const created = await razorpay.createSubscription(config, {
        plan_id: config.proPlanId,
        total_count: TOTAL_CYCLES,
        quantity: 1,
        notes: { user_id: auth.userId },
      })
      await recordSubscription({ id: created.id, userId: auth.userId, planId: config.proPlanId, status: created.status })
      subscriptionId = created.id
    }

    const start: CheckoutStart = {
      kind: 'subscription',
      keyId: config.keyId,
      subscriptionId,
      description: `${PRO_PLAN.label}: ${PRO_PLAN.runsPerCycle} runs a month`,
      prefill: { name: auth.userName, email: auth.email },
    }
    return NextResponse.json(start)
  } catch (err) {
    return billingFailure('billing/subscribe', err)
  }
}
