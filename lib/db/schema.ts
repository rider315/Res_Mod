import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Database schema.
 *
 * Change a table here, then run `npm run db:generate` to write the migration
 * into drizzle/ and `npm run db:migrate` to apply it.
 */

export const users = pgTable('users', {
  /** Google's stable account id (the session `sub`). */
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Owner resumes and user resumes share one table. An owner resume is keyed by the
 * profile it belongs to (lib/profiles), a user resume by the account that
 * imported it, and the check constraint makes exactly one of those set — so a
 * profile's resume can never be reached through a user id, or the other way round.
 */
export const resumes = pgTable(
  'resumes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The account that imported it; null for owner profile resumes. */
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** The owner profile it belongs to, e.g. "gaurav"; null for user resumes. */
    profileId: text('profile_id'),
    title: text('title').notNull(),
    /** What it was imported from: latex, pdf, docx or text. */
    sourceFormat: text('source_format').notNull(),
    /** The structured resume the LaTeX is rendered from; null for hand-written .tex. */
    doc: jsonb('doc'),
    latex: text('latex').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('resumes_profile_id_key').on(table.profileId).where(sql`profile_id is not null`),
    index('resumes_user_id_idx').on(table.userId),
    check('resumes_one_owner', sql`(user_id is null) <> (profile_id is null)`),
  ]
)

/**
 * Tailored copies a user applied, kept so they can be downloaded again. The
 * LaTeX is the finished document the server produced from the stored resume and
 * the approved changes, never text from a browser.
 */
export const tailorings = pgTable(
  'tailorings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The saved resume it came from. Cleared, not deleted with it, when that resume is deleted. */
    resumeId: uuid('resume_id').references(() => resumes.id, { onDelete: 'set null' }),
    resumeTitle: text('resume_title').notNull(),
    jobTitle: text('job_title').notNull().default(''),
    company: text('company').notNull().default(''),
    /** soft, hard or hardest. */
    level: text('level').notNull(),
    jobDescription: text('job_description').notNull().default(''),
    /** The approved changes that were applied: [{ original, proposed }]. */
    changes: jsonb('changes').notNull(),
    appliedCount: integer('applied_count').notNull(),
    /** Keyword coverage before and after (lib/tailor/history.ts), when the run reported its keywords. */
    coverage: jsonb('coverage'),
    latex: text('latex').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('tailorings_user_id_created_at_idx').on(table.userId, table.createdAt)]
)

// ─── Billing ─────────────────────────────────────────────────────────────────
//
// Money-related rows (orders, subscriptions, payments) keep their history when
// an account is deleted: the user id is cleared instead, as accounting needs the
// record. Run counters and credits go with the account.

/**
 * Counters for metered use of ResMod AI: a month's free runs and imports, and a
 * Pro cycle's runs. One row per account per bucket (lib/billing/quota.ts), so a
 * new month or cycle simply starts a new row.
 */
export const usageCounters = pgTable(
  'usage_counters',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bucket: text('bucket').notNull(),
    used: integer('used').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.bucket] }),
    check('usage_counters_used_non_negative', sql`used >= 0`),
  ]
)

/** Purchased runs left. The ledger records every change to it. */
export const creditBalances = pgTable(
  'credit_balances',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    balance: integer('balance').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [check('credit_balances_balance_non_negative', sql`balance >= 0`)]
)

export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    delta: integer('delta').notNull(),
    /** purchase, run or refund. */
    reason: text('reason').notNull(),
    /** Set on purchases. Unique, so one payment can never add credits twice. */
    razorpayPaymentId: text('razorpay_payment_id').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('credit_ledger_user_id_idx').on(table.userId)]
)

/**
 * Razorpay orders for credit packs, recorded when created, so a payment is matched
 * to the pack, price and account it was for without trusting the browser.
 */
export const billingOrders = pgTable(
  'billing_orders',
  {
    /** Razorpay's order id. */
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    packId: text('pack_id').notNull(),
    runs: integer('runs').notNull(),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    /** created, then paid. */
    status: text('status').notNull().default('created'),
    paymentId: text('payment_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (table) => [index('billing_orders_user_id_idx').on(table.userId)]
)

/** Pro subscriptions, mirrored from Razorpay by the verify route and the webhook. */
export const subscriptions = pgTable(
  'subscriptions',
  {
    /** Razorpay's subscription id. */
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    planId: text('plan_id').notNull(),
    /** Razorpay's status: created, authenticated, active, pending, halted, cancelled, completed, expired or paused. */
    status: text('status').notNull(),
    currentStart: timestamp('current_start', { withTimezone: true }),
    currentEnd: timestamp('current_end', { withTimezone: true }),
    /** Cancelled from the billing page: it stays active until current_end, then ends. */
    cancelAtCycleEnd: boolean('cancel_at_cycle_end').notNull().default(false),
    /** When the stored state was true, so a late webhook about an older state can't overwrite a newer one. */
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('subscriptions_user_id_idx').on(table.userId)]
)

/** Captured payments, for the billing page's history. */
export const payments = pgTable(
  'payments',
  {
    /** Razorpay's payment id. */
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** pack or subscription. */
    kind: text('kind').notNull(),
    orderId: text('order_id'),
    subscriptionId: text('subscription_id'),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('payments_user_id_idx').on(table.userId)]
)

/** Webhook deliveries already handled. Razorpay can deliver the same event more than once. */
export const webhookEvents = pgTable('webhook_events', {
  /** The x-razorpay-event-id header. */
  id: text('id').primaryKey(),
  event: text('event').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Settings ────────────────────────────────────────────────────────────────

/**
 * Settings the owner changes from the app instead of the environment, such as
 * ResMod AI (lib/billing/platform-ai.ts). One row per setting; secrets inside a
 * value are encrypted (lib/secrets.ts).
 */
export const appSettings = pgTable('app_settings', {
  /** For example "platform_ai@production". */
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  /** The account that last changed it. */
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
