import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { getAccess } from '@/lib/access'
import { ensureUser } from '@/lib/db/resumes'
import Dashboard from '@/components/Dashboard'
import UserDashboard from '@/components/user/UserDashboard'

/** The signed-in app: one person's resumes, nothing for a search engine. */
export const metadata = { robots: { index: false, follow: false } }

export default async function DashboardPage({ searchParams }: { searchParams: { workspace?: string; open?: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/')

  // The resume profiles are the owner's; every other account gets the workspace
  // for importing and tailoring its own resumes. The owner can open that
  // workspace too, to use it or to see what users see.
  const owner = getAccess(session)?.role === 'owner'
  if (!owner || searchParams.workspace === 'user') {
    // Landing here is the first thing every account does, so it is where "new"
    // can be told from "back again" — the one moment a signup is worth counting.
    // A database that can't be reached must never keep anyone out of their own
    // workspace, so a failure here just means the signup goes uncounted.
    let justSignedUp = false
    try {
      justSignedUp = (
        await ensureUser({ id: session.user?.id ?? '', email: session.user?.email ?? '', name: session.user?.name ?? null })
      ).created
    } catch {
      justSignedUp = false
    }
    return (
      <UserDashboard
        name={session.user?.name ?? ''}
        email={session.user?.email ?? ''}
        isOwner={owner}
        openKeywordFinder={searchParams.open === 'keywords'}
        openRecruiters={searchParams.open === 'outreach'}
        justSignedUp={justSignedUp}
      />
    )
  }
  return <Dashboard />
}
