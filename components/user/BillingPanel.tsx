'use client'
import { useEffect, useState } from 'react'
import { EMAIL_DRAFTS_PER_MONTH, formatPrice } from '@/lib/billing/plans'
import type { BillingStatus, CheckoutStart } from '@/lib/billing/types'
import {
  fetchBilling,
  formatDate,
  formatDay,
  payWithCheckout,
  postBilling,
  tailorings,
} from '@/components/user/billing-client'
import { ArrowLeft, ArrowRight, CheckCircle, Layers, Sparkles } from '@/components/brand/Icons'
import { backLinkClass, errorBox, primaryButton, secondaryButton, successBox, warningBox } from '@/components/user/shared'

/**
 * Plans for a regular account: the free tailorings every account gets once, Pro
 * and credit packs, both of which can be bought at any time. Payments open
 * Razorpay Checkout; the server verifies each one and answers with the new
 * balances, so this screen only ever shows what the server reports.
 */

interface BillingPanelProps {
  /** undefined while loading; null when it couldn't be loaded. */
  billing: BillingStatus | null | undefined
  onBillingChange: (status: BillingStatus) => void
  onBack: () => void
}

type Busy = { kind: 'pack'; id: string } | { kind: 'pro' } | { kind: 'cancel' } | null

const card = 'nb-card rounded-[10px] p-5'
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export default function BillingPanel({ billing, onBillingChange, onBack }: BillingPanelProps) {
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  async function reload(): Promise<BillingStatus | null> {
    try {
      const status = await fetchBilling()
      setLoadFailed(false)
      if (status.role !== 'user') return null
      onBillingChange(status)
      return status
    } catch {
      setLoadFailed(true)
      return null
    }
  }

  // Balances change elsewhere too (a webhook, another tab), so fetch fresh ones on open.
  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function checkout(
    label: NonNullable<Busy>,
    begin: () => Promise<CheckoutStart>,
    afterPayment: (status: BillingStatus) => Promise<void> | void
  ) {
    setBusy(label)
    setError(null)
    setNotice(null)
    try {
      const payment = await payWithCheckout(await begin())
      if (!payment) return
      const status = await postBilling<BillingStatus>('/api/billing/verify', payment)
      onBillingChange(status)
      await afterPayment(status)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  const buyPack = (packId: string, runs: number) =>
    checkout(
      { kind: 'pack', id: packId },
      () => postBilling<CheckoutStart>('/api/billing/order', { packId }),
      () => setNotice(`${tailorings(runs)} added. Thank you!`)
    )

  const subscribe = () =>
    checkout(
      { kind: 'pro' },
      () => postBilling<CheckoutStart>('/api/billing/subscribe'),
      async (status) => {
        if (status.subscription?.entitled) return setNotice('Pro is on. Thank you!')
        setNotice('Payment received. Pro switches on as soon as Razorpay confirms it, usually within a minute.')
        for (let attempt = 0; attempt < 12; attempt++) {
          await wait(5000)
          const latest = await reload()
          if (latest?.subscription?.entitled) return setNotice('Pro is on. Thank you!')
        }
      }
    )

  async function cancel() {
    const until = billing?.subscription?.currentEnd ? `until ${formatDate(billing.subscription.currentEnd)}` : 'until this cycle ends'
    if (!window.confirm(`Cancel Pro? You keep its runs ${until}, and it won't renew. This can't be undone.`)) return
    setBusy({ kind: 'cancel' })
    setError(null)
    setNotice(null)
    try {
      onBillingChange(await postBilling<BillingStatus>('/api/billing/cancel'))
      setNotice("Pro is cancelled and won't renew.")
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  const header = (
    <div>
      <button onClick={onBack} className={backLinkClass}>
        <ArrowLeft size={16} /> Back
      </button>
      <div className="flex flex-wrap items-center gap-3 mt-3">
        <h1 className="text-4xl sm:text-5xl font-black tracking-tight">
          <span className="nb-highlight">Plans</span>
        </h1>
        {billing?.checkout.testMode && <span className="nb-chip bg-[var(--color-yellow)] text-[#0a0a0a] uppercase">Test mode</span>}
      </div>
      <p className="mt-5 text-lg text-[var(--color-text-muted)] max-w-3xl">
        Every account gets {billing ? billing.runs.free.limit : 'a few'} free tailorings. After that, keep tailoring with Pro or a credit
        pack, and get either whenever you like, even before your free ones are used up.
      </p>
    </div>
  )

  if (!billing) {
    return (
      <div className="space-y-8 anim-page-enter">
        {header}
        {billing === null || loadFailed ? (
          <div className={errorBox}>
            Billing details could not be loaded.{' '}
            <button onClick={reload} className="underline font-bold">
              Try again
            </button>
          </div>
        ) : (
          <p className="text-sm font-semibold text-[var(--color-text-muted)]">Loading…</p>
        )}
      </div>
    )
  }

  const { runs, imports, emailDrafts, subscription, checkout: available } = billing
  const importsLeft = Math.max(0, imports.limit - imports.used)
  const draftsLeft = Math.max(0, emailDrafts.limit - emailDrafts.used)
  const proState = !subscription
    ? 'none'
    : subscription.status === 'authenticated'
      ? 'activating'
      : subscription.entitled
        ? subscription.cancelAtCycleEnd
          ? 'ending'
          : subscription.status === 'pending'
            ? 'retrying'
            : 'active'
        : subscription.status === 'halted'
          ? 'halted'
          : 'none'

  return (
    <div className="space-y-8 anim-page-enter">
      {header}

      {notice && <div className={successBox}>{notice}</div>}
      {error && <div className={errorBox}>{error}</div>}

      {!billing.platformAi ? (
        <div className={`${card} bg-[var(--color-yellow-soft)]`}>
          <p className="text-lg font-black">Tailoring isn&apos;t available yet</p>
          <p className="text-[var(--color-text-muted)] mt-1">
            Importing and tailoring resumes aren&apos;t switched on right now, so plans can&apos;t be bought yet. Please check back soon.
          </p>
        </div>
      ) : (
        <>
          <section className={`${card} bg-[var(--color-sky-soft)]`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <span className="nb-badge w-20 h-20 text-3xl bg-[var(--color-accent)] tabular-nums">{runs.left}</span>
                <div>
                  <h2 className="text-2xl font-black">{runs.left === 1 ? 'Tailoring' : 'Tailorings'} left</h2>
                  <p className="text-sm text-[var(--color-text-muted)]">Pro is used first, then your free tailorings, then credits.</p>
                </div>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
              {runs.subscription && (
                <Stat
                  label="Pro this month"
                  value={`${Math.max(0, runs.subscription.limit - runs.subscription.used)} of ${runs.subscription.limit}`}
                  note={
                    subscription?.currentEnd
                      ? `${subscription.cancelAtCycleEnd ? 'Ends' : 'Renews'} on ${formatDay(subscription.currentEnd)}`
                      : undefined
                  }
                />
              )}
              <Stat
                label="Free tailorings"
                value={`${Math.max(0, runs.free.limit - runs.free.used)} of ${runs.free.limit}`}
                note="Given once to every account"
              />
              <Stat label="Credits" value={String(runs.credits)} note="Never expire" />
              <Stat
                label="Resume imports"
                value={`${importsLeft} of ${imports.limit}`}
                note={`Free · starts again on ${formatDay(imports.resetsAt)}`}
              />
              <Stat
                label="AI recruiter emails"
                value={`${draftsLeft} of ${emailDrafts.limit}`}
                note={`Free · starts again on ${formatDay(emailDrafts.resetsAt)}`}
              />
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2 items-start">
            <section className={`${card} space-y-5 border-[3px] shadow-[6px_6px_0_0_var(--color-ink)]`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="nb-badge w-11 h-11 bg-[var(--color-yellow)]">
                    <Sparkles size={22} />
                  </span>
                  <h2 className="text-2xl font-black">{billing.pro.label}</h2>
                </div>
                <p>
                  <span className="text-4xl font-black">{formatPrice(billing.pro.pricePaise)}</span>
                  <span className="text-[var(--color-text-muted)]"> / month</span>
                </p>
              </div>
              <ul className="space-y-2.5">
                {[
                  `${billing.pro.runsPerCycle} tailorings every month`,
                  'A cover letter for each one',
                  `${EMAIL_DRAFTS_PER_MONTH.paid} AI-written recruiter emails a month`,
                  'More resume imports each month',
                  'Get it now or once your free tailorings are used; cancel any time',
                ].map((point) => (
                  <li key={point} className="flex items-start gap-2.5">
                    <CheckCircle size={20} className="text-[var(--color-success)] shrink-0 mt-0.5" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>

              {proState === 'active' && subscription && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-accent-soft)] p-3">
                  <p className="font-bold text-[var(--color-success)]">
                    Active{subscription.currentEnd ? ` · renews on ${formatDate(subscription.currentEnd)}` : ''}
                  </p>
                  <button onClick={cancel} disabled={busy !== null} className={secondaryButton}>
                    {busy?.kind === 'cancel' ? 'Cancelling…' : 'Cancel Pro'}
                  </button>
                </div>
              )}
              {proState === 'ending' && subscription && (
                <p className={warningBox}>
                  Cancelled. Your Pro tailorings last
                  {subscription.currentEnd ? ` until ${formatDate(subscription.currentEnd)}` : ' until this month ends'}, and it won&apos;t
                  renew.
                </p>
              )}
              {proState === 'retrying' && (
                <div className="space-y-3">
                  <p className={warningBox}>
                    Your renewal payment didn&apos;t go through. Razorpay is retrying it, and your Pro tailorings stay meanwhile.
                  </p>
                  <button onClick={cancel} disabled={busy !== null} className={secondaryButton}>
                    {busy?.kind === 'cancel' ? 'Cancelling…' : 'Cancel Pro'}
                  </button>
                </div>
              )}
              {proState === 'activating' && (
                <p className={warningBox}>Payment received. Pro is being switched on…</p>
              )}
              {(proState === 'none' || proState === 'halted') && (
                <div className="space-y-3">
                  {proState === 'halted' && (
                    <p className={warningBox}>Renewal payments failed, so Pro stopped. Subscribe again to get it back.</p>
                  )}
                  <button
                    onClick={subscribe}
                    disabled={busy !== null || !available.pro}
                    className={`w-full ${primaryButton} py-3.5 text-base`}
                  >
                    {busy?.kind === 'pro' ? (
                      'Opening checkout…'
                    ) : (
                      <>
                        Get {billing.pro.label} <ArrowRight size={18} />
                      </>
                    )}
                  </button>
                  {!available.pro && <p className="text-xs text-[var(--color-text-muted)]">Pro isn&apos;t available yet.</p>}
                </div>
              )}
            </section>

            <section className={`${card} space-y-4`}>
              <div className="flex items-center gap-3">
                <span className="nb-badge w-11 h-11 bg-[var(--color-accent)]">
                  <Layers size={22} />
                </span>
                <div>
                  <h2 className="text-2xl font-black">Credit packs</h2>
                  <p className="text-sm text-[var(--color-text-muted)]">A one-time payment, if you&apos;d rather not subscribe.</p>
                </div>
              </div>
              <div className="space-y-3">
                {billing.packs.map((pack) => (
                  <div
                    key={pack.id}
                    className="rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-yellow-soft)] p-4 flex items-center justify-between gap-3"
                  >
                    <div>
                      <p className="text-lg font-black">{tailorings(pack.runs)}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {formatPrice(Math.round(pack.pricePaise / pack.runs))} a tailoring · never expire
                      </p>
                    </div>
                    <button
                      onClick={() => buyPack(pack.id, pack.runs)}
                      disabled={busy !== null || !available.packs}
                      className={primaryButton}
                    >
                      {busy?.kind === 'pack' && busy.id === pack.id ? 'Opening…' : formatPrice(pack.pricePaise)}
                    </button>
                  </div>
                ))}
              </div>
              {!available.packs && <p className="text-xs text-[var(--color-text-muted)]">Payments aren&apos;t switched on yet.</p>}
            </section>
          </div>
        </>
      )}

      {billing.payments.length > 0 && (
        <section className={card}>
          <h2 className="text-xl font-black">Payments</h2>
          <ul className="mt-3 divide-y divide-[var(--color-divider)] text-sm">
            {billing.payments.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-3 py-2.5">
                <span>
                  <span className="font-bold">{payment.kind === 'subscription' ? billing.pro.label : 'Credit pack'}</span>
                  <span className="text-[var(--color-text-muted)]"> · {formatDate(payment.createdAt)}</span>
                </span>
                <span className="font-black tabular-nums">{formatPrice(payment.amount, payment.currency)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-[var(--color-text-faint)]">
        Payments are handled by Razorpay; ResMod never sees your card, UPI or bank details. Refunds and cancellation are covered in the{' '}
        <a href="/refunds" className="underline font-semibold hover:text-[var(--color-text-muted)]">
          Cancellation and Refund Policy
        </a>
        ; for anything else,{' '}
        <a href="/contact" className="underline font-semibold hover:text-[var(--color-text-muted)]">
          contact us
        </a>
        .
      </p>
    </div>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-surface)] p-3.5">
      <p className="text-xs font-black uppercase tracking-wider text-[var(--color-text-faint)]">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums">{value}</p>
      {note && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{note}</p>}
    </div>
  )
}
