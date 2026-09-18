'use client'
import { useEffect, useState } from 'react'
import { useConfirm } from '@/components/ConfirmProvider'
import { EMAIL_DRAFTS_PER_MONTH, formatPrice, PaidTier, PAID_TIERS, TIERS } from '@/lib/billing/plans'
import { reportConversion } from '@/lib/analytics'
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
 * Plans for a regular account: the free tailorings every account gets once, the
 * subscriptions, and credit packs, all of which can be bought at any time.
 * Payments open Razorpay Checkout; the server verifies each one and answers with
 * the new balances, so this screen only ever shows what the server reports.
 *
 * Each tier gets the same card, filled from the server's own numbers. Premium's
 * card deliberately doesn't restate Pro's monthly tailorings: a complete
 * application spends one of those same runs, so printing the figure twice made
 * the dearer plan look like it included nothing extra.
 */

interface BillingPanelProps {
  /** undefined while loading; null when it couldn't be loaded. */
  billing: BillingStatus | null | undefined
  onBillingChange: (status: BillingStatus) => void
  onBack: () => void
}

type Busy = { kind: 'pack'; id: string } | { kind: 'tier'; tier: PaidTier } | { kind: 'cancel' } | null

const card = 'nb-card rounded-[10px] p-5'
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** What each plan is for, in its own terms. */
function planPoints(tier: PaidTier, spec: { label: string; runsPerCycle: number; appliesPerCycle: number }): string[] {
  if (tier === 'premium') {
    return [
      `${spec.appliesPerCycle} complete applications a month`,
      'Chills reads the posting you point it at',
      'Your resume and the recruiter email from that one reading',
      `Everything in ${TIERS.pro.label}; runs you don't apply with stay ordinary tailorings`,
      'Every email still waits for you to send it',
    ]
  }
  return [
    `${spec.runsPerCycle} tailorings every month`,
    'A cover letter for each one',
    `${EMAIL_DRAFTS_PER_MONTH.paid} AI-written recruiter emails a month`,
    'More resume imports each month',
    'Get it now or once your free tailorings are used; cancel any time',
  ]
}

export default function BillingPanel({ billing, onBillingChange, onBack }: BillingPanelProps) {
  const confirm = useConfirm()
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
      () => {
        const pack = billing?.packs.find((entry) => entry.id === packId)
        // In rupees, not paise: Google reads this as money.
        reportConversion('purchase', { value: pack ? pack.pricePaise / 100 : undefined, id: packId })
        setNotice(`${tailorings(runs)} added. Thank you!`)
      }
    )

  const subscribe = (tier: PaidTier) => {
    const label = TIERS[tier].label
    return checkout(
      { kind: 'tier', tier },
      () => postBilling<CheckoutStart>('/api/billing/subscribe', { tier }),
      async (status) => {
        reportConversion('purchase', { value: TIERS[tier].pricePaise / 100 })
        if (status.subscription?.entitled) return setNotice(`${label} is on. Thank you!`)
        setNotice(`Payment received. ${label} switches on as soon as Razorpay confirms it, usually within a minute.`)
        for (let attempt = 0; attempt < 12; attempt++) {
          await wait(5000)
          const latest = await reload()
          if (latest?.subscription?.entitled) return setNotice(`${label} is on. Thank you!`)
        }
      }
    )
  }

  async function cancel() {
    const label = billing?.subscription?.tier ? TIERS[billing.subscription.tier].label : 'your plan'
    const until = billing?.subscription?.currentEnd ? `until ${formatDate(billing.subscription.currentEnd)}` : 'until this cycle ends'
    const ok = await confirm({
      title: `Cancel ${label}?`,
      body: `You keep its runs ${until}, and it won’t renew after that.`,
      confirmLabel: `Cancel ${label}`,
      cancelLabel: `Keep ${label}`,
      danger: true,
    })
    if (!ok) return
    setBusy({ kind: 'cancel' })
    setError(null)
    setNotice(null)
    try {
      onBillingChange(await postBilling<BillingStatus>('/api/billing/cancel'))
      setNotice(`${label} is cancelled and won't renew.`)
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

  const { runs, applies, imports, emailDrafts, subscription, checkout: available } = billing
  const importsLeft = Math.max(0, imports.limit - imports.used)
  const draftsLeft = Math.max(0, emailDrafts.limit - emailDrafts.used)
  const heldState = !subscription
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
  // Only the plan actually in force shows its state; the other is simply on offer.
  const stateFor = (tier: PaidTier) => (subscription?.tier === tier ? heldState : 'none')
  const heldLabel = subscription?.tier ? TIERS[subscription.tier].label : TIERS.pro.label

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
                  <p className="text-sm text-[var(--color-text-muted)]">
                    Your plan is used first, then your free tailorings, then credits.
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
              {runs.subscription && (
                <Stat
                  label={`${heldLabel} this month`}
                  value={`${Math.max(0, runs.subscription.limit - runs.subscription.used)} of ${runs.subscription.limit}`}
                  note={
                    subscription?.currentEnd
                      ? `${subscription.cancelAtCycleEnd ? 'Ends' : 'Renews'} on ${formatDay(subscription.currentEnd)}`
                      : undefined
                  }
                />
              )}
              {applies && (
                <Stat
                  label="Complete applications"
                  value={`${Math.max(0, applies.limit - applies.used)} of ${applies.limit}`}
                  note="Each one also spends a run above"
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
            {PAID_TIERS.map((tier) => {
              const spec = billing.tiers[tier]
              const state = stateFor(tier)
              const onSale = available.tiers.includes(tier)
              const lead = tier === 'premium'
              return (
                <section
                  key={tier}
                  className={`${card} space-y-5 ${
                    state === 'none' && !lead ? 'border-[3px] shadow-[6px_6px_0_0_var(--color-ink)]' : ''
                  } ${lead ? 'bg-[var(--color-yellow-soft)]' : ''}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className={`nb-badge w-11 h-11 ${lead ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-yellow)]'}`}>
                        <Sparkles size={22} />
                      </span>
                      <h2 className="text-2xl font-black">{spec.label}</h2>
                      {!onSale && <span className="nb-chip bg-[var(--color-yellow)] text-[#0a0a0a]">Coming soon</span>}
                    </div>
                    <p>
                      <span className="text-4xl font-black">{formatPrice(spec.pricePaise)}</span>
                      <span className="text-[var(--color-text-muted)]"> / month</span>
                    </p>
                  </div>

                  {lead && (
                    <p className="text-sm text-[var(--color-text-muted)]">
                      The whole application in one run: you give a recruiter and the job they&apos;re hiring for, and Chills reads
                      that posting, tailors your resume to it, and writes the email from the same reading.
                    </p>
                  )}

                  <ul className="space-y-2.5">
                    {planPoints(tier, spec).map((point) => (
                      <li key={point} className="flex items-start gap-2.5">
                        <CheckCircle size={20} className="text-[var(--color-success)] shrink-0 mt-0.5" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>

                  {state === 'active' && subscription && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-accent-soft)] p-3">
                      <p className="font-bold text-[var(--color-success)]">
                        Active{subscription.currentEnd ? ` · renews on ${formatDate(subscription.currentEnd)}` : ''}
                      </p>
                      <button onClick={cancel} disabled={busy !== null} className={secondaryButton}>
                        {busy?.kind === 'cancel' ? 'Cancelling…' : `Cancel ${spec.label}`}
                      </button>
                    </div>
                  )}
                  {state === 'ending' && subscription && (
                    <p className={warningBox}>
                      Cancelled. Your {spec.label} runs last
                      {subscription.currentEnd ? ` until ${formatDate(subscription.currentEnd)}` : ' until this month ends'}, and it
                      won&apos;t renew.
                    </p>
                  )}
                  {state === 'retrying' && (
                    <div className="space-y-3">
                      <p className={warningBox}>
                        Your renewal payment didn&apos;t go through. Razorpay is retrying it, and your {spec.label} runs stay
                        meanwhile.
                      </p>
                      <button onClick={cancel} disabled={busy !== null} className={secondaryButton}>
                        {busy?.kind === 'cancel' ? 'Cancelling…' : `Cancel ${spec.label}`}
                      </button>
                    </div>
                  )}
                  {state === 'activating' && <p className={warningBox}>Payment received. {spec.label} is being switched on…</p>}
                  {(state === 'none' || state === 'halted') && (
                    <div className="space-y-3">
                      {state === 'halted' && (
                        <p className={warningBox}>
                          Renewal payments failed, so {spec.label} stopped. Subscribe again to get it back.
                        </p>
                      )}
                      <button
                        onClick={() => subscribe(tier)}
                        disabled={busy !== null || !onSale}
                        className={`w-full ${primaryButton} py-3.5 text-base`}
                      >
                        {busy?.kind === 'tier' && busy.tier === tier ? (
                          'Opening checkout…'
                        ) : (
                          <>
                            Get {spec.label} <ArrowRight size={18} />
                          </>
                        )}
                      </button>
                      {!onSale && (
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {spec.label} isn&apos;t on sale yet — nothing to buy here, and nothing has been charged for it.
                        </p>
                      )}
                    </div>
                  )}
                </section>
              )
            })}

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
                  <span className="font-bold">{payment.kind === 'subscription' ? heldLabel : 'Credit pack'}</span>
                  <span className="text-[var(--color-text-muted)]"> · {formatDate(payment.createdAt)}</span>
                </span>
                <span className="font-black tabular-nums">{formatPrice(payment.amount, payment.currency)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-[var(--color-text-faint)]">
        Payments are handled by Razorpay; Chills never sees your card, UPI or bank details. Refunds and cancellation are covered in the{' '}
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
