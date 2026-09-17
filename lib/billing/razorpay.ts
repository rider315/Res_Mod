import type { RazorpayConfig } from '@/lib/billing/config'

/**
 * The few Razorpay REST calls Chills makes, over fetch with Basic auth
 * (https://razorpay.com/docs/api/). Amounts are in paise.
 */

export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message)
    this.name = 'RazorpayError'
  }
}

async function call<T>(config: RazorpayConfig, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const credentials = Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')
  let res: Response
  try {
    res = await fetch(`${config.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${credentials}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    throw new RazorpayError(`Could not reach Razorpay: ${err instanceof Error ? err.message : String(err)}`, 502)
  }

  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // Not JSON; reported below.
  }
  if (!res.ok || !data || typeof data !== 'object') {
    const error = (data as { error?: { description?: string; code?: string } } | null)?.error
    throw new RazorpayError(error?.description || `Razorpay answered ${res.status}.`, res.status, error?.code)
  }
  return data as T
}

const id = (value: string) => encodeURIComponent(value)

export interface RazorpayOrder {
  id: string
  amount: number
  currency: string
  status: string
}

export interface RazorpayPayment {
  id: string
  amount: number
  currency: string
  /** created, authorized, captured, refunded or failed. */
  status: string
  order_id: string | null
}

export interface RazorpaySubscription {
  id: string
  plan_id: string
  status: string
  current_start: number | null
  current_end: number | null
  notes?: unknown
}

export interface RazorpayPlan {
  id: string
  period: string
  interval: number
  item: { amount: number; currency: string }
}

export const razorpay = {
  createOrder: (
    config: RazorpayConfig,
    input: { amount: number; currency: string; receipt: string; notes: Record<string, string> }
  ) => call<RazorpayOrder>(config, 'POST', '/orders', input),

  fetchPayment: (config: RazorpayConfig, paymentId: string) =>
    call<RazorpayPayment>(config, 'GET', `/payments/${id(paymentId)}`),

  capturePayment: (config: RazorpayConfig, paymentId: string, input: { amount: number; currency: string }) =>
    call<RazorpayPayment>(config, 'POST', `/payments/${id(paymentId)}/capture`, input),

  fetchPlan: (config: RazorpayConfig, planId: string) => call<RazorpayPlan>(config, 'GET', `/plans/${id(planId)}`),

  createSubscription: (
    config: RazorpayConfig,
    input: { plan_id: string; total_count: number; quantity: number; notes: Record<string, string> }
  ) => call<RazorpaySubscription>(config, 'POST', '/subscriptions', input),

  fetchSubscription: (config: RazorpayConfig, subscriptionId: string) =>
    call<RazorpaySubscription>(config, 'GET', `/subscriptions/${id(subscriptionId)}`),

  cancelSubscription: (config: RazorpayConfig, subscriptionId: string, input: { cancel_at_cycle_end: boolean }) =>
    call<RazorpaySubscription>(config, 'POST', `/subscriptions/${id(subscriptionId)}/cancel`, input),
}

/** Razorpay ids arrive from the browser, so they are checked before they reach a URL or a query. */
export const RAZORPAY_ID = {
  order: /^order_[A-Za-z0-9]{6,40}$/,
  payment: /^pay_[A-Za-z0-9]{6,40}$/,
  subscription: /^sub_[A-Za-z0-9]{6,40}$/,
}
