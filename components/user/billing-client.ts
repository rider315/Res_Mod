import type { BillingResponse, CheckoutStart } from '@/lib/billing/types'

/** Browser helpers for included runs and payments: API errors with codes, and Razorpay Checkout. */

/** An API error, carrying the code billing errors come with (BILLING_CODES in lib/billing/types.ts). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function readApiError(res: Response, fallback: string): Promise<ApiError> {
  const data = await res.json().catch(() => ({}))
  return new ApiError(data.error ?? fallback, res.status, data.code)
}

export async function fetchBilling(): Promise<BillingResponse> {
  const res = await fetch('/api/billing', { cache: 'no-store' })
  if (!res.ok) throw await readApiError(res, 'Billing details could not be loaded.')
  return res.json()
}

export async function postBilling<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw await readApiError(res, 'That did not work. Try again in a moment.')
  return res.json()
}

export function formatDay(date: string | Date): string {
  return new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

// ─── Razorpay Checkout ───────────────────────────────────────────────────────

interface CheckoutSuccess {
  razorpay_payment_id: string
  razorpay_signature: string
}

interface CheckoutInstance {
  open(): void
  on(event: 'payment.failed', handler: (response: { error?: { description?: string } }) => void): void
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => CheckoutInstance
  }
}

const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js'
let checkoutScript: Promise<void> | null = null

/** Razorpay's script loads only when someone actually pays. */
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve()
  checkoutScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = CHECKOUT_SCRIPT
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      checkoutScript = null
      script.remove()
      reject(
        new Error(
          'Razorpay Checkout could not be loaded. Check your connection, or allow checkout.razorpay.com in any blocker.'
        )
      )
    }
    document.body.appendChild(script)
  })
  return checkoutScript
}

/** What the verify route needs from a finished Checkout. */
export type PaymentProof =
  | { kind: 'order'; orderId: string; paymentId: string; signature: string }
  | { kind: 'subscription'; subscriptionId: string; paymentId: string; signature: string }

function themeColor(): string | undefined {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim()
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : undefined
}

/**
 * Open Razorpay Checkout. Resolves with the payment for the server to verify, or
 * null when the buyer closes it without paying. A failed attempt leaves Checkout
 * open to try again, so its reason is only reported if the buyer then gives up.
 */
export async function payWithCheckout(start: CheckoutStart): Promise<PaymentProof | null> {
  await loadCheckout()
  const Razorpay = window.Razorpay
  if (!Razorpay) throw new Error('Razorpay Checkout could not be loaded.')

  return new Promise((resolve, reject) => {
    let lastFailure: string | null = null
    const color = themeColor()
    const checkout = new Razorpay({
      key: start.keyId,
      name: 'ResMod',
      description: start.description,
      ...(start.kind === 'order'
        ? { order_id: start.orderId, amount: start.amount, currency: start.currency }
        : { subscription_id: start.subscriptionId }),
      prefill: start.prefill,
      ...(color ? { theme: { color } } : {}),
      // The ids come from ResMod's own server, never from Checkout's reply.
      handler: (response: CheckoutSuccess) =>
        resolve(
          start.kind === 'order'
            ? { kind: 'order', orderId: start.orderId, paymentId: response.razorpay_payment_id, signature: response.razorpay_signature }
            : {
                kind: 'subscription',
                subscriptionId: start.subscriptionId,
                paymentId: response.razorpay_payment_id,
                signature: response.razorpay_signature,
              }
        ),
      modal: {
        ondismiss: () => (lastFailure ? reject(new Error(lastFailure)) : resolve(null)),
      },
    })
    checkout.on('payment.failed', (response) => {
      lastFailure = response.error?.description ?? 'The payment did not go through.'
    })
    checkout.open()
  })
}
