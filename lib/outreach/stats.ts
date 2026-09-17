import { followUpDue, wasSent } from '@/lib/outreach/model'
import type { ThreadSummary } from '@/lib/outreach/types'

/** Where an account's outreach stands, counted from its threads. Client-safe. */

export interface OutreachStats {
  recruiters: number
  /** First emails written but not sent. */
  drafts: number
  sent: number
  /** Sent threads whose email was opened at least once. */
  opened: number
  /** Sent threads the recruiter answered. */
  replied: number
  interviews: number
  offers: number
  followUpsDue: number
}

const ANSWERED = new Set(['replied', 'interview', 'offer', 'rejected'])

export function summarizeThreads(threads: ThreadSummary[], recruiters: number, now: Date = new Date()): OutreachStats {
  const stats: OutreachStats = { recruiters, drafts: 0, sent: 0, opened: 0, replied: 0, interviews: 0, offers: 0, followUpsDue: 0 }
  for (const thread of threads) {
    if (thread.status === 'draft' || thread.status === 'sending') {
      stats.drafts++
      continue
    }
    if (!wasSent(thread.status)) continue
    stats.sent++
    if (thread.openedAt || thread.status === 'opened') stats.opened++
    if (ANSWERED.has(thread.status)) stats.replied++
    if (thread.status === 'interview') stats.interviews++
    if (thread.status === 'offer') stats.offers++
    if (followUpDue(thread, now)) stats.followUpsDue++
  }
  return stats
}

/** "12%" of `total`, or an empty string when there is nothing to measure yet. */
export function rate(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : ''
}
