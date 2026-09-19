import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { billingFailure, requireCustomer } from '@/lib/billing/http'
import { RazorpayConfig, razorpayConfig } from '@/lib/billing/config'
import { paymentFacts } from '@/lib/billing/events'
import { RAZORPAY_ID, razorpay, RazorpayError, RazorpayPayment } from '@/lib/billing/razorpay'
import { verifyOrderPayment, verifySubscriptionPayment } from '@/lib/billing/signatures'
import { checkRateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/security/rate-limit'
import {
  findOrder,
  findSubscription,
  getBillingStatus,
  grantOrderPayment,
  OrderRow,
  recordSubscriptionPayment,
  syncSubscription,
} from '@/lib/billing/store'

const SIGNATURE = /^[a-f0-9]{64}$/

const schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('order'),
    orderId: z.string().regex(RAZORPAY_ID.order),
    paymentId: z.string().regex(RAZORPAY_ID.payment),
    signature: z.string().regex(SIGNATURE),
  }),
  z.object({
    kind: z.literal('subscription'),
    subscriptionId: z.string().regex(RAZORPAY_ID.subscription),
    paymentId: z.string().regex(RAZORPAY_ID.payment),
    signature: z.string().regex(SIGNATURE),
  }),
])

const unverified = () => NextResponse.json({ error: 'This payment could not be verified.' }, { status: 400 })

/**
 * Where Checkout's success callback lands.
 *
 * The signature proves Razorpay issued this payment for this order or
 * subscription. The order's own row says which pack and account it was for, so
 * nothing the browser sends decides what is granted, and runs are added only
 * once Razorpay has captured the money. The webhook does the same work if this
 * request never arrives, and whichever comes second changes nothing.
 */
export async function POST(req: NextRequest) {
  const auth = await requireCustomer()
  if (!auth.ok) return auth.response
  const limited = await checkRateLimit(RATE_LIMITS.paymentCheck, auth.userId)
  if (!limited.ok) return tooManyRequests(limited, 'Too many payment checks in a short time.')

  const config = razorpayConfig()
  if (!config) return NextResponse.json({ error: "Payments aren't switched on yet." }, { status: 503 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return unverified()
  const input = parsed.data

  try {
    if (input.kind === 'order') {
      if (!verifyOrderPayment(input, config.keySecret)) return unverified()
      const order = await findOrder(input.orderId)
      if (!order || order.userId !== auth.userId) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      }

      const payment = await capturedPayment(config, input.paymentId, order)
      if (payment.order_id !== order.id) return unverified()
      if (payment.status !== 'captured') {
        return NextResponse.json(
          { error: "Razorpay hasn't confirmed this payment yet. Your runs are added as soon as it does." },
          { status: 409 }
        )
      }
      if (payment.amount !== order.amount || payment.currency !== order.currency) {
        console.error(
          `[billing/verify] payment ${payment.id} is ${payment.amount} ${payment.currency}, ` +
            `but order ${order.id} costs ${order.amount} ${order.currency}`
        )
        return unverified()
      }
      await grantOrderPayment(order, payment)
    } else {
      if (!verifySubscriptionPayment(input, config.keySecret)) return unverified()
      const row = await findSubscription(input.subscriptionId)
      if (!row || row.userId !== auth.userId) {
        return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
      }
      await syncSubscription(config, row.id)

      // The first charge, for the payment history. The subscription.charged webhook records it too.
      const payment = await razorpay.fetchPayment(config, input.paymentId).catch(() => null)
      if (payment?.status === 'captured') await recordSubscriptionPayment(paymentFacts(payment), row.id, auth.userId)
    }

    return NextResponse.json(await getBillingStatus(auth.userId))
  } catch (err) {
    return billingFailure('billing/verify', err)
  }
}

/** The payment, captured first if it was only authorised: an account may not capture automatically. */
async function capturedPayment(config: RazorpayConfig, paymentId: string, order: OrderRow): Promise<RazorpayPayment> {
  const payment = await razorpay.fetchPayment(config, paymentId)
  if (payment.status !== 'authorized' || payment.order_id !== order.id) return payment
  try {
    return await razorpay.capturePayment(config, paymentId, { amount: order.amount, currency: order.currency })
  } catch (err) {
    // Captured automatically in the meantime, so read it again.
    if (err instanceof RazorpayError && err.status === 400) return razorpay.fetchPayment(config, paymentId)
    throw err
  }
}
