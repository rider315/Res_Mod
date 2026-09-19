import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { freeTailorings, razorpayConfig, tiersOnSale } from '@/lib/billing/config'
import { getPlatformAi } from '@/lib/billing/platform-ai'
import JsonLd from '@/components/brand/JsonLd'
import { organizationSchema, softwareSchema } from '@/lib/seo'
import { PRO_PLAN } from '@/lib/billing/plans'
import LoginPage from './LoginPage'

export default async function Home({ searchParams }: { searchParams: { deleted?: string } }) {
  const session = await getServerSession(authOptions)
  if (session) redirect('/dashboard')
  const platform = await getPlatformAi()
  // Premium shows as "Coming soon" until there is a plan at Razorpay to charge
  // against. One environment variable opens it everywhere at once.
  const onSale = platform ? tiersOnSale(razorpayConfig()) : []
  return (
    <>
      <JsonLd data={[organizationSchema(), softwareSchema({ priceFrom: PRO_PLAN.pricePaise })]} />
      <LoginPage
      freeTailorings={platform ? freeTailorings() : null}
      premiumOnSale={onSale.includes('premium')}
        accountDeleted={searchParams.deleted === '1'}
      />
    </>
  )
}
