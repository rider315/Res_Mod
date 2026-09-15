import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/require-auth'
import { getBillingStatus } from '@/lib/billing/store'

export const dynamic = 'force-dynamic'

/** The signed-in account's included runs, credits, plan and payments. The owner has no limits. */
export async function GET() {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  if (auth.role === 'owner') return NextResponse.json({ role: 'owner' })
  if (!auth.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  try {
    return NextResponse.json(await getBillingStatus(auth.userId))
  } catch (err) {
    console.error('[billing]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Billing details could not be loaded right now.' }, { status: 500 })
  }
}
