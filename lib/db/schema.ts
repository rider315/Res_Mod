import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
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

/**
 * Cover letters written for a tailored copy. Each write or rewrite is a row, so
 * the number of rows is how many times one was written; edits change the
 * newest row in place. They go with the tailored copy they were written for.
 */
export const coverLetters = pgTable(
  'cover_letters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tailoringId: uuid('tailoring_id')
      .notNull()
      .references(() => tailorings.id, { onDelete: 'cascade' }),
    /** professional, warm, direct or enthusiastic. */
    tone: text('tone').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('cover_letters_tailoring_id_created_at_idx').on(table.tailoringId, table.createdAt)]
)

// ─── Recruiter outreach ──────────────────────────────────────────────────────
//
// The recruiters an account emails about jobs, the emails themselves, and how
// they are signed and sent (lib/outreach).

/** The people an account emails about jobs: one row per address per account. */
export const recruiters = pgTable(
  'recruiters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Lower-cased, and checked when added (lib/outreach/email-check.ts). */
    email: text('email').notNull(),
    name: text('name').notNull().default(''),
    company: text('company').notNull().default(''),
    /** Their own job title, such as "Talent Acquisition Lead". */
    title: text('title').notNull().default(''),
    /** How it was added: manual, paste, csv, excel, pdf or sheets. */
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('recruiters_user_id_email_key').on(table.userId, table.email)]
)

/**
 * Emails to recruiters. A first email starts a thread: follow-ups point at it,
 * replies hang off it, and the thread's progress (sent, opened, replied,
 * interview, offer, rejected) is kept on it.
 */
export const outreachEmails = pgTable(
  'outreach_emails',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recruiterId: uuid('recruiter_id')
      .notNull()
      .references(() => recruiters.id, { onDelete: 'cascade' }),
    /** For a follow-up: the first email of its thread. Null for a first email. */
    threadId: uuid('thread_id').references((): AnyPgColumn => outreachEmails.id, { onDelete: 'cascade' }),
    /** What it was written from and attaches: a saved resume, or else a tailored copy. */
    resumeId: uuid('resume_id').references(() => resumes.id, { onDelete: 'set null' }),
    tailoringId: uuid('tailoring_id').references(() => tailorings.id, { onDelete: 'set null' }),
    /** The role it is about, when known. */
    jobTitle: text('job_title').notNull().default(''),
    /** A job post the user gave for an email not written from a tailored copy. */
    jobDescription: text('job_description').notNull().default(''),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    /** draft, sending, sent, opened, replied, interview, offer or rejected (lib/outreach/model.ts). */
    status: text('status').notNull().default('draft'),
    /** Whether the resume goes with it as a PDF. */
    attachResume: boolean('attach_resume').notNull().default(true),
    /** The random id in its open-tracking image; null when opens aren't tracked. */
    trackingToken: text('tracking_token').unique(),
    openCount: integer('open_count').notNull().default(0),
    /** The mail server's id for the sent message. */
    messageId: text('message_id'),
    /** Why the last attempt to send it failed. */
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('outreach_emails_user_id_updated_at_idx').on(table.userId, table.updatedAt),
    index('outreach_emails_recruiter_id_idx').on(table.recruiterId),
    index('outreach_emails_thread_id_idx').on(table.threadId),
    index('outreach_emails_tailoring_id_idx').on(table.tailoringId),
  ]
)

/** Recruiters' replies, pasted in by the user and read by the AI. */
export const outreachReplies = pgTable(
  'outreach_replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The first email of the thread it answers. */
    emailId: uuid('email_id')
      .notNull()
      .references(() => outreachEmails.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    /** What the recruiter wants (REPLY_INTENTS in lib/outreach/model.ts). */
    intent: text('intent').notNull(),
    summary: text('summary').notNull().default(''),
    suggestedReply: text('suggested_reply').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('outreach_replies_email_id_idx').on(table.emailId)]
)

/** How an account's recruiter emails are signed, and whether their opens are tracked. */
export const outreachProfiles = pgTable('outreach_profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  senderName: text('sender_name').notNull().default(''),
  phone: text('phone').notNull().default(''),
  /** [{ label, url }]: LinkedIn, a portfolio and the like, printed under the signature. */
  links: jsonb('links').notNull().default(sql`'[]'::jsonb`),
  /** When the user can start, such as "Can join immediately". */
  availability: text('availability').notNull().default(''),
  /** What every email should find a way to mention. */
  highlights: text('highlights').notNull().default(''),
  trackOpens: boolean('track_opens').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * The mailbox an account sends recruiter emails from, over SMTP. The password,
 * usually an app password, is encrypted (lib/secrets.ts) and never leaves the server.
 */
export const mailAccounts = pgTable('mail_accounts', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** gmail, outlook, yahoo, zoho, zoho_in, icloud or custom (lib/outreach/mailbox.ts). */
  provider: text('provider').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  /** The address it signs in with, and sends from. */
  address: text('address').notNull(),
  password: text('password').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Billing ─────────────────────────────────────────────────────────────────
//
// Money-related rows (orders, subscriptions, payments) keep their history when
// an account is deleted: the user id is cleared instead, as accounting needs the
// record. Run counters and credits go with the account.

/**
 * Counters for metered use of Chills AI: a month's free runs and imports, and a
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
 * Chills AI (lib/billing/platform-ai.ts). One row per setting; secrets inside a
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
