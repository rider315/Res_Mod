import Link from 'next/link'
import PolicyPage from '@/components/PolicyPage'
import { CheckCircle } from '@/components/brand/Icons'
import { freeTailorings, razorpayConfig, tiersOnSale } from '@/lib/billing/config'
import {
  CREDIT_PACKS,
  EMAIL_DRAFTS_PER_MONTH,
  EMAIL_SENDS_PER_DAY,
  formatPrice,
  IMPORTS_PER_MONTH,
  PREMIUM_PLAN,
  PRO_PLAN,
} from '@/lib/billing/plans'
import { DAILY_AI_REQUESTS } from '@/lib/billing/quota'
import JsonLd from '@/components/brand/JsonLd'
import { absolute, breadcrumbSchema } from '@/lib/seo'

export const metadata = {
  title: 'Pricing | Chills',
  description:
    'What Chills costs: three free tailorings for every account, then Pro at a monthly price or one-time credit packs that never expire. Prices in rupees.',
  alternates: { canonical: absolute('/pricing') },
}

function Points({ items }: { items: string[] }) {
  return (
    <ul className="mt-6 space-y-3 text-[var(--color-text)]">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2.5">
          <CheckCircle size={20} className="text-[var(--color-success)] shrink-0 mt-0.5" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

/** The prices change with what Razorpay has a plan for, so nothing here may be cached. */
export const dynamic = 'force-dynamic'

export default function Pricing() {
  const free = freeTailorings()
  // "Coming soon" is a fact about the Razorpay account, not a line to keep in
  // the markup: the day a plan exists for Premium, this page has to stop saying it.
  const premiumOnSale = tiersOnSale(razorpayConfig()).includes('premium')

  return (
    <PolicyPage
      title="Pricing"
      wide
      intro={
        <>
          A <strong className="text-[var(--color-text)]">tailoring</strong> tailors one of your resumes to one job description, at any
          level, with a cover letter to match. Every account gets {free} free. After that, keep going with Pro or a credit pack, and get
          either whenever you like, even before your free tailorings are used up.
        </>
      }
    >
      <JsonLd data={breadcrumbSchema([{ name: 'Chills', path: '/' }, { name: 'Pricing', path: '/pricing' }])} />

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 items-stretch">
        <div className="nb-card p-7 flex flex-col">
          <h2 className="text-xl font-extrabold text-[var(--color-text)]">Free</h2>
          <p className="mt-3 text-4xl font-black text-[var(--color-text)]">₹0</p>
          <Points
            items={[
              `${free} tailorings, once for every account`,
              'A cover letter for each one',
              `${EMAIL_DRAFTS_PER_MONTH.free} AI-written recruiter emails a month`,
              'Email any recruiter you add yourself',
              `${IMPORTS_PER_MONTH.free} resume imports a month`,
              'Keyword finder and match check',
              'Tailoring history and PDF downloads',
            ]}
          />
        </div>

        <div className="nb-card p-7 flex flex-col md:-translate-y-2 border-[3px] shadow-[6px_6px_0_0_#0a0a0a]">
          <h2 className="text-xl font-extrabold text-[var(--color-text)]">{PRO_PLAN.label}</h2>
          <p className="mt-3 text-[var(--color-text)]">
            <span className="text-4xl font-black">{formatPrice(PRO_PLAN.pricePaise)}</span>
            <span className="text-[var(--color-text-muted)]"> / month</span>
          </p>
          <Points
            items={[
              `${PRO_PLAN.runsPerCycle} tailorings every month`,
              'A cover letter for each one',
              `${EMAIL_DRAFTS_PER_MONTH.paid} AI-written recruiter emails a month`,
              'A fresh list of recruiters every week, yours to take from',
              `${IMPORTS_PER_MONTH.paid} resume imports a month`,
              'Renews monthly; cancel any time',
            ]}
          />
        </div>

        <div className="nb-card p-7 flex flex-col">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-xl font-extrabold text-[var(--color-text)]">{PREMIUM_PLAN.label}</h2>
            {!premiumOnSale && <span className="nb-chip bg-[var(--color-yellow)] text-[#0a0a0a] whitespace-nowrap">Coming soon</span>}
          </div>
          <p className={`mt-3 ${premiumOnSale ? 'text-[var(--color-text)]' : 'text-[var(--color-text-faint)]'}`}>
            <span className="text-4xl font-black">{formatPrice(PREMIUM_PLAN.pricePaise)}</span>
            <span className="text-[var(--color-text-muted)]"> / month</span>
          </p>
          {!premiumOnSale && (
            <p className="mt-2 text-sm font-semibold text-[var(--color-text-muted)]">Not on sale yet — this is what it will do.</p>
          )}
          <Points
            items={[
              `${PREMIUM_PLAN.appliesPerCycle} complete applications a month`,
              'Chills reads the posting you point it at',
              'Resume and recruiter email from that one reading',
              `Everything in ${PRO_PLAN.label} — an application spends one of those same tailorings`,
              'Every email still waits for you to send it',
            ]}
          />
        </div>

        <div className="nb-card p-7 flex flex-col">
          <h2 className="text-xl font-extrabold text-[var(--color-text)]">Credit packs</h2>
          <div className="mt-4 space-y-2">
            {CREDIT_PACKS.map((pack) => (
              <div key={pack.id} className="flex items-center justify-between gap-3 nb-card-flat px-3 py-2 bg-[var(--color-yellow-soft)]">
                <span className="font-bold text-[var(--color-text)]">{pack.runs} tailorings</span>
                <span className="font-black text-[var(--color-text)]">{formatPrice(pack.pricePaise)}</span>
              </div>
            ))}
          </div>
          <Points
            items={[
              'A one-time payment',
              'Credits never expire',
              'Used after your Pro and free tailorings',
              `While you have credits, ${EMAIL_DRAFTS_PER_MONTH.paid} AI-written recruiter emails a month`,
              'And the weekly recruiter list, while they last',
            ]}
          />
        </div>
      </div>

      <div className="nb-card p-6 bg-[var(--color-yellow-soft)] text-[var(--color-text)]">
        <p>
          Prices are in Indian rupees, and payments are processed by Razorpay. A tailoring that fails without producing any changes is not
          counted. Every account can make up to {DAILY_AI_REQUESTS} AI requests a day, to keep the service fair. Recruiter emails are sent
          from your own mailbox and cost nothing to send, up to {EMAIL_SENDS_PER_DAY} a day so your address stays clear of spam filters;
          you can always write and send emails yourself, without the AI. Cancellation and refunds
          are covered in the{' '}
          <Link href="/refunds" className="font-bold underline underline-offset-4">
            Cancellation and Refund Policy
          </Link>
          .
        </p>
      </div>
    </PolicyPage>
  )
}
