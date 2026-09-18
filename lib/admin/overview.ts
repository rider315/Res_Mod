import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { freeTailorings, razorpayConfig } from '@/lib/billing/config'
import { checkPlan } from '@/lib/billing/plan-check'
import { getPlatformAiStatus } from '@/lib/billing/platform-ai'
import { formatPrice, PAID_TIERS, TIERS } from '@/lib/billing/plans'
import { buckets } from '@/lib/billing/quota'
import { getProvider } from '@/lib/providers'
import type { AdminOverview, SetupCheck } from '@/lib/admin/types'

/**
 * The owner's Business overview: a checklist of what the business needs set up,
 * with what to do about anything missing, and the accounts, subscriptions and
 * payments across every user. Never shows a secret.
 */

type Row = Record<string, unknown>

const rowsOf = (result: { rows: unknown[] }) => result.rows as Row[]
const num = (value: unknown) => Number(value ?? 0)
const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null)

/** Chills AI failures older than this don't color the checklist; AI settings still lists them. */
const RECENT_FAILURE_MS = 24 * 60 * 60 * 1000

/** A webhook secret shorter than this is easy enough to guess to be worth replacing. */
const STRONG_SECRET_LENGTH = 24

async function setupChecks(): Promise<SetupCheck[]> {
  const checks: SetupCheck[] = []

  const ai = await getPlatformAiStatus()
  if (ai.overriddenByEnv) {
    checks.push({ label: 'Chills AI', state: 'ok', detail: 'Set by PLATFORM_AI_* variables on this server.' })
  } else if (ai.current && ai.working) {
    const provider = getProvider(ai.current.provider)
    const runsOn = `Users run on ${provider.label}${ai.current.model ? ` · ${ai.current.model}` : ''}.`
    const recent = ai.recentFailures.filter((failure) => Date.now() - Date.parse(failure.at) < RECENT_FAILURE_MS)
    if (recent.length === 0) {
      checks.push({ label: 'Chills AI', state: 'ok', detail: runsOn })
    } else {
      const refused = recent.find((failure) => failure.kind === 'setup')
      checks.push({
        label: 'Chills AI',
        state: refused ? 'missing' : 'warn',
        detail: [
          runsOn,
          `${recent.length === 1 ? '1 request' : `${recent.length} requests`} failed on it in the last day.`,
          refused
            ? `The provider refused one, which keeps happening until it's fixed: “${refused.message}”`
            : `Latest: “${recent[0].message}”`,
          'Details in AI settings.',
        ].join(' '),
      })
    }
  } else if (ai.current) {
    checks.push({
      label: 'Chills AI',
      state: 'missing',
      detail: "Saved, but it can't run, so users can't import or tailor. Save the key again in AI settings.",
    })
  } else {
    checks.push({
      label: 'Chills AI',
      state: 'missing',
      detail: `Not set, so users can't import or tailor, and nothing can be bought. Open AI settings → "Chills AI for your users".`,
    })
  }

  const config = razorpayConfig()
  if (!config) {
    checks.push({ label: 'Razorpay keys', state: 'missing', detail: 'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not set in Vercel.' })
  } else {
    checks.push(
      config.testMode
        ? { label: 'Razorpay keys', state: 'warn', detail: 'Test mode keys: no real money moves.' }
        : { label: 'Razorpay keys', state: 'ok', detail: 'Live mode keys: payments are real.' }
    )

    if (!config.webhookSecret) {
      checks.push({
        label: 'Razorpay webhook',
        state: 'missing',
        detail: 'RAZORPAY_WEBHOOK_SECRET is not set, so renewals and payments made while the browser was closed are not recorded.',
      })
    } else {
      const [row] = rowsOf(await getDb().execute(sql`select max(received_at) as last from webhook_events`))
      const last = iso(row?.last)
      const weak = config.webhookSecret.length < STRONG_SECRET_LENGTH
      checks.push({
        label: 'Razorpay webhook',
        state: weak || !last ? 'warn' : 'ok',
        detail: [
          weak ? 'The secret is short and easy to guess: replace it with a long random one, in Razorpay and in Vercel.' : null,
          last ? `Last delivery ${last.slice(0, 16).replace('T', ' ')} UTC.` : 'No delivery received yet; they start with the first payment.',
        ]
          .filter(Boolean)
          .join(' '),
      })
    }

    // Each tier has its own plan in the Dashboard, so each is reported on its own:
    // Premium simply isn't offered until its plan exists, which is not a fault.
    for (const tier of PAID_TIERS) {
      const spec = TIERS[tier]
      const label = `${spec.label} plan`
      if (!config.planIds[tier]) {
        checks.push({ label, state: 'missing', detail: `${spec.envPlanId} is not set, so ${spec.label} is not offered.` })
        continue
      }
      try {
        const plan = await checkPlan(config, tier)
        checks.push(
          plan.ok
            ? { label, state: 'ok', detail: `${formatPrice(spec.pricePaise)} a month, matching Razorpay.` }
            : { label, state: 'missing', detail: plan.problem ?? 'The plan does not match.' }
        )
      } catch {
        checks.push({ label, state: 'warn', detail: "Razorpay couldn't be reached to check the plan. Refresh in a moment." })
      }
    }
  }

  const contact = process.env.CONTACT_EMAIL?.trim()
  checks.push(
    contact
      ? { label: 'Contact email', state: 'ok', detail: `${contact} is shown on the Contact page.` }
      : { label: 'Contact email', state: 'missing', detail: 'CONTACT_EMAIL is not set in Vercel, so the Contact page has no address. Razorpay expects one.' }
  )
  const free = freeTailorings()
  checks.push({
    label: 'Free tailorings',
    state: 'ok',
    detail: `${free} for every account, once. After that, Pro or a credit pack.`,
  })
  return checks
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const db = getDb()
  const [checks, totals, subscriptionRows, paymentRows] = await Promise.all([
    setupChecks(),
    db.execute(sql`select
      (select count(*)::int from users where email not like 'deleted+%') as users,
      (select count(*)::int from users where email not like 'deleted+%' and created_at >= date_trunc('month', now())) as new_users,
      (select count(*)::int from resumes where user_id is not null) as resumes,
      (select count(*)::int from tailorings) as tailorings,
      (select coalesce(sum(used), 0)::int from usage_counters where bucket = ${buckets.freeTailorings()}) as free_used,
      (select count(*)::int from usage_counters
        where bucket = ${buckets.freeTailorings()} and used >= ${Math.max(1, freeTailorings())}) as free_finished,
      (select coalesce(-sum(delta), 0)::int from credit_ledger
        where reason in ('run', 'refund') and created_at >= date_trunc('month', now())) as credits_spent,
      (select coalesce(sum(balance), 0)::int from credit_balances) as credits_outstanding,
      (select count(*)::int from subscriptions where status in ('active', 'pending')) as active_subscriptions,
      (select coalesce(sum(amount), 0)::bigint from payments
        where currency = 'INR' and created_at >= date_trunc('month', now())) as revenue_month,
      (select coalesce(sum(amount), 0)::bigint from payments where currency = 'INR') as revenue_total`),
    db.execute(sql`
      select s.id, s.status, s.current_end, s.cancel_at_cycle_end, s.created_at, u.email
      from subscriptions s left join users u on u.id = s.user_id
      where s.status <> 'created'
      order by s.created_at desc limit 50`),
    db.execute(sql`
      select p.id, p.kind, p.amount, p.currency, p.created_at, u.email
      from payments p left join users u on u.id = p.user_id
      order by p.created_at desc limit 25`),
  ])

  const total = rowsOf(totals)[0] ?? {}
  return {
    checks,
    numbers: {
      users: num(total.users),
      newUsersThisMonth: num(total.new_users),
      resumes: num(total.resumes),
      tailorings: num(total.tailorings),
      freeTailoringsUsed: num(total.free_used),
      accountsOutOfFree: num(total.free_finished),
      creditsSpentThisMonth: num(total.credits_spent),
      creditsOutstanding: num(total.credits_outstanding),
      activeSubscriptions: num(total.active_subscriptions),
      revenueThisMonthPaise: num(total.revenue_month),
      revenueTotalPaise: num(total.revenue_total),
    },
    subscriptions: rowsOf(subscriptionRows).map((row) => ({
      id: String(row.id),
      email: (row.email as string | null) ?? null,
      status: String(row.status),
      currentEnd: iso(row.current_end),
      cancelAtCycleEnd: Boolean(row.cancel_at_cycle_end),
      createdAt: iso(row.created_at),
    })),
    payments: rowsOf(paymentRows).map((row) => ({
      id: String(row.id),
      email: (row.email as string | null) ?? null,
      kind: String(row.kind),
      amount: num(row.amount),
      currency: String(row.currency),
      createdAt: iso(row.created_at),
    })),
  }
}
