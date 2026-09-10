import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { getAccess } from '@/lib/access'
import Dashboard from '@/components/Dashboard'
import UserHome from '@/components/UserHome'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/')

  // The resume profiles are the owner's; every other account gets its own home
  // and never renders the owner dashboard.
  if (getAccess(session)?.role !== 'owner') {
    return <UserHome name={session.user?.name ?? ''} />
  }
  return <Dashboard />
}
