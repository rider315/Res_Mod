import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { freeRunsPerMonth } from '@/lib/billing/config'
import { getPlatformAi } from '@/lib/billing/platform-ai'
import LoginPage from './LoginPage'

export default async function Home({ searchParams }: { searchParams: { deleted?: string } }) {
  const session = await getServerSession(authOptions)
  if (session) redirect('/dashboard')
  const platform = await getPlatformAi()
  return <LoginPage freeRuns={platform ? freeRunsPerMonth() : null} accountDeleted={searchParams.deleted === '1'} />
}
