import Link from 'next/link'
import PolicyPage from '@/components/PolicyPage'
import { CheckCircle } from '@/components/brand/Icons'
import { freeTailorings } from '@/lib/billing/config'
import { CREDIT_PACKS, formatPrice, IMPORTS_PER_MONTH, PRO_PLAN } from '@/lib/billing/plans'
import { DAILY_AI_REQUESTS } from '@/lib/billing/quota'

export const metadata = {
  title: 'Pricing | ResMod',
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

export default function Pricing() {
  const free = freeTailorings()

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
      <div className="grid gap-6 md:grid-cols-3 items-stretch">
        <div className="nb-card p-7 flex flex-col">
          <h2 className="text-xl font-extrabold text-[var(--color-text)]">Free</h2>
          <p className="mt-3 text-4xl font-black text-[var(--color-text)]">₹0</p>
          <Points
            items={[
              `${free} tailorings, once for every account`,
              'A cover letter for each one',
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
              `${IMPORTS_PER_MONTH.paid} resume imports a month`,
              'Renews monthly; cancel any time',
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
          <Points items={['A one-time payment', 'Credits never expire', 'Used after your Pro and free tailorings']} />
        </div>
      </div>

      <div className="nb-card p-6 bg-[var(--color-yellow-soft)] text-[var(--color-text)]">
        <p>
          Prices are in Indian rupees, and payments are processed by Razorpay. A tailoring that fails without producing any changes is not
          counted. Every account can make up to {DAILY_AI_REQUESTS} AI requests a day, to keep the service fair. Cancellation and refunds
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
