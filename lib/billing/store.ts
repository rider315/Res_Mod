import { and, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { CREDIT_PACKS, CreditPack, EMAIL_SENDS_PER_DAY, PaidTier, TIERS } from '@/lib/billing/plans'
import {
  buckets,
  DAILY_AI_REQUESTS,
  draftLimit,
  importLimit,
  isPaying,
  nextDayStart,
  nextMonthStart,
  QuotaState,
  RunSource,
  runSources,
  runsLeft,
  subscriptionEntitles,
} from '@/lib/billing/quota'
import { freeTailorings, RazorpayConfig, razorpayConfig, tierForPlanId, tiersOnSale } from '@/lib/billing/config'
import { getPlatformAi } from '@/lib/billing/platform-ai'
import { razorpay } from '@/lib/billing/razorpay'
import { PaymentFacts, SubscriptionFacts, subscriptionFacts } from '@/lib/billing/events'
import type { BillingStatus } from '@/lib/billing/types'

/**
 * Billing data access.
 *
 * Every change to a run counter or a credit balance is a single SQL statement,
 * so two requests racing for an account's last run can't both get it. (Neon's
 * HTTP driver has no interactive transactions, and none are needed.)
 */

export type SubscriptionRow = typeof schema.subscriptions.$inferSelect
export type OrderRow = typeof schema.billingOrders.$inferSelect

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

function firstNumber(result: { rows: unknown[] }, column: string): number {
  return Number((result.rows[0] as Record<string, unknown> | undefined)?.[column] ?? 0)
}

// ─── Run counters and credits ────────────────────────────────────────────────

/** Take one from a counter, if it is still below `limit`. */
async function takeFromCounter(userId: string, bucket: string, limit: number): Promise<boolean> {
  if (limit <= 0) return false
  const result = await getDb().execute(sql`
    insert into usage_counters (user_id, bucket, used) values (${userId}, ${bucket}, 1)
    on conflict (user_id, bucket) do update
      set used = usage_counters.used + 1, updated_at = now()
      where usage_counters.used < ${limit}
    returning used`)
  return result.rows.length > 0
}

async function giveBackToCounter(userId: string, bucket: string): Promise<void> {
  await getDb().execute(sql`
    update usage_counters set used = used - 1, updated_at = now()
    where user_id = ${userId} and bucket = ${bucket} and used > 0`)
}

async function spendCredit(userId: string): Promise<boolean> {
  const result = await getDb().execute(sql`
    with spent as (
      update credit_balances set balance = balance - 1, updated_at = now()
      where user_id = ${userId} and balance > 0
      returning user_id
    ), entry as (
      insert into credit_ledger (user_id, delta, reason) select user_id, -1, 'run' from spent
    )
    select count(*)::int as spent from spent`)
  return firstNumber(result, 'spent') > 0
}

async function refundCredit(userId: string): Promise<void> {
  await getDb().execute(sql`
    with refunded as (
      update credit_balances set balance = balance + 1, updated_at = now()
      where user_id = ${userId}
      returning user_id
    )
    insert into credit_ledger (user_id, delta, reason) select user_id, 1, 'refund' from refunded`)
}

// ─── Subscriptions ───────────────────────────────────────────────────────────

export async function findSubscription(subscriptionId: string): Promise<SubscriptionRow | null> {
  const [row] = await getDb()
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subscriptionId))
    .limit(1)
  return row ?? null
}

/**
 * The subscription that matters for an account now: one whose runs can be used,
 * or else the newest that got past checkout. Abandoned checkouts never count.
 */
export async function currentSubscription(userId: string, now: Date): Promise<SubscriptionRow | null> {
  const rows = await getDb()
    .select()
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.userId, userId), ne(schema.subscriptions.status, 'created')))
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(10)
  return rows.find((row) => subscriptionEntitles(row, now)) ?? rows[0] ?? null
}

/** A Pro checkout the account opened recently and didn't finish, which Checkout can open again. */
export async function recentUnpaidSubscription(userId: string, planId: string, since: Date): Promise<SubscriptionRow | null> {
  const [row] = await getDb()
    .select()
    .from(schema.subscriptions)
    .where(
      and(
        eq(schema.subscriptions.userId, userId),
        eq(schema.subscriptions.planId, planId),
        eq(schema.subscriptions.status, 'created'),
        gte(schema.subscriptions.createdAt, since)
      )
    )
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(1)
  return row ?? null
}

export async function recordSubscription(input: { id: string; userId: string; planId: string; status: string }) {
  // Never synced yet, so any state fetched from Razorpay afterwards is newer. Stamping it with
  // the database's clock instead let a sync made a moment later by a server whose clock runs
  // behind look older, and be dropped: Pro stayed off until the webhook arrived.
  await getDb()
    .insert(schema.subscriptions)
    .values({ ...input, syncedAt: new Date(0) })
    .onConflictDoNothing()
}

/** Razorpay statuses in which a subscription can still charge, or be brought back to charging. */
const OPEN_STATUSES = ['authenticated', 'active', 'pending', 'halted', 'paused']

/** The account's subscriptions that haven't ended. Deleting the account cancels them. */
export async function openSubscriptions(userId: string): Promise<SubscriptionRow[]> {
  return getDb()
    .select()
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.userId, userId), inArray(schema.subscriptions.status, OPEN_STATUSES)))
}

export async function markCancelAtCycleEnd(subscriptionId: string) {
  await getDb()
    .update(schema.subscriptions)
    .set({ cancelAtCycleEnd: true })
    .where(eq(schema.subscriptions.id, subscriptionId))
}

const timestamp = (date: Date | null) => (date ? date.toISOString() : null)

/**
 * Store a subscription's state as Razorpay reported it at `asOf`. A state older
 * than the stored one is ignored, because webhooks can arrive out of order. A
 * subscription Chills has no row for is added when its notes name a known account.
 */
export async function saveSubscriptionState(facts: SubscriptionFacts, asOf: Date): Promise<void> {
  const updated = await getDb()
    .update(schema.subscriptions)
    .set({
      status: facts.status,
      planId: facts.planId,
      currentStart: facts.currentStart,
      currentEnd: facts.currentEnd,
      syncedAt: asOf,
    })
    .where(and(eq(schema.subscriptions.id, facts.id), lte(schema.subscriptions.syncedAt, asOf)))
    .returning({ id: schema.subscriptions.id })
  if (updated.length > 0 || !facts.userId) return

  await getDb().execute(sql`
    insert into subscriptions (id, user_id, plan_id, status, current_start, current_end, synced_at)
    select ${facts.id}::text, ${facts.userId}::text, ${facts.planId}::text, ${facts.status}::text,
      ${timestamp(facts.currentStart)}::timestamptz, ${timestamp(facts.currentEnd)}::timestamptz,
      ${asOf.toISOString()}::timestamptz
    where exists (select 1 from users where id = ${facts.userId})
    on conflict (id) do nothing`)
}

/** Fetch a subscription from Razorpay and store it. The time of the fetch orders it against webhooks. */
export async function syncSubscription(config: RazorpayConfig, subscriptionId: string): Promise<SubscriptionFacts> {
  const asOf = new Date()
  const facts = subscriptionFacts(await razorpay.fetchSubscription(config, subscriptionId))
  await saveSubscriptionState(facts, asOf)
  return facts
}

const RESYNC_EVERY_MS = 10 * 60 * 1000
const lastResync = new Map<string, number>()

/**
 * A plan still marked active after its cycle ended usually means a renewal
 * webhook hasn't arrived. Ask Razorpay directly, at most every ten minutes.
 */
async function refreshIfStale(row: SubscriptionRow | null, now: Date): Promise<SubscriptionRow | null> {
  if (!row?.currentEnd || row.currentEnd > now) return row
  if (row.status !== 'active' && row.status !== 'pending') return row
  const config = razorpayConfig()
  const lastTried = Math.max(row.syncedAt.getTime(), lastResync.get(row.id) ?? 0)
  if (!config || now.getTime() - lastTried < RESYNC_EVERY_MS) return row

  lastResync.set(row.id, now.getTime())
  try {
    await syncSubscription(config, row.id)
    return (await findSubscription(row.id)) ?? row
  } catch (err) {
    console.warn(`[billing] could not refresh subscription ${row.id}:`, message(err))
    return row
  }
}

// ─── Quota and reservations ──────────────────────────────────────────────────

export interface QuotaSnapshot {
  now: Date
  state: QuotaState
  subscription: SubscriptionRow | null
  /**
   * Which tier the plan in force is, read back from the Razorpay plan id the
   * subscription was created with. Null without a plan, and also when the plan
   * id no longer matches any tier — a plan retired in the Dashboard, say — in
   * which case the account keeps the lowest tier's allowance rather than none.
   */
  tier: PaidTier | null
  /** The subscription's runs can be used right now. */
  entitled: boolean
  /** The account has paid: a plan in force, or credits still on it (lib/billing/quota.ts). */
  paying: boolean
  /** The counter the plan's runs come from; null without a plan in force. */
  subscriptionBucket: string | null
  /** How many of this cycle's runs may still be complete applications; null unless the tier includes them. */
  applies: { used: number; limit: number } | null
  imports: { used: number; limit: number }
  emailDrafts: { used: number; limit: number }
  emailSends: { used: number; limit: number }
}

/** The plan's own allowance, never Pro's: a tier that included a different number used to get Pro's anyway. */
const runsForTier = (tier: PaidTier | null) => TIERS[tier ?? 'pro'].runsPerCycle

export async function loadQuota(userId: string, now = new Date()): Promise<QuotaSnapshot> {
  const subscription = await refreshIfStale(await currentSubscription(userId, now), now)
  const entitled = subscription ? subscriptionEntitles(subscription, now) : false
  const config = razorpayConfig()
  const tier = subscription && config ? tierForPlanId(config, subscription.planId) : null
  const subscriptionBucket =
    subscription && entitled ? buckets.subscriptionRuns(subscription.id, subscription.currentStart, now) : null
  const applyBucket =
    subscription && entitled && TIERS[tier ?? 'pro'].appliesPerCycle > 0
      ? buckets.applies(subscription.id, subscription.currentStart, now)
      : null
  const freeBucket = buckets.freeTailorings()
  const importBucket = buckets.imports(now)
  const draftBucket = buckets.emailDrafts(now)
  const sendBucket = buckets.emailSends(now)

  const [counters, balances] = await Promise.all([
    getDb()
      .select({ bucket: schema.usageCounters.bucket, used: schema.usageCounters.used })
      .from(schema.usageCounters)
      .where(
        and(
          eq(schema.usageCounters.userId, userId),
          inArray(schema.usageCounters.bucket, [
            freeBucket,
            importBucket,
            draftBucket,
            sendBucket,
            ...(subscriptionBucket ? [subscriptionBucket] : []),
            ...(applyBucket ? [applyBucket] : []),
          ])
        )
      ),
    getDb()
      .select({ balance: schema.creditBalances.balance })
      .from(schema.creditBalances)
      .where(eq(schema.creditBalances.userId, userId)),
  ])
  const used = (bucket: string) => counters.find((row) => row.bucket === bucket)?.used ?? 0
  const credits = balances[0]?.balance ?? 0

  return {
    now,
    state: {
      subscription: subscriptionBucket ? { used: used(subscriptionBucket), limit: runsForTier(tier) } : null,
      free: { used: used(freeBucket), limit: freeTailorings() },
      credits,
    },
    subscription,
    tier,
    entitled,
    paying: isPaying({ entitled, credits }),
    subscriptionBucket,
    applies: applyBucket ? { used: used(applyBucket), limit: TIERS[tier ?? 'pro'].appliesPerCycle } : null,
    imports: { used: used(importBucket), limit: importLimit(isPaying({ entitled, credits })) },
    emailDrafts: { used: used(draftBucket), limit: draftLimit(isPaying({ entitled, credits })) },
    emailSends: { used: used(sendBucket), limit: EMAIL_SENDS_PER_DAY },
  }
}

export interface Reservation {
  userId: string
  source: RunSource | 'import' | 'draft' | 'send' | 'ai'
  /** The counter it came from; null for a credit. */
  bucket: string | null
}

/** Take one included run from the first source with one left (see lib/billing/quota.ts). Null when there is none. */
export async function reserveRun(userId: string, loaded?: QuotaSnapshot): Promise<Reservation | null> {
  const quota = loaded ?? (await loadQuota(userId))
  for (const source of runSources(quota.state)) {
    // A source can run dry between reading the quota and taking from it; then the next is tried.
    if (source === 'subscription' && quota.subscriptionBucket) {
      if (await takeFromCounter(userId, quota.subscriptionBucket, quota.state.subscription?.limit ?? runsForTier(quota.tier))) {
        return { userId, source, bucket: quota.subscriptionBucket }
      }
    } else if (source === 'free') {
      const bucket = buckets.freeTailorings()
      if (await takeFromCounter(userId, bucket, quota.state.free.limit)) return { userId, source, bucket }
    } else if (source === 'credits') {
      if (await spendCredit(userId)) return { userId, source, bucket: null }
    }
  }
  return null
}

/** Why a complete application couldn't start: the plan, the applications left, or the runs left. */
export type ApplyRefusal = 'tier' | 'applies' | 'runs'

/**
 * Take one complete application: one from the cycle's applications, and one run
 * from wherever the account's next run would have come from anyway.
 *
 * Both or neither. The application is taken first because it is the scarcer of
 * the two and the one the plan is bought for; if no run can be found after it,
 * it goes straight back, so someone who has used every run isn't quietly charged
 * an application for a job that never ran.
 */
export async function reserveApply(userId: string): Promise<{ ok: true; reservations: Reservation[] } | { ok: false; reason: ApplyRefusal }> {
  const quota = await loadQuota(userId)
  if (!quota.applies || !quota.subscription) return { ok: false, reason: 'tier' }

  const bucket = buckets.applies(quota.subscription.id, quota.subscription.currentStart, quota.now)
  if (!(await takeFromCounter(userId, bucket, quota.applies.limit))) return { ok: false, reason: 'applies' }
  const apply: Reservation = { userId, source: 'subscription', bucket }

  const run = await reserveRun(userId, quota)
  if (!run) {
    await releaseReservation(apply)
    return { ok: false, reason: 'runs' }
  }
  return { ok: true, reservations: [apply, run] }
}

export async function reserveImport(userId: string): Promise<Reservation | null> {
  const quota = await loadQuota(userId)
  const bucket = buckets.imports(quota.now)
  return (await takeFromCounter(userId, bucket, quota.imports.limit)) ? { userId, source: 'import', bucket } : null
}

/** One recruiter email for the AI to write, from the month's allowance. Null when it is used up. */
export async function reserveEmailDraft(userId: string): Promise<Reservation | null> {
  const quota = await loadQuota(userId)
  const bucket = buckets.emailDrafts(quota.now)
  return (await takeFromCounter(userId, bucket, quota.emailDrafts.limit)) ? { userId, source: 'draft', bucket } : null
}

/** One recruiter email to send today. Null once today's sends are used up. */
export async function reserveEmailSend(userId: string, now = new Date()): Promise<Reservation | null> {
  const bucket = buckets.emailSends(now)
  return (await takeFromCounter(userId, bucket, EMAIL_SENDS_PER_DAY)) ? { userId, source: 'send', bucket } : null
}

/** Count an AI request toward the account's daily cap, whichever AI it runs on. Null once the cap is reached. */
export async function takeDailyAiRequest(userId: string, now = new Date()): Promise<Reservation | null> {
  const bucket = buckets.dailyAi(now)
  return (await takeFromCounter(userId, bucket, DAILY_AI_REQUESTS)) ? { userId, source: 'ai', bucket } : null
}

/** Give back what a reservation took, after the work it paid for failed. Never throws. */
export async function releaseReservation(reservation: Reservation): Promise<void> {
  try {
    if (reservation.source === 'credits') await refundCredit(reservation.userId)
    else if (reservation.bucket) await giveBackToCounter(reservation.userId, reservation.bucket)
  } catch (err) {
    console.error(`[billing] could not give back a ${reservation.source} run:`, message(err))
  }
}

// ─── Credit pack orders ──────────────────────────────────────────────────────

export async function recordOrder(order: { id: string; userId: string; pack: CreditPack; currency: string }) {
  await getDb().insert(schema.billingOrders).values({
    id: order.id,
    userId: order.userId,
    packId: order.pack.id,
    runs: order.pack.runs,
    amount: order.pack.pricePaise,
    currency: order.currency,
  })
}

export async function findOrder(orderId: string): Promise<OrderRow | null> {
  const [row] = await getDb().select().from(schema.billingOrders).where(eq(schema.billingOrders.id, orderId)).limit(1)
  return row ?? null
}

/**
 * Add a paid order's runs to its account, mark the order paid and keep the
 * payment for the history — all in one statement. Safe to call any number of
 * times, from the verify route and the webhook at once: the ledger's unique
 * payment id lets exactly one call add the runs. Returns whether this call did.
 */
export async function grantOrderPayment(
  order: OrderRow,
  payment: Pick<PaymentFacts, 'id' | 'amount' | 'currency'>
): Promise<boolean> {
  if (!order.userId) return false
  const result = await getDb().execute(sql`
    with entry as (
      insert into credit_ledger (user_id, delta, reason, razorpay_payment_id)
      values (${order.userId}, ${order.runs}, 'purchase', ${payment.id})
      on conflict (razorpay_payment_id) do nothing
      returning user_id, delta
    ), balance as (
      insert into credit_balances (user_id, balance)
      select user_id, delta from entry
      on conflict (user_id) do update
        set balance = credit_balances.balance + excluded.balance, updated_at = now()
    ), paid as (
      update billing_orders
      set status = 'paid', payment_id = coalesce(payment_id, ${payment.id}), paid_at = coalesce(paid_at, now())
      where id = ${order.id}
    ), history as (
      insert into payments (id, user_id, kind, order_id, amount, currency)
      values (${payment.id}, ${order.userId}, 'pack', ${order.id}, ${payment.amount}, ${payment.currency})
      on conflict (id) do nothing
    )
    select count(*)::int as granted from entry`)
  return firstNumber(result, 'granted') > 0
}

export async function recordSubscriptionPayment(payment: PaymentFacts, subscriptionId: string, userId: string | null) {
  await getDb()
    .insert(schema.payments)
    .values({
      id: payment.id,
      userId,
      kind: 'subscription',
      orderId: payment.orderId,
      subscriptionId,
      amount: payment.amount,
      currency: payment.currency,
    })
    .onConflictDoNothing()
}

// ─── Webhook deliveries ──────────────────────────────────────────────────────

export async function webhookAlreadyHandled(eventId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.webhookEvents.id })
    .from(schema.webhookEvents)
    .where(eq(schema.webhookEvents.id, eventId))
    .limit(1)
  return rows.length > 0
}

export async function markWebhookHandled(eventId: string, event: string) {
  await getDb().insert(schema.webhookEvents).values({ id: eventId, event }).onConflictDoNothing()
}

// ─── The billing page ────────────────────────────────────────────────────────

export async function getBillingStatus(userId: string): Promise<BillingStatus> {
  const [quota, history] = await Promise.all([
    loadQuota(userId),
    getDb()
      .select({
        id: schema.payments.id,
        kind: schema.payments.kind,
        amount: schema.payments.amount,
        currency: schema.payments.currency,
        createdAt: schema.payments.createdAt,
      })
      .from(schema.payments)
      .where(eq(schema.payments.userId, userId))
      .orderBy(desc(schema.payments.createdAt))
      .limit(10),
  ])
  const config = razorpayConfig()
  const platformAi = (await getPlatformAi()) !== null
  const importsResetAt = nextMonthStart(quota.now).toISOString()
  const { subscription } = quota

  return {
    role: 'user',
    platformAi,
    checkout: {
      packs: platformAi && config !== null,
      tiers: platformAi ? tiersOnSale(config) : [],
      testMode: config?.testMode ?? false,
    },
    runs: {
      left: runsLeft(quota.state),
      free: quota.state.free,
      subscription: quota.state.subscription,
      credits: quota.state.credits,
    },
    applies: quota.applies ? { ...quota.applies, resetsAt: subscription?.currentEnd?.toISOString() ?? importsResetAt } : null,
    paying: quota.paying,
    imports: { ...quota.imports, resetsAt: importsResetAt },
    emailDrafts: { ...quota.emailDrafts, resetsAt: importsResetAt },
    emailSends: { ...quota.emailSends, resetsAt: nextDayStart(quota.now).toISOString() },
    subscription: subscription
      ? {
          tier: quota.tier,
          status: subscription.status,
          entitled: quota.entitled,
          currentEnd: subscription.currentEnd?.toISOString() ?? null,
          cancelAtCycleEnd: subscription.cancelAtCycleEnd,
        }
      : null,
    tiers: { pro: { ...TIERS.pro }, premium: { ...TIERS.premium } },
    packs: CREDIT_PACKS.map((pack) => ({ ...pack })),
    payments: history.map((row) => ({
      id: row.id,
      kind: row.kind === 'subscription' ? 'subscription' : 'pack',
      amount: row.amount,
      currency: row.currency,
      createdAt: row.createdAt.toISOString(),
    })),
  }
}
