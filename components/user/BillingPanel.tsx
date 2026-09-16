'use client'
import { useEffect, useState } from 'react'
import { formatPrice } from '@/lib/billing/plans'
import type { BillingStatus, CheckoutStart } from '@/lib/billing/types'
import {
  fetchBilling,
  formatDate,
  formatDay,
  payWithCheckout,
  postBilling,
  tailorings,
} from '@/components/user/billing-client'
import { errorBox, primaryButton, secondaryButton } from '@/components/user/shared'

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

const card = 'bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-5'
const warningBox =
  'rounded-xl border border-[var(--color-warning)] bg-[var(--color-warning-highlight)] p-3 text-sm text-[var(--color-warning)]'
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
      <button onClick={onBack} className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
        ← Back
      </button>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Plans</h1>
        {billing?.checkout.testMode && (
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[var(--color-warning-highlight)] text-[var(--color-warning)]">
            Test mode
          </span>
        )}
      </div>
      <p className="text-sm text-[var(--color-text-muted)] mt-1">
        Every account gets {billing ? billing.runs.free.limit : 'a few'} free tailorings. After that, keep
        tailoring with Pro or a credit pack, and you can get either at any time.
      </p>
    </div>
  )

  if (!billing) {
    return (
      <div className="space-y-6 anim-page-enter">
        {header}
        {billing === null || loadFailed ? (
          <div className={errorBox}>
            Billing details could not be loaded.{' '}
            <button onClick={reload} className="underline font-medium">
              Try again
            </button>
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
        )}
      </div>
    )
  }

  const { runs, imports, subscription, checkout: available } = billing
  const importsLeft = Math.max(0, imports.limit - imports.used)
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
    <div className="space-y-6 anim-page-enter">
      {header}

      {notice && (
        <div className="rounded-xl border border-[var(--color-success)] bg-[var(--color-success-highlight)] p-3 text-sm text-[var(--color-success)]">
          {notice}
        </div>
      )}
      {error && <div className={errorBox}>{error}</div>}

      {!billing.platformAi ? (
        <div className={card}>
          <p className="text-sm font-semibold text-[var(--color-text)]">Tailoring isn&apos;t available yet</p>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Importing and tailoring resumes aren&apos;t switched on right now, so plans can&apos;t be bought yet. Please
            check back soon.
          </p>
        </div>
      ) : (
        <>
          <section className={card}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Tailorings left</h2>
              <p className="text-3xl font-bold text-[var(--color-text)] tabular-nums">{runs.left}</p>
            </div>
            <div className="mt-3 divide-y divide-[var(--color-divider)]">
              {runs.subscription && (
                <Row
                  label="Pro this month"
                  value={`${Math.max(0, runs.subscription.limit - runs.subscription.used)} of ${runs.subscription.limit}`}
                  note={
                    subscription?.currentEnd
                      ? `${subscription.cancelAtCycleEnd ? 'Ends' : 'Renews'} on ${formatDay(subscription.currentEnd)}`
                      : undefined
                  }
                />
              )}
              <Row
                label="Free tailorings"
                value={`${Math.max(0, runs.free.limit - runs.free.used)} of ${runs.free.limit}`}
                note="Given once to every account"
              />
              <Row label="Credits" value={String(runs.credits)} note="Never expire · used after Pro and free tailorings" />
              <Row
                label="Resume imports this month"
                value={`${importsLeft} of ${imports.limit}`}
                note={`Free · starts again on ${formatDay(imports.resetsAt)}`}
              />
            </div>
          </section>

          <section className={`${card} space-y-4`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--color-text)]">{billing.pro.label}</h2>
                <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
                  {billing.pro.runsPerCycle} tailorings every month. Get it now or once your free tailorings are used; cancel
                  any time.
                </p>
              </div>
              <p className="text-lg font-bold text-[var(--color-text)]">
                {formatPrice(billing.pro.pricePaise)}
                <span className="text-xs font-normal text-[var(--color-text-muted)]"> / month</span>
              </p>
            </div>

            {proState === 'active' && subscription && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-[var(--color-success)] font-medium">
                  Active{subscription.currentEnd ? ` · renews on ${formatDate(subscription.currentEnd)}` : ''}
                </p>
                <button onClick={cancel} disabled={busy !== null} className={secondaryButton}>
                  {busy?.kind === 'cancel' ? 'Cancelling…' : 'Cancel Pro'}
                </button>
              </div>
            )}
            {proState === 'ending' && subscription && (
              <p className="text-sm text-[var(--color-text-muted)]">
                Cancelled. Your Pro tailorings last{subscription.currentEnd ? ` until ${formatDate(subscription.currentEnd)}` : ' until this month ends'}, and it
                won&apos;t renew.
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
              <p className="text-sm text-[var(--color-text-muted)]">Payment received. Pro is being switched on…</p>
            )}
            {(proState === 'none' || proState === 'halted') && (
              <div className="space-y-3">
                {proState === 'halted' && (
                  <p className={warningBox}>Renewal payments failed, so Pro stopped. Subscribe again to get it back.</p>
                )}
                <button onClick={subscribe} disabled={busy !== null || !available.pro} className={primaryButton}>
                  {busy?.kind === 'pro' ? 'Opening checkout…' : `Get ${billing.pro.label}`}
                </button>
                {!available.pro && <p className="text-[11px] text-[var(--color-text-muted)]">Pro isn&apos;t available yet.</p>}
              </div>
            )}
          </section>

          <section className={card}>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Credit packs</h2>
            <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
              A one-time payment, if you&apos;d rather not subscribe. Credits never expire.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
              {billing.packs.map((pack) => (
                <div
                  key={pack.id}
                  className="rounded-xl border border-[var(--color-border)] p-4 flex items-center justify-between gap-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-text)]">{tailorings(pack.runs)}</p>
                    <p className="text-[11px] text-[var(--color-text-muted)]">
                      {formatPrice(Math.round(pack.pricePaise / pack.runs))} a tailoring
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
            {!available.packs && (
              <p className="text-[11px] text-[var(--color-text-muted)] mt-3">Payments aren&apos;t switched on yet.</p>
            )}
          </section>
        </>
      )}

      {billing.payments.length > 0 && (
        <section className={card}>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Payments</h2>
          <ul className="mt-2 divide-y divide-[var(--color-divider)] text-sm">
            {billing.payments.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-[var(--color-text)]">
                  {payment.kind === 'subscription' ? billing.pro.label : 'Credit pack'}
                  <span className="text-[var(--color-text-muted)]"> · {formatDate(payment.createdAt)}</span>
                </span>
                <span className="font-medium text-[var(--color-text)] tabular-nums">
                  {formatPrice(payment.amount, payment.currency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-[11px] text-[var(--color-text-faint)]">
        Payments are handled by Razorpay; ResMod never sees your card, UPI or bank details. Refunds and cancellation are
        covered in the{' '}
        <a href="/refunds" className="underline hover:text-[var(--color-text-muted)]">
          Cancellation and Refund Policy
        </a>
        ; for anything else,{' '}
        <a href="/contact" className="underline hover:text-[var(--color-text-muted)]">
          contact us
        </a>
        .
      </p>
    </div>
  )
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 text-sm">
      <div>
        <p className="text-[var(--color-text)]">{label}</p>
        {note && <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">{note}</p>}
      </div>
      <p className="font-semibold text-[var(--color-text)] tabular-nums whitespace-nowrap">{value}</p>
    </div>
  )
}
