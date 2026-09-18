import { NextRequest, NextResponse } from 'next/server'
import { billingFailure, requireCustomer } from '@/lib/billing/http'
import { razorpayConfig, tierForPlanId } from '@/lib/billing/config'
import { checkPlan } from '@/lib/billing/plan-check'
import { getPlatformAi } from '@/lib/billing/platform-ai'
import { isPaidTier, PaidTier, TIERS } from '@/lib/billing/plans'
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

/** What a plan's checkout says it is for. One line, no number Pro's line already gives. */
function describeTier(tier: PaidTier): string {
  const spec = TIERS[tier]
  return spec.appliesPerCycle > 0
    ? `${spec.label}: ${spec.appliesPerCycle} complete applications a month`
    : `${spec.label}: ${spec.runsPerCycle} tailorings a month`
}

/** Start a subscription: create it at Razorpay, for Checkout to authorise. */
export async function POST(request: NextRequest) {
  const auth = await requireCustomer()
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => ({}))
  const asked: unknown = (body as { tier?: unknown }).tier ?? 'pro'
  if (!isPaidTier(asked)) return NextResponse.json({ error: 'There is no such plan.' }, { status: 400 })
  const tier: PaidTier = asked
  const spec = TIERS[tier]

  const config = razorpayConfig()
  const planId = config?.planIds[tier] ?? null
  if (!planId || !(await getPlatformAi())) {
    return NextResponse.json({ error: `${spec.label} isn't switched on yet.` }, { status: 503 })
  }

  try {
    await ensureUser({ id: auth.userId, email: auth.email, name: auth.userName || null })
    const now = new Date()
    const current = await currentSubscription(auth.userId, now)
    if (current?.status === 'authenticated') {
      return NextResponse.json({ error: 'Your plan is being switched on. Give it a minute.' }, { status: 409 })
    }
    if (current && subscriptionEntitles(current, now)) {
      // Whatever they are on now, by name, so "You already have Pro" can't greet someone on Premium.
      const held = tierForPlanId(config!, current.planId)
      const heldLabel = held ? TIERS[held].label : 'a plan'
      const until = current.currentEnd?.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      return NextResponse.json(
        {
          error:
            current.cancelAtCycleEnd && until
              ? `Your ${heldLabel} plan runs until ${until}. You can subscribe again once it ends.`
              : held === tier
                ? `You already have ${heldLabel}.`
                : `You are on ${heldLabel}. Cancel it first, and you can take ${spec.label} once it ends.`,
        },
        { status: 409 }
      )
    }

    const plan = await checkPlan(config!, tier)
    if (!plan.ok) {
      console.error(`[billing/subscribe] ${tier}: ${plan.problem}`)
      return NextResponse.json({ error: `${spec.label} isn't set up correctly yet.` }, { status: 503 })
    }

    const unpaid = await recentUnpaidSubscription(auth.userId, planId, new Date(now.getTime() - REUSE_UNPAID_MS))
    let subscriptionId = unpaid?.id
    if (!subscriptionId) {
      const created = await razorpay.createSubscription(config!, {
        plan_id: planId,
        total_count: TOTAL_CYCLES,
        quantity: 1,
        notes: { user_id: auth.userId },
      })
      await recordSubscription({ id: created.id, userId: auth.userId, planId, status: created.status })
      subscriptionId = created.id
    }

    const start: CheckoutStart = {
      kind: 'subscription',
      keyId: config!.keyId,
      subscriptionId,
      description: describeTier(tier),
      prefill: { name: auth.userName, email: auth.email },
    }
    return NextResponse.json(start)
  } catch (err) {
    return billingFailure('billing/subscribe', err)
  }
}
