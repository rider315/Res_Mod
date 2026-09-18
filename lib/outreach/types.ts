import type { EmailStatus, MailboxStatus, OutreachProfile, RecruiterSource, ReplyIntent } from '@/lib/outreach/model'

/** What the Outreach routes return. Client-safe; dates are ISO strings. */

export interface RecruiterSummary {
  id: string
  email: string
  name: string
  company: string
  title: string
  source: RecruiterSource
  createdAt: string
  /** The newest thread with this recruiter, if there is one. */
  latestThread: { id: string; status: EmailStatus; updatedAt: string } | null
  threads: number
}

/** What a first email was written from, and attaches. */
export type EmailSource = { kind: 'resume'; id: string } | { kind: 'tailoring'; id: string } | null

/**
 * What reading the company's website came to, shown next to the email it was
 * read for (lib/outreach/company-research.ts):
 * - found: facts the site backs, which the email may use one of
 * - nothing: the site was read, and says nothing specific enough to use
 * - unreachable: the site couldn't be read
 * - personal: the recruiter writes from a free provider, so there is no site to read
 * - skipped: the AI couldn't be asked just now; the email was written without it
 */
export type CompanyNote =
  | { status: 'found'; site: string; company: string; facts: string[] }
  | { status: 'nothing' | 'unreachable'; site: string }
  | { status: 'personal' | 'skipped' }

export interface ThreadSummary {
  id: string
  recruiter: { id: string; email: string; name: string; company: string; title: string }
  source: EmailSource
  jobTitle: string
  subject: string
  status: EmailStatus
  sentAt: string | null
  openedAt: string | null
  openCount: number
  lastError: string | null
  createdAt: string
  updatedAt: string
  /** Follow-ups sent so far. */
  followUps: number
  /** The newest email in the thread that went out. */
  lastSentAt: string | null
  /** A follow-up written but not sent yet. */
  draftFollowUpId: string | null
  replies: number
  lastIntent: ReplyIntent | null
}

export interface EmailDetail {
  id: string
  threadId: string | null
  recruiterId: string
  source: EmailSource
  jobTitle: string
  jobDescription: string
  subject: string
  body: string
  status: EmailStatus
  attachResume: boolean
  tracked: boolean
  openCount: number
  sentAt: string | null
  openedAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface ReplyRecord {
  id: string
  body: string
  intent: ReplyIntent
  summary: string
  suggestedReply: string
  createdAt: string
}

export interface ThreadDetail {
  email: EmailDetail
  followUps: EmailDetail[]
  replies: ReplyRecord[]
  recruiter: ThreadSummary['recruiter']
}

export interface ImportSummary {
  /** Rows found in the file or list. */
  found: number
  added: number
  /** Already in the list, or repeated within the import. */
  duplicates: number
  /** Addresses that failed the checks, with why. */
  rejected: Array<{ email: string; reason: string; suggestion?: string }>
  /** Rows left out because the account's list is full. */
  overLimit: number
}

/** GET /api/outreach/setup */
export interface OutreachSetup {
  profile: OutreachProfile
  mailbox: MailboxStatus | null
  /** The name the emails are signed with when the profile leaves it blank. */
  defaultName: string
}
