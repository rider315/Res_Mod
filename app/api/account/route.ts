import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/require-auth'
import { razorpayConfig } from '@/lib/billing/config'
import { subscriptionFacts } from '@/lib/billing/events'
import { razorpay, RazorpayError } from '@/lib/billing/razorpay'
import { openSubscriptions, saveSubscriptionState, SubscriptionRow } from '@/lib/billing/store'
import { deleteAccountData } from '@/lib/db/account'
import { checkRateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/security/rate-limit'

const schema = z.object({ confirm: z.literal('DELETE') })

/**
 * A plan that could still take money: it must be cancelled before anything is
 * deleted. One already set to end with its cycle won't renew, so it is left to end.
 */
const canCharge = (sub: SubscriptionRow) =>
  ['authenticated', 'active', 'pending'].includes(sub.status) && !sub.cancelAtCycleEnd

/**
 * Delete the signed-in account.
 *
 * A Pro plan is cancelled at Razorpay first, immediately, so nobody is charged
 * for an account that no longer exists; if that fails, nothing is deleted. Then
 * the resumes, the tailoring history, the name and the email are deleted, and
 * unused credits are forfeited. Payment records stay, for accounting, and the
 * account's anonymous id keeps its usage counts, so deleting can't reset free runs.
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const limited = await checkRateLimit(RATE_LIMITS.mutation, auth.userId)
  if (!limited.ok) return tooManyRequests(limited, 'Too many account requests were made in a short time.')
  if (!auth.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (auth.role === 'owner') {
    return NextResponse.json({ error: "The owner account can't be deleted from here." }, { status: 400 })
  }
  if (!schema.safeParse(await req.json().catch(() => null)).success) {
    return NextResponse.json({ error: 'Confirm the deletion first.' }, { status: 400 })
  }

  try {
    const open = await openSubscriptions(auth.userId)
    const config = razorpayConfig()
    if (!config && open.some(canCharge)) {
      return NextResponse.json(
        { error: "Your Pro plan can't be cancelled right now, so nothing was deleted. Try again later." },
        { status: 503 }
      )
    }

    for (const sub of config ? open : []) {
      if (sub.cancelAtCycleEnd) continue
      const asOf = new Date()
      try {
        const cancelled = await razorpay.cancelSubscription(config!, sub.id, { cancel_at_cycle_end: false })
        await saveSubscriptionState(subscriptionFacts(cancelled), asOf)
      } catch (err) {
        // A halted or paused plan can't charge, and may refuse to cancel; that mustn't trap the account.
        if (canCharge(sub)) throw err
        console.warn(`[account] could not cancel ${sub.status} subscription ${sub.id}:`, err instanceof Error ? err.message : err)
      }
    }

    await deleteAccountData(auth.userId)
    return NextResponse.json({ deleted: true })
  } catch (err) {
    if (err instanceof RazorpayError) {
      console.error(`[account] Razorpay ${err.status}: ${err.message}`)
      return NextResponse.json(
        { error: `Your Pro plan couldn't be cancelled (${err.message}), so nothing was deleted. Try again.` },
        { status: 502 }
      )
    }
    console.error('[account]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Your account could not be deleted right now. Try again in a moment.' }, { status: 500 })
  }
}
