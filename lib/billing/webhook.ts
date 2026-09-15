import type { RazorpayConfig } from '@/lib/billing/config'
import { paymentFacts, WebhookAction } from '@/lib/billing/events'
import { RAZORPAY_ID, razorpay, RazorpayError } from '@/lib/billing/razorpay'
import {
  findOrder,
  findSubscription,
  grantOrderPayment,
  recordSubscriptionPayment,
  syncSubscription,
} from '@/lib/billing/store'

/**
 * Act on a verified Razorpay webhook.
 *
 * The payload is a signal, never the truth: the payment or subscription it names
 * is read back from Razorpay's API, with the key secret, before anything changes.
 * So a webhook secret that leaked or was guessed can't add credits or switch Pro
 * on, and a delivery that arrives out of order can't roll a plan back. When
 * Razorpay can't be reached this throws, the route answers 500, and Razorpay
 * delivers the event again later.
 *
 * Every step is idempotent, so a redelivered event — or the verify route handling
 * the same payment at the same moment — changes nothing twice. Returns a short
 * note for the logs.
 */
export async function applyWebhookAction(config: RazorpayConfig, action: WebhookAction): Promise<string> {
  if (action.kind === 'ignore') return `ignored: ${action.reason}`

  if (action.kind === 'order_payment') {
    const order = action.payment.orderId ? await findOrder(action.payment.orderId) : null
    if (!order) return 'ignored: not a ResMod credit pack order'

    const payment = await readIfItExists(RAZORPAY_ID.payment.test(action.payment.id), () =>
      razorpay.fetchPayment(config, action.payment.id)
    )
    if (!payment) return 'ignored: Razorpay has no such payment'
    if (payment.order_id !== order.id) return 'ignored: the payment is for another order'
    if (payment.status !== 'captured') return `ignored: the payment is ${payment.status}`
    if (payment.amount !== order.amount || payment.currency !== order.currency) {
      console.error(
        `[billing] payment ${payment.id} is ${payment.amount} ${payment.currency}, ` +
          `but order ${order.id} costs ${order.amount} ${order.currency}`
      )
      return 'ignored: the amount does not match the order'
    }
    return (await grantOrderPayment(order, paymentFacts(payment))) ? 'credits added' : 'credits were already added'
  }

  const { subscription } = action
  const synced = await readIfItExists(RAZORPAY_ID.subscription.test(subscription.id), () =>
    syncSubscription(config, subscription.id)
  )
  if (!synced) return 'ignored: Razorpay has no such subscription'

  const row = await findSubscription(subscription.id)
  if (!row) return 'ignored: not a ResMod subscription'

  // The charge goes into the payment history only as Razorpay reports it.
  if (action.payment && RAZORPAY_ID.payment.test(action.payment.id)) {
    const payment = await razorpay.fetchPayment(config, action.payment.id).catch(() => null)
    if (payment?.status === 'captured') await recordSubscriptionPayment(paymentFacts(payment), row.id, row.userId)
  }
  return `subscription is ${row.status}`
}

/**
 * Read something from Razorpay, or null when the id is malformed or Razorpay says
 * it doesn't exist, as for a forged event. Any other failure is thrown, so the
 * event is retried.
 */
async function readIfItExists<T>(wellFormed: boolean, read: () => Promise<T>): Promise<T | null> {
  if (!wellFormed) return null
  try {
    return await read()
  } catch (err) {
    if (err instanceof RazorpayError && (err.status === 400 || err.status === 404)) return null
    throw err
  }
}
