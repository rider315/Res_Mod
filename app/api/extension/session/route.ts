import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/require-auth'
import { listResumes } from '@/lib/db/resumes'
import { loadQuota } from '@/lib/billing/store'
import { runsLeft } from '@/lib/billing/quota'

/**
 * What the extension needs before it can show anything: who it is speaking for,
 * which resumes it may tailor, and how much of the plan is left.
 *
 * This is also the extension's health check. A 401 here is how it learns its
 * token was revoked, and the panel says "connect again" rather than failing one
 * action at a time with no explanation.
 */
export async function GET() {
  const auth = await requireAuth({ allowExtension: true })
  if (!auth.ok) return auth.response

  try {
    const [resumes, quota] = await Promise.all([listResumes(auth.userId), loadQuota(auth.userId)])
    return NextResponse.json({
      email: auth.email,
      role: auth.role,
      resumes: resumes.map((resume) => ({ id: resume.id, title: resume.title })),
      quota: {
        runsLeft: runsLeft(quota.state),
        paying: quota.paying,
        tier: quota.tier,
      },
    })
  } catch (err) {
    console.error('[extension/session]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Chills could not be reached just now.' }, { status: 500 })
  }
}
