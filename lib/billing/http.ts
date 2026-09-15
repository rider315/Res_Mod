import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/require-auth'
import { RazorpayError } from '@/lib/billing/razorpay'

/** The billing routes are for regular accounts: the owner has no limits, so there is nothing to buy. */
export async function requireCustomer() {
  const auth = await requireAuth()
  if (!auth.ok) return auth
  if (!auth.userId) {
    return { ok: false as const, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }
  if (auth.role === 'owner') {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'The owner account has no limits, so there is nothing to buy.' }, { status: 400 }),
    }
  }
  return auth
}

/** A failed billing request: Razorpay's own reason when it refused, a generic one otherwise. */
export function billingFailure(route: string, err: unknown): NextResponse {
  if (err instanceof RazorpayError) {
    console.error(`[${route}] Razorpay ${err.status}${err.code ? ` ${err.code}` : ''}: ${err.message}`)
    return NextResponse.json({ error: `Razorpay: ${err.message}` }, { status: 502 })
  }
  console.error(`[${route}]`, err instanceof Error ? err.message : err)
  return NextResponse.json({ error: 'Something went wrong with billing. Try again in a moment.' }, { status: 500 })
}
