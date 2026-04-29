import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import LoginPage from './LoginPage'

export default async function Home() {
  const session = await getServerSession(authOptions)
  if (session) redirect('/dashboard')
  return <LoginPage />
}