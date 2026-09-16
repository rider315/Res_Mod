import Link from 'next/link'
import PolicyPage from '@/components/PolicyPage'
import { freeTailorings } from '@/lib/billing/config'
import { CREDIT_PACKS, formatPrice, IMPORTS_PER_MONTH, PRO_PLAN } from '@/lib/billing/plans'
import { DAILY_AI_REQUESTS } from '@/lib/billing/quota'

export const metadata = {
  title: 'Pricing | ResMod',
}

const card = 'rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-3'
const price = 'text-2xl font-bold text-[var(--color-text)]'

export default function Pricing() {
  const free = freeTailorings()

  return (
    <PolicyPage title="Pricing">
      <p>
        A <strong className="text-[var(--color-text)]">tailoring</strong> tailors one of your resumes to one job
        description, at any level. Every account gets {free} free. After that, keep tailoring with Pro or a credit pack,
        and you can get either at any time, even before your free tailorings are used up.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={card}>
          <h2 className="text-lg font-semibold text-[var(--color-text)]">Free</h2>
          <p className={price}>₹0</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>{free} tailorings, once for every account</li>
            <li>{IMPORTS_PER_MONTH.free} resume imports a month</li>
            <li>Tailoring history and PDF downloads</li>
          </ul>
        </div>

        <div className={card}>
          <h2 className="text-lg font-semibold text-[var(--color-text)]">{PRO_PLAN.label}</h2>
          <p className={price}>
            {formatPrice(PRO_PLAN.pricePaise)}
            <span className="text-sm font-normal text-[var(--color-text-muted)]"> / month</span>
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>{PRO_PLAN.runsPerCycle} tailorings every month</li>
            <li>{IMPORTS_PER_MONTH.paid} resume imports a month</li>
            <li>Renews monthly; cancel any time</li>
          </ul>
        </div>

        <div className={card}>
          <h2 className="text-lg font-semibold text-[var(--color-text)]">Credit packs</h2>
          <ul className="space-y-1">
            {CREDIT_PACKS.map((pack) => (
              <li key={pack.id} className="flex justify-between gap-3">
                <span>{pack.runs} tailorings</span>
                <span className="font-semibold text-[var(--color-text)]">{formatPrice(pack.pricePaise)}</span>
              </li>
            ))}
          </ul>
          <p>A one-time payment. Credits never expire, and are used after your Pro and free tailorings.</p>
        </div>
      </div>

      <p>
        Prices are in Indian rupees, and payments are processed by Razorpay. A tailoring that fails without producing any
        changes is not counted. Every account can make up to {DAILY_AI_REQUESTS} AI requests a day, to keep the service
        fair. Cancellation and refunds are covered in the{' '}
        <Link href="/refunds" className="text-[var(--color-primary)] hover:underline">Cancellation and Refund Policy</Link>.
      </p>
    </PolicyPage>
  )
}
