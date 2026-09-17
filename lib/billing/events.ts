import { z } from 'zod'

/**
 * Reading a Razorpay webhook into the few facts Chills acts on. Pure, so the
 * routing can be tested with sample payloads.
 *
 * - payment.captured and order.paid carry the payment for a credit pack order.
 * - subscription.* carry the subscription's new state; subscription.charged also
 *   carries the payment for the cycle.
 *
 * Event names: https://razorpay.com/docs/webhooks/payments/ and
 * https://razorpay.com/docs/webhooks/subscriptions/
 */

export const SUBSCRIPTION_EVENTS = [
  'subscription.authenticated',
  'subscription.activated',
  'subscription.charged',
  'subscription.completed',
  'subscription.updated',
  'subscription.pending',
  'subscription.halted',
  'subscription.cancelled',
  'subscription.paused',
  'subscription.resumed',
] as const

/** The events to tick when adding the webhook in the Razorpay Dashboard. */
export const WEBHOOK_EVENTS = ['payment.captured', 'order.paid', ...SUBSCRIPTION_EVENTS] as const

// Razorpay sends notes as an object, or as an empty array when there are none.
const Notes = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).nullish()

const PaymentEntity = z.object({
  id: z.string(),
  amount: z.number(),
  currency: z.string(),
  status: z.string(),
  order_id: z.string().nullish(),
})

const SubscriptionEntity = z.object({
  id: z.string(),
  plan_id: z.string(),
  status: z.string(),
  current_start: z.number().nullish(),
  current_end: z.number().nullish(),
  notes: Notes,
})

const Envelope = z.object({
  event: z.string(),
  created_at: z.number(),
  payload: z.object({
    // A malformed payment must not stop a subscription update from being read.
    payment: z.object({ entity: PaymentEntity }).optional().catch(undefined),
    subscription: z.object({ entity: SubscriptionEntity }).optional().catch(undefined),
  }),
})

export interface PaymentFacts {
  id: string
  amount: number
  currency: string
  status: string
  orderId: string | null
}

export interface SubscriptionFacts {
  id: string
  planId: string
  status: string
  currentStart: Date | null
  currentEnd: Date | null
  /** The account Chills created it for, from the subscription's notes. */
  userId: string | null
}

export type WebhookAction =
  | { kind: 'order_payment'; event: string; payment: PaymentFacts }
  | { kind: 'subscription'; event: string; subscription: SubscriptionFacts; payment: PaymentFacts | null; eventAt: Date }
  | { kind: 'ignore'; event: string; reason: string }

const fromUnix = (seconds: number | null | undefined): Date | null => (seconds ? new Date(seconds * 1000) : null)

export function paymentFacts(entity: {
  id: string
  amount: number
  currency: string
  status: string
  order_id?: string | null
}): PaymentFacts {
  return {
    id: entity.id,
    amount: entity.amount,
    currency: entity.currency,
    status: entity.status,
    orderId: entity.order_id ?? null,
  }
}

/** Reads a webhook's subscription entity, or the same shape from the REST API. */
export function subscriptionFacts(entity: {
  id: string
  plan_id: string
  status: string
  current_start?: number | null
  current_end?: number | null
  notes?: unknown
}): SubscriptionFacts {
  const notes =
    entity.notes && typeof entity.notes === 'object' && !Array.isArray(entity.notes)
      ? (entity.notes as Record<string, unknown>)
      : {}
  const userId = typeof notes.user_id === 'string' && notes.user_id.trim() ? notes.user_id : null
  return {
    id: entity.id,
    planId: entity.plan_id,
    status: entity.status,
    currentStart: fromUnix(entity.current_start),
    currentEnd: fromUnix(entity.current_end),
    userId,
  }
}

export function readWebhookEvent(body: unknown): WebhookAction {
  const named = body && typeof body === 'object' ? (body as { event?: unknown }).event : undefined
  const event = typeof named === 'string' ? named : 'unknown'

  const parsed = Envelope.safeParse(body)
  if (!parsed.success) return { kind: 'ignore', event, reason: 'not a Razorpay event this app can read' }
  const { payload, created_at } = parsed.data

  if (event === 'payment.captured' || event === 'order.paid') {
    const payment = payload.payment?.entity
    if (!payment?.order_id) return { kind: 'ignore', event, reason: 'the payment has no order' }
    return { kind: 'order_payment', event, payment: paymentFacts(payment) }
  }

  if ((SUBSCRIPTION_EVENTS as readonly string[]).includes(event)) {
    const subscription = payload.subscription?.entity
    if (!subscription) return { kind: 'ignore', event, reason: 'the payload has no subscription' }
    const payment = event === 'subscription.charged' && payload.payment ? paymentFacts(payload.payment.entity) : null
    return {
      kind: 'subscription',
      event,
      subscription: subscriptionFacts(subscription),
      payment,
      eventAt: new Date(created_at * 1000),
    }
  }

  return { kind: 'ignore', event, reason: 'not an event this app acts on' }
}
