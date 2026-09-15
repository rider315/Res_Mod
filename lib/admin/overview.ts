import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { freeRunsPerMonth, razorpayConfig } from '@/lib/billing/config'
import { checkProPlan } from '@/lib/billing/plan-check'
import { getPlatformAiStatus } from '@/lib/billing/platform-ai'
import { formatPrice, PRO_PLAN } from '@/lib/billing/plans'
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

/** A webhook secret shorter than this is easy enough to guess to be worth replacing. */
const STRONG_SECRET_LENGTH = 24

async function setupChecks(): Promise<SetupCheck[]> {
  const checks: SetupCheck[] = []

  const ai = await getPlatformAiStatus()
  if (ai.overriddenByEnv) {
    checks.push({ label: 'ResMod AI', state: 'ok', detail: 'Set by PLATFORM_AI_* variables on this server.' })
  } else if (ai.current && ai.working) {
    const provider = getProvider(ai.current.provider)
    checks.push({ label: 'ResMod AI', state: 'ok', detail: `Users run on ${provider.label}${ai.current.model ? ` · ${ai.current.model}` : ''}.` })
  } else if (ai.current) {
    checks.push({ label: 'ResMod AI', state: 'missing', detail: "Saved, but it can't run. Save the key again in AI settings." })
  } else {
    checks.push({
      label: 'ResMod AI',
      state: 'missing',
      detail: 'Not set, so users have no included runs and nothing to buy. Open AI settings → "ResMod AI for your users".',
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

    if (!config.proPlanId) {
      checks.push({ label: 'Pro plan', state: 'missing', detail: 'RAZORPAY_PRO_PLAN_ID is not set, so Pro is not offered.' })
    } else {
      try {
        const plan = await checkProPlan(config)
        checks.push(
          plan.ok
            ? { label: 'Pro plan', state: 'ok', detail: `${formatPrice(PRO_PLAN.pricePaise)} a month, matching Razorpay.` }
            : { label: 'Pro plan', state: 'missing', detail: plan.problem ?? 'The plan does not match.' }
        )
      } catch {
        checks.push({ label: 'Pro plan', state: 'warn', detail: "Razorpay couldn't be reached to check the plan. Refresh in a moment." })
      }
    }
  }

  const contact = process.env.CONTACT_EMAIL?.trim()
  checks.push(
    contact
      ? { label: 'Contact email', state: 'ok', detail: `${contact} is shown on the Contact page.` }
      : { label: 'Contact email', state: 'missing', detail: 'CONTACT_EMAIL is not set in Vercel, so the Contact page has no address. Razorpay expects one.' }
  )
  checks.push({ label: 'Free runs', state: 'ok', detail: `${freeRunsPerMonth()} a month for every account.` })
  return checks
}

export async function getAdminOverview(now = new Date()): Promise<AdminOverview> {
  const db = getDb()
  const [checks, totals, subscriptionRows, paymentRows] = await Promise.all([
    setupChecks(),
    db.execute(sql`select
      (select count(*)::int from users where email not like 'deleted+%') as users,
      (select count(*)::int from users where email not like 'deleted+%' and created_at >= date_trunc('month', now())) as new_users,
      (select count(*)::int from resumes where user_id is not null) as resumes,
      (select count(*)::int from tailorings) as tailorings,
      (select coalesce(sum(used), 0)::int from usage_counters where bucket = ${buckets.freeRuns(now)}) as free_runs,
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
      freeRunsUsedThisMonth: num(total.free_runs),
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
