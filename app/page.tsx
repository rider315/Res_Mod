import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { freeRunsPerMonth, platformAiConfig } from '@/lib/billing/config'
import LoginPage from './LoginPage'

export default async function Home({ searchParams }: { searchParams: { deleted?: string } }) {
  const session = await getServerSession(authOptions)
  if (session) redirect('/dashboard')
  return (
    <LoginPage
      freeRuns={platformAiConfig() ? freeRunsPerMonth() : null}
      accountDeleted={searchParams.deleted === '1'}
    />
  )
}
