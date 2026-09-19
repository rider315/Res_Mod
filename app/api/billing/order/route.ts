import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { billingFailure, requireCustomer } from '@/lib/billing/http'
import { razorpayConfig } from '@/lib/billing/config'
import { getPlatformAi } from '@/lib/billing/platform-ai'
import { CURRENCY, findPack } from '@/lib/billing/plans'
import { razorpay } from '@/lib/billing/razorpay'
import { recordOrder } from '@/lib/billing/store'
import type { CheckoutStart } from '@/lib/billing/types'
import { ensureUser } from '@/lib/db/resumes'
import { checkRateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/security/rate-limit'

const schema = z.object({ packId: z.string() })

/**
 * Start buying a credit pack: create the Razorpay order Checkout pays, and
 * record which pack, price and account it is for.
 */
export async function POST(req: NextRequest) {
  const auth = await requireCustomer()
  if (!auth.ok) return auth.response
  const limited = await checkRateLimit(RATE_LIMITS.checkout, auth.userId)
  if (!limited.ok) return tooManyRequests(limited, 'Too many checkouts were opened in a short time.')

  const parsed = schema.safeParse(await req.json().catch(() => null))
  const pack = parsed.success ? findPack(parsed.data.packId) : undefined
  if (!pack) return NextResponse.json({ error: 'That credit pack does not exist.' }, { status: 400 })

  const config = razorpayConfig()
  // Selling runs the platform can't run would take money for nothing.
  if (!config || !(await getPlatformAi())) {
    return NextResponse.json({ error: "Payments aren't switched on yet." }, { status: 503 })
  }

  try {
    await ensureUser({ id: auth.userId, email: auth.email, name: auth.userName || null })
    const order = await razorpay.createOrder(config, {
      amount: pack.pricePaise,
      currency: CURRENCY,
      receipt: `resmod_${Date.now().toString(36)}`,
      notes: { user_id: auth.userId, pack_id: pack.id },
    })
    await recordOrder({ id: order.id, userId: auth.userId, pack, currency: CURRENCY })

    const start: CheckoutStart = {
      kind: 'order',
      keyId: config.keyId,
      orderId: order.id,
      amount: pack.pricePaise,
      currency: CURRENCY,
      description: `${pack.runs} tailorings`,
      prefill: { name: auth.userName, email: auth.email },
    }
    return NextResponse.json(start)
  } catch (err) {
    return billingFailure('billing/order', err)
  }
}
