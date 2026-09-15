import type { RazorpayConfig } from '@/lib/billing/config'
import type { WebhookAction } from '@/lib/billing/events'
import {
  findOrder,
  findSubscription,
  grantOrderPayment,
  recordSubscriptionPayment,
  saveSubscriptionState,
  syncSubscription,
} from '@/lib/billing/store'

/**
 * Act on a verified Razorpay webhook. Every step is idempotent, so a redelivered
 * event — or the verify route handling the same payment at the same moment —
 * changes nothing twice. Returns a short note for the logs.
 */
export async function applyWebhookAction(config: RazorpayConfig, action: WebhookAction): Promise<string> {
  if (action.kind === 'ignore') return `ignored: ${action.reason}`

  if (action.kind === 'order_payment') {
    const { payment } = action
    const order = payment.orderId ? await findOrder(payment.orderId) : null
    if (!order) return 'ignored: not a ResMod credit pack order'
    if (payment.status !== 'captured') return `ignored: the payment is ${payment.status}`
    if (payment.amount !== order.amount || payment.currency !== order.currency) {
      console.error(
        `[billing] payment ${payment.id} is ${payment.amount} ${payment.currency}, ` +
          `but order ${order.id} costs ${order.amount} ${order.currency}`
      )
      return 'ignored: the amount does not match the order'
    }
    return (await grantOrderPayment(order, payment)) ? 'credits added' : 'credits were already added'
  }

  // A subscription event is a signal; Razorpay's API holds the current state, so
  // a delivery that arrives out of order can't roll the plan back. The payload
  // is the fallback when the API can't be reached.
  const { subscription } = action
  try {
    await syncSubscription(config, subscription.id)
  } catch (err) {
    console.warn(
      `[billing] fetching ${subscription.id} failed, so the webhook payload is used:`,
      err instanceof Error ? err.message : err
    )
    await saveSubscriptionState(subscription, action.eventAt)
  }

  const row = await findSubscription(subscription.id)
  if (!row) return 'ignored: not a ResMod subscription'
  if (action.payment?.status === 'captured') await recordSubscriptionPayment(action.payment, row.id, row.userId)
  return `subscription is ${row.status}`
}
