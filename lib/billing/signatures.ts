import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Razorpay's signatures, all HMAC-SHA256 hex digests:
 *
 *   Checkout, credit pack order:  hmac(key secret,     order_id + "|" + payment_id)
 *   Checkout, subscription:       hmac(key secret,     payment_id + "|" + subscription_id)
 *   Webhook:                      hmac(webhook secret, the raw request body)
 *
 * The subscription message puts the payment id first; the order message puts it
 * last. Sources:
 * https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/
 * https://razorpay.com/docs/payments/subscriptions/integration-guide/
 * https://razorpay.com/docs/webhooks/validate-test/
 */

export function hmacSha256Hex(secret: string, message: string | Buffer): string {
  return createHmac('sha256', secret).update(message).digest('hex')
}

/** Constant-time comparison. A signature of the wrong length is simply a mismatch. */
function matches(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(given, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

export function verifyOrderPayment(
  input: { orderId: string; paymentId: string; signature: string },
  keySecret: string
): boolean {
  if (!keySecret || !input.signature) return false
  return matches(hmacSha256Hex(keySecret, `${input.orderId}|${input.paymentId}`), input.signature)
}

export function verifySubscriptionPayment(
  input: { subscriptionId: string; paymentId: string; signature: string },
  keySecret: string
): boolean {
  if (!keySecret || !input.signature) return false
  return matches(hmacSha256Hex(keySecret, `${input.paymentId}|${input.subscriptionId}`), input.signature)
}

/** `rawBody` must be the bytes Razorpay sent, not JSON that was parsed and serialised again. */
export function verifyWebhook(rawBody: string | Buffer, signature: string, webhookSecret: string): boolean {
  if (!webhookSecret || !signature) return false
  return matches(hmacSha256Hex(webhookSecret, rawBody), signature)
}
