import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { razorpayConfig } from '@/lib/billing/config'
import { readWebhookEvent } from '@/lib/billing/events'
import { verifyWebhook } from '@/lib/billing/signatures'
import { markWebhookHandled, webhookAlreadyHandled } from '@/lib/billing/store'
import { applyWebhookAction } from '@/lib/billing/webhook'

/**
 * Razorpay webhooks: payment.captured, order.paid and subscription.*.
 *
 * Added in the Razorpay Dashboard with RAZORPAY_WEBHOOK_SECRET; no session is
 * involved, the signature is the authentication. Razorpay waits 5 seconds for a
 * 2xx, retries failures for 24 hours, and can deliver an event twice or out of
 * order. So every handler is idempotent, deliveries already handled are skipped
 * by their x-razorpay-event-id, and a delivery that fails answers 500 to be retried.
 */
export async function POST(req: NextRequest) {
  const config = razorpayConfig()
  if (!config?.webhookSecret) {
    return NextResponse.json({ error: 'Webhooks are not configured.' }, { status: 503 })
  }

  // The signature covers the exact bytes sent, so read them before any parsing.
  const raw = Buffer.from(await req.arrayBuffer())
  if (!verifyWebhook(raw, req.headers.get('x-razorpay-signature') ?? '', config.webhookSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let body: unknown
  try {
    body = JSON.parse(raw.toString('utf8'))
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventId =
    req.headers.get('x-razorpay-event-id')?.trim() || `body:${createHash('sha256').update(raw).digest('hex')}`
  const action = readWebhookEvent(body)

  try {
    if (await webhookAlreadyHandled(eventId)) return NextResponse.json({ ok: true, duplicate: true })
    const outcome = await applyWebhookAction(config, action)
    await markWebhookHandled(eventId, action.event)
    console.log(`[billing/webhook] ${action.event}: ${outcome}`)
    return NextResponse.json({ ok: true, outcome })
  } catch (err) {
    console.error(`[billing/webhook] ${action.event} failed:`, err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'The event could not be processed.' }, { status: 500 })
  }
}
