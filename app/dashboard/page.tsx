import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { getAccess } from '@/lib/access'
import Dashboard from '@/components/Dashboard'
import UserDashboard from '@/components/user/UserDashboard'

export default async function DashboardPage({ searchParams }: { searchParams: { workspace?: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/')

  // The resume profiles are the owner's; every other account gets the workspace
  // for importing and tailoring its own resumes. The owner can open that
  // workspace too, to use it or to see what users see.
  const owner = getAccess(session)?.role === 'owner'
  if (!owner || searchParams.workspace === 'user') {
    return <UserDashboard name={session.user?.name ?? ''} email={session.user?.email ?? ''} isOwner={owner} />
  }
  return <Dashboard />
}
