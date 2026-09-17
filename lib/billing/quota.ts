import { EMAIL_DRAFTS_PER_MONTH, IMPORTS_PER_MONTH } from '@/lib/billing/plans'

/**
 * The arithmetic of tailorings, kept apart from the database so it can be tested
 * on its own.
 *
 * Every tailoring by a regular account runs on ResMod AI and spends one run from
 * the first source that has one left:
 *   1. the Pro plan's runs for the current cycle, which lapse when the cycle ends
 *   2. the account's free tailorings, given once and never renewed
 *   3. purchased credits, which never expire and were paid for, so they go last
 * Pro comes first so that someone who subscribes before trying the free ones
 * keeps them for later. The owner is never counted.
 */

export type RunSource = 'subscription' | 'free' | 'credits'

export interface Allowance {
  used: number
  limit: number
}

export interface QuotaState {
  /** Present only while a Pro plan entitles the account to its runs. */
  subscription: Allowance | null
  free: Allowance
  credits: number
}

const remaining = ({ used, limit }: Allowance) => Math.max(0, limit - used)

/** The sources with a run left, in the order a run spends them. */
export function runSources(state: QuotaState): RunSource[] {
  const sources: RunSource[] = []
  if (state.subscription && remaining(state.subscription) > 0) sources.push('subscription')
  if (remaining(state.free) > 0) sources.push('free')
  if (state.credits > 0) sources.push('credits')
  return sources
}

export function runsLeft(state: QuotaState): number {
  return (state.subscription ? remaining(state.subscription) : 0) + remaining(state.free) + Math.max(0, state.credits)
}

export function importLimit(paying: boolean): number {
  return paying ? IMPORTS_PER_MONTH.paid : IMPORTS_PER_MONTH.free
}

export function draftLimit(paying: boolean): number {
  return paying ? EMAIL_DRAFTS_PER_MONTH.paid : EMAIL_DRAFTS_PER_MONTH.free
}

/** The calendar month a counter belongs to, in UTC: "2026-09". */
export function monthKey(now: Date): string {
  return now.toISOString().slice(0, 7)
}

/** When this month's counters start again: the first instant of next month, UTC. */
export function nextMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

/** When today's counters start again: the next midnight, UTC. */
export function nextDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
}

/**
 * AI requests a regular account can make in a UTC day: a guard against runaway
 * use of the servers, well above what a person tailoring resumes by hand gets
 * through.
 */
export const DAILY_AI_REQUESTS = 40

/** Counter names: one row per account per bucket, so a new month or cycle is simply a new row. */
export const buckets = {
  /** One row per account for life: the free tailorings never come back. */
  freeTailorings: () => 'runs:free',
  imports: (now: Date) => `imports:${monthKey(now)}`,
  /** Recruiter emails written by the AI this month. */
  emailDrafts: (now: Date) => `drafts:${monthKey(now)}`,
  /** Recruiter emails sent today, UTC. */
  emailSends: (now: Date) => `sends:${now.toISOString().slice(0, 10)}`,
  dailyAi: (now: Date) => `ai:${now.toISOString().slice(0, 10)}`,
  /** Keyed by the cycle's start, so a renewal starts a fresh count with no reset job. */
  subscriptionRuns: (subscriptionId: string, cycleStart: Date | null, now: Date) =>
    `sub:${subscriptionId}:${cycleStart ? Math.floor(cycleStart.getTime() / 1000) : monthKey(now)}`,
}

/**
 * Razorpay statuses in which the plan's runs can be used. "pending" means a
 * renewal charge failed and Razorpay is still retrying it, so the account keeps
 * its runs meanwhile; "halted" means the retries ran out.
 */
const ENTITLED_STATUSES = new Set(['active', 'pending'])

/** How long past a cycle's end a plan still counts, while a late renewal webhook catches up. */
export const CYCLE_GRACE_MS = 3 * 24 * 60 * 60 * 1000

export function subscriptionEntitles(subscription: { status: string; currentEnd: Date | null }, now: Date): boolean {
  if (!ENTITLED_STATUSES.has(subscription.status)) return false
  return !subscription.currentEnd || now.getTime() <= subscription.currentEnd.getTime() + CYCLE_GRACE_MS
}
