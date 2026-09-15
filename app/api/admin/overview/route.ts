import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/require-auth'
import { getAdminOverview } from '@/lib/admin/overview'

export const dynamic = 'force-dynamic'

/** The owner's Business overview: setup checklist, accounts, subscriptions and payments. */
export async function GET() {
  const auth = await requireOwner()
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json(await getAdminOverview())
  } catch (err) {
    console.error('[admin/overview]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'The overview could not be loaded right now.' }, { status: 500 })
  }
}
