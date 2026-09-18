import { NextRequest, NextResponse } from 'next/server'
import { LIMITS } from '@/lib/outreach/model'
import { directoryFields, latestBatch, listDirectory, takenThisWeek } from '@/lib/db/directory'
import { requireOutreachAccount } from '@/lib/outreach/server'

export const dynamic = 'force-dynamic'

/**
 * The recruiters Chills publishes, for an account with nobody of its own yet.
 *
 * Addresses are not in this answer. A contact's address is handed over only when
 * the account takes it, which is counted — otherwise the whole list could be
 * lifted by anyone who signed up, and the caps that keep it usable would mean
 * nothing.
 */
export async function GET(req: NextRequest) {
  const auth = await requireOutreachAccount()
  if (!auth.ok) return auth.response

  const params = req.nextUrl.searchParams
  const [entries, fields, newest, takenWeek] = await Promise.all([
    listDirectory(auth.userId, {
      field: params.get('field')?.trim() || undefined,
      search: params.get('q')?.trim().slice(0, 80) || undefined,
      newOnly: params.get('new') === '1',
      limit: Number(params.get('limit')) || 60,
      offset: Number(params.get('offset')) || 0,
    }),
    directoryFields(),
    latestBatch(),
    takenThisWeek(auth.userId),
  ])

  return NextResponse.json({
    entries,
    fields,
    latestBatch: newest,
    weeklyLeft: Math.max(0, LIMITS.directoryPerWeek - takenWeek),
    weeklyLimit: LIMITS.directoryPerWeek,
  })
}
