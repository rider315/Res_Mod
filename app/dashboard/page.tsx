import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { getAccess } from '@/lib/access'
import Dashboard from '@/components/Dashboard'
import UserDashboard from '@/components/user/UserDashboard'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/')

  // The resume profiles are the owner's; every other account gets its own
  // dashboard for importing and managing its resumes.
  if (getAccess(session)?.role !== 'owner') {
    return <UserDashboard name={session.user?.name ?? ''} email={session.user?.email ?? ''} />
  }
  return <Dashboard />
}
