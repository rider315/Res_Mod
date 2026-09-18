import { z } from 'zod'

/**
 * Recruiter outreach: the states an email moves through, what a user can type
 * in, and the limits on both.
 *
 * Client-safe: the Outreach screens validate with the same schemas the routes use.
 */

/**
 * An email's life. "sending" is held only while the mail server is being
 * talked to, so a double click can't send twice. After it is sent, the thread
 * moves on as the recruiter opens and answers it.
 */
export const EMAIL_STATUSES = ['draft', 'sending', 'sent', 'opened', 'replied', 'interview', 'offer', 'rejected'] as const
export type EmailStatus = (typeof EMAIL_STATUSES)[number]

/** Where a sent thread can be, in order: the tracker's columns. */
export const THREAD_STAGES = ['sent', 'opened', 'replied', 'interview', 'offer', 'rejected'] as const
export type ThreadStage = (typeof THREAD_STAGES)[number]

export const STATUS_LABELS: Record<EmailStatus, string> = {
  draft: 'Draft',
  sending: 'Sending',
  sent: 'Sent',
  opened: 'Opened',
  replied: 'Replied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Not moving forward',
}

export function isEmailStatus(value: unknown): value is EmailStatus {
  return typeof value === 'string' && (EMAIL_STATUSES as readonly string[]).includes(value)
}

export function isThreadStage(value: unknown): value is ThreadStage {
  return typeof value === 'string' && (THREAD_STAGES as readonly string[]).includes(value)
}

/** Sent, in any stage after it. */
export function wasSent(status: string): boolean {
  return isThreadStage(status)
}

/** What a recruiter's reply is about. */
export const REPLY_INTENTS = ['interested', 'interview', 'question', 'referral', 'rejection', 'automatic', 'unclear'] as const
export type ReplyIntent = (typeof REPLY_INTENTS)[number]

export const INTENT_LABELS: Record<ReplyIntent, string> = {
  interested: 'Interested',
  interview: 'Wants an interview',
  question: 'Asked a question',
  referral: 'Pointed you elsewhere',
  rejection: 'Not moving forward',
  automatic: 'Automatic reply',
  unclear: 'Unclear',
}

/**
 * Where a reply moves its thread. An automatic reply, such as an out-of-office
 * note, moves nothing. A thread never moves back from an interview or an offer
 * because of a later reply; the user can still move it by hand.
 */
export function stageAfterReply(current: ThreadStage, intent: ReplyIntent): ThreadStage {
  if (intent === 'automatic') return current
  const next: ThreadStage = intent === 'interview' ? 'interview' : intent === 'rejection' ? 'rejected' : 'replied'
  if (current === 'offer') return current
  if (current === 'interview' && next === 'replied') return current
  return next
}

/** How a recruiter got into the list. */
export const RECRUITER_SOURCES = ['manual', 'paste', 'csv', 'excel', 'pdf', 'sheets', 'directory'] as const
export type RecruiterSource = (typeof RECRUITER_SOURCES)[number]

export const LIMITS = {
  recruitersPerAccount: 2000,
  /** Rows read from one import. */
  importRows: 500,
  subject: 150,
  body: 5000,
  jobDescription: 12_000,
  reply: 8000,
  links: 5,
  highlights: 600,
  /** Follow-ups one thread can have. */
  followUps: 2,
  /**
   * Published recruiters one account may take in a week. The list is a shared
   * thing: without a cap the first few accounts would empty it.
   */
  directoryPerWeek: 40,
  /**
   * Accounts that may ever take one published recruiter. It is not about
   * fairness — a recruiter who gets the same pitch from hundreds of strangers
   * reports it as spam, which burns the contact and the senders' mailboxes too.
   */
  directoryTakesPerRecruiter: 25,
} as const

/** A thread with no reply this many days after its last email is due a follow-up. */
export const FOLLOW_UP_AFTER_DAYS = 5

/** A pause between emails sent in a batch, so a mailbox doesn't look like it is spraying mail. */
export const BATCH_SEND_GAP_MS = 4000

const text = (max: number) => z.string().trim().max(max)

export const RecruiterInputSchema = z.object({
  email: text(254).min(3, 'Enter an email address'),
  name: text(120).default(''),
  company: text(160).default(''),
  title: text(120).default(''),
})
export type RecruiterInput = z.infer<typeof RecruiterInputSchema>

/** A link under the signature. Only web addresses: a signature is no place for a script. */
export const SignatureLinkSchema = z.object({
  label: text(40).default(''),
  url: text(300).refine((value) => /^https?:\/\/[^\s]+$/i.test(value), 'Links must start with http:// or https://'),
})

export const OutreachProfileSchema = z.object({
  senderName: text(80).default(''),
  phone: text(40).default(''),
  links: z.array(SignatureLinkSchema).max(LIMITS.links).default([]),
  availability: text(120).default(''),
  highlights: text(LIMITS.highlights).default(''),
  trackOpens: z.boolean().default(true),
})
export type OutreachProfile = z.infer<typeof OutreachProfileSchema>

export const EMPTY_PROFILE: OutreachProfile = {
  senderName: '',
  phone: '',
  links: [],
  availability: '',
  highlights: '',
  trackOpens: true,
}

/** Due a follow-up: sent or opened, no reply, not followed up too often, and quiet for long enough. */
export function followUpDue(
  thread: { status: string; lastSentAt: string | Date | null; followUps: number },
  now: Date = new Date()
): boolean {
  if (thread.status !== 'sent' && thread.status !== 'opened') return false
  if (!thread.lastSentAt || thread.followUps >= LIMITS.followUps) return false
  const quietMs = now.getTime() - new Date(thread.lastSentAt).getTime()
  return quietMs >= FOLLOW_UP_AFTER_DAYS * 24 * 60 * 60 * 1000
}

// ─── The mailbox emails are sent from ────────────────────────────────────────

export interface MailProvider {
  label: string
  /** Empty for "custom", where the user gives the server. */
  host: string
  port: number
  /** Where to make an app password, and what to know first. */
  help: string
  helpUrl?: string
}

export const MAIL_PROVIDERS = {
  gmail: {
    label: 'Gmail',
    host: 'smtp.gmail.com',
    port: 465,
    help: 'Turn on 2-Step Verification for your Google account, then create an app password named "Chills" and paste the 16 letters here. Your normal Gmail password won’t work.',
    helpUrl: 'https://myaccount.google.com/apppasswords',
  },
  outlook: {
    label: 'Outlook / Microsoft 365',
    host: 'smtp.office365.com',
    port: 587,
    help: 'Use an app password from your Microsoft account’s security settings. Some Microsoft accounts no longer allow them; if yours is refused, use “Open in Outlook” on each email instead.',
    helpUrl: 'https://account.live.com/proofs/AppPassword',
  },
  yahoo: {
    label: 'Yahoo Mail',
    host: 'smtp.mail.yahoo.com',
    port: 465,
    help: 'Generate an app password under Account security in Yahoo, and paste it here.',
    helpUrl: 'https://login.yahoo.com/account/security',
  },
  zoho: {
    label: 'Zoho Mail',
    host: 'smtp.zoho.com',
    port: 465,
    help: 'Create an application-specific password in Zoho Accounts under Security.',
    helpUrl: 'https://accounts.zoho.com/home#security/app_password',
  },
  zoho_in: {
    label: 'Zoho Mail (India data centre)',
    host: 'smtp.zoho.in',
    port: 465,
    help: 'For Zoho accounts at zoho.in: create an application-specific password in Zoho Accounts under Security.',
    helpUrl: 'https://accounts.zoho.in/home#security/app_password',
  },
  icloud: {
    label: 'iCloud Mail',
    host: 'smtp.mail.me.com',
    port: 587,
    help: 'Create an app-specific password at account.apple.com under Sign-In and Security.',
    helpUrl: 'https://account.apple.com/account/manage',
  },
  custom: {
    label: 'Another provider',
    host: '',
    port: 587,
    help: 'Enter your provider’s SMTP server. Only secure connections on ports 465, 587 or 2525 are used.',
  },
} as const satisfies Record<string, MailProvider>

export type MailProviderId = keyof typeof MAIL_PROVIDERS
export const MAIL_PROVIDER_IDS = Object.keys(MAIL_PROVIDERS) as MailProviderId[]
export const SMTP_PORTS = [465, 587, 2525] as const

export const MailboxInputSchema = z.object({
  provider: z.enum(MAIL_PROVIDER_IDS as [MailProviderId, ...MailProviderId[]]),
  address: text(254).min(3, 'Enter the email address you send from'),
  password: z.string().min(4, 'Enter the app password').max(200),
  host: text(253).default(''),
  port: z.coerce.number().int().default(587),
})
export type MailboxInput = z.infer<typeof MailboxInputSchema>

/** Google shows app passwords in groups of four; the spaces aren't part of them. */
export function normalizeMailboxPassword(provider: MailProviderId, password: string): string {
  return provider === 'gmail' ? password.replace(/\s+/g, '') : password
}

/** What the screens are told about the connected mailbox. The password never leaves the server. */
export interface MailboxStatus {
  provider: MailProviderId
  address: string
  host: string
  port: number
  verifiedAt: string
}

// ─── Sending it yourself ─────────────────────────────────────────────────────

interface ComposeTarget {
  to: string
  subject: string
  body: string
}

/** A Gmail compose window with the email filled in, for sending from Gmail itself. */
export function gmailComposeUrl({ to, subject, body }: ComposeTarget): string {
  const params = new URLSearchParams({ view: 'cm', fs: '1', to, su: subject, body })
  return `https://mail.google.com/mail/?${params.toString()}`
}

/** The same, in Outlook on the web. */
export function outlookComposeUrl({ to, subject, body }: ComposeTarget): string {
  const params = new URLSearchParams({ to, subject, body })
  return `https://outlook.office.com/mail/deeplink/compose?${params.toString()}`
}

/** The same, in whatever mail app the device opens. */
export function mailtoUrl({ to, subject, body }: ComposeTarget): string {
  // encodeURIComponent, not URLSearchParams: mail apps read "+" literally.
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
