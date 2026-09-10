import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'

/**
 * Liveness check for deploy verification and uptime monitors. It reports only
 * whether the database answers: no counts, no user data.
 */

// Otherwise Next would run this once at build time and serve the cached answer.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await getDb().execute(sql`select 1`)
    return NextResponse.json({ ok: true, database: 'ok' })
  } catch (err) {
    console.error('[health] database check failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, database: 'unreachable' }, { status: 503 })
  }
}
