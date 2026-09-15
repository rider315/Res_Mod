import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/require-auth'
import { listTailorings } from '@/lib/db/tailorings'

export const dynamic = 'force-dynamic'

/** The signed-in user's tailored copies, newest first, without their LaTeX. */
export async function GET() {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  if (!auth.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  try {
    return NextResponse.json({ tailorings: await listTailorings(auth.userId) })
  } catch (err) {
    console.error('[tailorings] list failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Your history could not be loaded right now.' }, { status: 500 })
  }
}
