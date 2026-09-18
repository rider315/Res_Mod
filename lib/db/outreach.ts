import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { isResumeId } from '@/lib/db/resumes'
import { decryptSecret, encryptSecret } from '@/lib/secrets'
import {
  EmailStatus,
  isEmailStatus,
  LIMITS,
  MailboxStatus,
  MailProviderId,
  MAIL_PROVIDER_IDS,
  OutreachProfile,
  OutreachProfileSchema,
  EMPTY_PROFILE,
  RecruiterSource,
  ReplyIntent,
  ThreadStage,
} from '@/lib/outreach/model'
import type { EmailDetail, EmailSource, RecruiterSummary, ReplyRecord, ThreadDetail, ThreadSummary } from '@/lib/outreach/types'
import type { MailboxLogin } from '@/lib/outreach/mailbox'
import type { RecruiterRow } from '@/lib/outreach/recruiter-import'

/**
 * Data access for recruiter outreach. As everywhere else, every query is scoped
 * by the signed-in account's id as well as the row's, so an id from another
 * account is simply "not found". The one exception is the open-tracking image,
 * which is reached by its random token alone.
 */

type Row = Record<string, unknown>

const iso = (value: unknown): string | null => (value == null ? null : new Date(value as string | Date).toISOString())
const isoOrNow = (value: unknown): string => iso(value) ?? new Date().toISOString()

function sourceOf(row: { resumeId?: unknown; tailoringId?: unknown }): EmailSource {
  if (row.tailoringId) return { kind: 'tailoring', id: String(row.tailoringId) }
  if (row.resumeId) return { kind: 'resume', id: String(row.resumeId) }
  return null
}

const status = (value: unknown): EmailStatus => (isEmailStatus(value) ? value : 'draft')

// ─── Recruiters ──────────────────────────────────────────────────────────────

export async function listRecruiters(userId: string): Promise<RecruiterSummary[]> {
  const result = await getDb().execute(sql`
    select r.id, r.email, r.name, r.company, r.title, r.source, r.created_at,
      t.id as thread_id, t.status as thread_status, t.updated_at as thread_updated_at,
      coalesce(c.threads, 0) as threads
    from recruiters r
    left join lateral (
      select id, status, updated_at from outreach_emails e
      where e.recruiter_id = r.id and e.thread_id is null
      order by e.updated_at desc limit 1
    ) t on true
    left join lateral (
      select count(*)::int as threads from outreach_emails e where e.recruiter_id = r.id and e.thread_id is null
    ) c on true
    where r.user_id = ${userId}
    order by r.created_at desc, r.email
    limit ${LIMITS.recruitersPerAccount}`)
  return (result.rows as Row[]).map((row) => ({
    id: String(row.id),
    email: String(row.email),
    name: String(row.name ?? ''),
    company: String(row.company ?? ''),
    title: String(row.title ?? ''),
    source: String(row.source) as RecruiterSource,
    createdAt: isoOrNow(row.created_at),
    latestThread: row.thread_id
      ? { id: String(row.thread_id), status: status(row.thread_status), updatedAt: isoOrNow(row.thread_updated_at) }
      : null,
    threads: Number(row.threads ?? 0),
  }))
}

export async function countRecruiters(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.recruiters)
    .where(eq(schema.recruiters.userId, userId))
  return row?.count ?? 0
}

export async function getRecruiter(userId: string, id: string) {
  if (!isResumeId(id)) return null
  const [row] = await getDb()
    .select()
    .from(schema.recruiters)
    .where(and(eq(schema.recruiters.id, id), eq(schema.recruiters.userId, userId)))
    .limit(1)
  return row ?? null
}

/**
 * Add checked recruiters, skipping addresses already in the list. Rows past the
 * account's limit are left out. Returns how many were added and how many were
 * over the limit.
 */
export async function addRecruiters(
  userId: string,
  rows: RecruiterRow[],
  source: RecruiterSource
): Promise<{ added: number; overLimit: number; ids: string[] }> {
  if (rows.length === 0) return { added: 0, overLimit: 0, ids: [] }
  const room = Math.max(0, LIMITS.recruitersPerAccount - (await countRecruiters(userId)))
  const accepted = rows.slice(0, room)
  if (accepted.length === 0) return { added: 0, overLimit: rows.length, ids: [] }

  const inserted = await getDb()
    .insert(schema.recruiters)
    .values(
      accepted.map((row) => ({
        userId,
        email: row.email,
        name: row.name.slice(0, 120),
        company: row.company.slice(0, 160),
        title: row.title.slice(0, 120),
        source,
      }))
    )
    .onConflictDoNothing({ target: [schema.recruiters.userId, schema.recruiters.email] })
    .returning({ id: schema.recruiters.id })
  return { added: inserted.length, overLimit: rows.length - accepted.length, ids: inserted.map((row) => row.id) }
}

/** The addresses already in an account's list, lower-cased. */
export async function existingRecruiterEmails(userId: string): Promise<Set<string>> {
  const rows = await getDb()
    .select({ email: schema.recruiters.email })
    .from(schema.recruiters)
    .where(eq(schema.recruiters.userId, userId))
  return new Set(rows.map((row) => row.email.toLowerCase()))
}

export async function updateRecruiter(
  userId: string,
  id: string,
  patch: { name: string; company: string; title: string }
): Promise<boolean> {
  if (!isResumeId(id)) return false
  const rows = await getDb()
    .update(schema.recruiters)
    .set(patch)
    .where(and(eq(schema.recruiters.id, id), eq(schema.recruiters.userId, userId)))
    .returning({ id: schema.recruiters.id })
  return rows.length > 0
}

/** Delete recruiters, and with them every email and reply to them. */
export async function deleteRecruiters(userId: string, ids: string[]): Promise<number> {
  const valid = ids.filter(isResumeId)
  if (valid.length === 0) return 0
  const rows = await getDb()
    .delete(schema.recruiters)
    .where(and(eq(schema.recruiters.userId, userId), inArray(schema.recruiters.id, valid)))
    .returning({ id: schema.recruiters.id })
  return rows.length
}

// ─── Emails ──────────────────────────────────────────────────────────────────

type EmailRow = typeof schema.outreachEmails.$inferSelect

function toDetail(row: EmailRow): EmailDetail {
  return {
    id: row.id,
    threadId: row.threadId,
    recruiterId: row.recruiterId,
    source: sourceOf(row),
    jobTitle: row.jobTitle,
    jobDescription: row.jobDescription,
    subject: row.subject,
    body: row.body,
    status: status(row.status),
    attachResume: row.attachResume,
    coverLetter: row.coverLetter,
    attachCoverLetter: row.attachCoverLetter,
    tracked: Boolean(row.trackingToken),
    openCount: row.openCount,
    sentAt: iso(row.sentAt),
    openedAt: iso(row.openedAt),
    lastError: row.lastError,
    createdAt: isoOrNow(row.createdAt),
    updatedAt: isoOrNow(row.updatedAt),
  }
}

export interface NewEmail {
  recruiterId: string
  threadId: string | null
  resumeId: string | null
  tailoringId: string | null
  jobTitle: string
  jobDescription: string
  subject: string
  body: string
  attachResume: boolean
  /** The cover letter written with it, and whether it goes out as a second PDF. */
  coverLetter?: string
  attachCoverLetter?: boolean
}

export async function createEmail(userId: string, input: NewEmail): Promise<EmailDetail> {
  const [row] = await getDb()
    .insert(schema.outreachEmails)
    .values({ userId, ...input })
    .returning()
  if (input.threadId) await touchThread(userId, input.threadId)
  return toDetail(row)
}

/** Keep a thread near the top of the tracker when something happens in it. */
async function touchThread(userId: string, threadId: string) {
  await getDb()
    .update(schema.outreachEmails)
    .set({ updatedAt: new Date() })
    .where(and(eq(schema.outreachEmails.id, threadId), eq(schema.outreachEmails.userId, userId)))
}

export async function getEmailRow(userId: string, id: string): Promise<EmailRow | null> {
  if (!isResumeId(id)) return null
  const [row] = await getDb()
    .select()
    .from(schema.outreachEmails)
    .where(and(eq(schema.outreachEmails.id, id), eq(schema.outreachEmails.userId, userId)))
    .limit(1)
  return row ?? null
}

/** Replace a draft's text and settings. Only drafts can change; a sent email is history. */
export async function updateDraft(
  userId: string,
  id: string,
  patch: {
    subject: string
    body: string
    attachResume: boolean
    coverLetter?: string
    attachCoverLetter?: boolean
    source?: EmailSource
    job?: { title: string; description: string }
  }
): Promise<EmailDetail | null> {
  if (!isResumeId(id)) return null
  const sourcePatch =
    patch.source === undefined
      ? {}
      : {
          resumeId: patch.source?.kind === 'resume' ? patch.source.id : null,
          tailoringId: patch.source?.kind === 'tailoring' ? patch.source.id : null,
        }
  const jobPatch = patch.job ? { jobTitle: patch.job.title, jobDescription: patch.job.description } : {}
  const [row] = await getDb()
    .update(schema.outreachEmails)
    .set({
      subject: patch.subject,
      body: patch.body,
      attachResume: patch.attachResume,
      ...(patch.coverLetter === undefined ? {} : { coverLetter: patch.coverLetter }),
      ...(patch.attachCoverLetter === undefined ? {} : { attachCoverLetter: patch.attachCoverLetter }),
      ...sourcePatch,
      ...jobPatch,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.outreachEmails.id, id), eq(schema.outreachEmails.userId, userId), eq(schema.outreachEmails.status, 'draft')))
    .returning()
  return row ? toDetail(row) : null
}

/** Move a sent thread along the tracker by hand. */
export async function setThreadStage(userId: string, id: string, stage: ThreadStage): Promise<boolean> {
  if (!isResumeId(id)) return false
  const rows = await getDb()
    .update(schema.outreachEmails)
    .set({ status: stage, updatedAt: new Date() })
    .where(
      and(
        eq(schema.outreachEmails.id, id),
        eq(schema.outreachEmails.userId, userId),
        sql`${schema.outreachEmails.threadId} is null`,
        sql`${schema.outreachEmails.sentAt} is not null`
      )
    )
    .returning({ id: schema.outreachEmails.id })
  return rows.length > 0
}

/** Delete an email. A first email takes its follow-ups and replies with it. */
export async function deleteEmail(userId: string, id: string): Promise<boolean> {
  if (!isResumeId(id)) return false
  const rows = await getDb()
    .delete(schema.outreachEmails)
    .where(and(eq(schema.outreachEmails.id, id), eq(schema.outreachEmails.userId, userId)))
    .returning({ id: schema.outreachEmails.id })
  return rows.length > 0
}

/** Delete several drafts at once. Sent emails are left alone. */
export async function deleteDrafts(userId: string, ids: string[]): Promise<number> {
  const valid = ids.filter(isResumeId)
  if (valid.length === 0) return 0
  const rows = await getDb()
    .delete(schema.outreachEmails)
    .where(
      and(
        eq(schema.outreachEmails.userId, userId),
        inArray(schema.outreachEmails.id, valid),
        eq(schema.outreachEmails.status, 'draft')
      )
    )
    .returning({ id: schema.outreachEmails.id })
  return rows.length
}

/**
 * Take a draft for sending, so a double click or a second tab can't send it
 * twice. A send that died more than five minutes ago can be tried again.
 */
export async function claimForSending(userId: string, id: string): Promise<EmailRow | null> {
  if (!isResumeId(id)) return null
  const result = await getDb().execute(sql`
    update outreach_emails set status = 'sending', last_error = null, updated_at = now()
    where id = ${id} and user_id = ${userId}
      and (status = 'draft' or (status = 'sending' and updated_at < now() - interval '5 minutes'))
    returning id`)
  return result.rows.length > 0 ? getEmailRow(userId, id) : null
}

export async function markSent(
  userId: string,
  email: EmailRow,
  sent: { messageId: string | null; trackingToken: string | null }
): Promise<EmailDetail> {
  const now = new Date()
  const [row] = await getDb()
    .update(schema.outreachEmails)
    .set({ status: 'sent', messageId: sent.messageId, trackingToken: sent.trackingToken, sentAt: now, lastError: null, updatedAt: now })
    .where(and(eq(schema.outreachEmails.id, email.id), eq(schema.outreachEmails.userId, userId)))
    .returning()
  if (email.threadId) await touchThread(userId, email.threadId)
  return toDetail(row)
}

export async function markSendFailed(userId: string, id: string, reason: string): Promise<void> {
  await getDb()
    .update(schema.outreachEmails)
    .set({ status: 'draft', lastError: reason.slice(0, 500), updatedAt: new Date() })
    .where(and(eq(schema.outreachEmails.id, id), eq(schema.outreachEmails.userId, userId), eq(schema.outreachEmails.status, 'sending')))
}

/** A draft the user sent from their own mail app. */
export async function markSentByHand(userId: string, id: string): Promise<EmailDetail | null> {
  const email = await getEmailRow(userId, id)
  if (!email || email.status !== 'draft') return null
  return markSent(userId, email, { messageId: null, trackingToken: null })
}

/**
 * The tracking image was loaded. The open is counted on that email, and a first
 * email's thread moves from sent to opened. Loads in the first half minute are
 * ignored: those are mail servers and scanners checking the message, not people.
 */
export async function recordOpen(token: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return
  await getDb().execute(sql`
    update outreach_emails t set
      open_count = case when t.tracking_token = ${token} then t.open_count + 1 else t.open_count end,
      opened_at = case when t.tracking_token = ${token} then coalesce(t.opened_at, now()) else t.opened_at end,
      status = case when t.thread_id is null and t.status = 'sent' then 'opened' else t.status end,
      updated_at = case when t.thread_id is null and t.status = 'sent' then now() else t.updated_at end
    from (
      select id, coalesce(thread_id, id) as thread from outreach_emails
      where tracking_token = ${token} and sent_at < now() - interval '30 seconds'
    ) hit
    where t.id = hit.id or t.id = hit.thread`)
}

export async function listThreads(userId: string): Promise<ThreadSummary[]> {
  const result = await getDb().execute(sql`
    select e.id, e.recruiter_id, e.resume_id, e.tailoring_id, e.job_title, e.subject, e.status,
      e.sent_at, e.opened_at, e.open_count, e.last_error, e.created_at, e.updated_at,
      r.email as recruiter_email, r.name as recruiter_name, r.company as recruiter_company, r.title as recruiter_title,
      coalesce(f.follow_ups, 0) as follow_ups, f.last_sent, f.draft_id,
      coalesce(rp.replies, 0) as replies, rp.last_intent
    from outreach_emails e
    join recruiters r on r.id = e.recruiter_id
    left join lateral (
      select count(*) filter (where x.sent_at is not null)::int as follow_ups,
        max(x.sent_at) as last_sent,
        (array_agg(x.id order by x.created_at desc) filter (where x.status = 'draft'))[1] as draft_id
      from outreach_emails x where x.thread_id = e.id
    ) f on true
    left join lateral (
      select count(*)::int as replies, (array_agg(y.intent order by y.created_at desc))[1] as last_intent
      from outreach_replies y where y.email_id = e.id
    ) rp on true
    where e.user_id = ${userId} and e.thread_id is null
    order by e.updated_at desc
    limit 1000`)
  return (result.rows as Row[]).map((row) => {
    const sentAt = iso(row.sent_at)
    const lastFollowUp = iso(row.last_sent)
    return {
      id: String(row.id),
      recruiter: {
        id: String(row.recruiter_id),
        email: String(row.recruiter_email),
        name: String(row.recruiter_name ?? ''),
        company: String(row.recruiter_company ?? ''),
        title: String(row.recruiter_title ?? ''),
      },
      source: sourceOf({ resumeId: row.resume_id, tailoringId: row.tailoring_id }),
      jobTitle: String(row.job_title ?? ''),
      subject: String(row.subject ?? ''),
      status: status(row.status),
      sentAt,
      openedAt: iso(row.opened_at),
      openCount: Number(row.open_count ?? 0),
      lastError: row.last_error ? String(row.last_error) : null,
      createdAt: isoOrNow(row.created_at),
      updatedAt: isoOrNow(row.updated_at),
      followUps: Number(row.follow_ups ?? 0),
      lastSentAt: [sentAt, lastFollowUp].filter(Boolean).sort().pop() ?? null,
      draftFollowUpId: row.draft_id ? String(row.draft_id) : null,
      replies: Number(row.replies ?? 0),
      lastIntent: row.last_intent ? (String(row.last_intent) as ReplyIntent) : null,
    }
  })
}

/** A thread: its first email, follow-ups, replies and recruiter. `id` may be any email in it. */
export async function getThread(userId: string, id: string): Promise<ThreadDetail | null> {
  const email = await getEmailRow(userId, id)
  if (!email) return null
  const first = email.threadId ? await getEmailRow(userId, email.threadId) : email
  if (!first) return null

  const db = getDb()
  const [followUps, replies, recruiter] = await Promise.all([
    db
      .select()
      .from(schema.outreachEmails)
      .where(and(eq(schema.outreachEmails.userId, userId), eq(schema.outreachEmails.threadId, first.id)))
      .orderBy(asc(schema.outreachEmails.createdAt)),
    db
      .select()
      .from(schema.outreachReplies)
      .where(and(eq(schema.outreachReplies.userId, userId), eq(schema.outreachReplies.emailId, first.id)))
      .orderBy(asc(schema.outreachReplies.createdAt)),
    getRecruiter(userId, first.recruiterId),
  ])
  if (!recruiter) return null
  return {
    email: toDetail(first),
    followUps: followUps.map(toDetail),
    replies: replies.map(
      (reply): ReplyRecord => ({
        id: reply.id,
        body: reply.body,
        intent: reply.intent as ReplyIntent,
        summary: reply.summary,
        suggestedReply: reply.suggestedReply,
        createdAt: isoOrNow(reply.createdAt),
      })
    ),
    recruiter: { id: recruiter.id, email: recruiter.email, name: recruiter.name, company: recruiter.company, title: recruiter.title },
  }
}

export async function saveReply(
  userId: string,
  threadId: string,
  reply: { body: string; intent: ReplyIntent; summary: string; suggestedReply: string },
  stage: ThreadStage
): Promise<ReplyRecord> {
  const db = getDb()
  const [row] = await db
    .insert(schema.outreachReplies)
    .values({ userId, emailId: threadId, ...reply })
    .returning()
  await db
    .update(schema.outreachEmails)
    .set({ status: stage, updatedAt: new Date() })
    .where(and(eq(schema.outreachEmails.id, threadId), eq(schema.outreachEmails.userId, userId)))
  return {
    id: row.id,
    body: row.body,
    intent: row.intent as ReplyIntent,
    summary: row.summary,
    suggestedReply: row.suggestedReply,
    createdAt: isoOrNow(row.createdAt),
  }
}

/** How many first emails were written from each tailored copy, and how many of those went out. */
export async function outreachByTailoring(userId: string): Promise<Record<string, { emails: number; sent: number }>> {
  const result = await getDb().execute(sql`
    select tailoring_id, count(*)::int as emails, count(*) filter (where sent_at is not null)::int as sent
    from outreach_emails
    where user_id = ${userId} and thread_id is null and tailoring_id is not null
    group by tailoring_id`)
  const counts: Record<string, { emails: number; sent: number }> = {}
  for (const row of result.rows as Row[]) {
    counts[String(row.tailoring_id)] = { emails: Number(row.emails), sent: Number(row.sent) }
  }
  return counts
}

// ─── Profile and mailbox ─────────────────────────────────────────────────────

export async function getOutreachProfile(userId: string): Promise<OutreachProfile> {
  const [row] = await getDb()
    .select()
    .from(schema.outreachProfiles)
    .where(eq(schema.outreachProfiles.userId, userId))
    .limit(1)
  if (!row) return { ...EMPTY_PROFILE }
  const parsed = OutreachProfileSchema.safeParse({
    senderName: row.senderName,
    phone: row.phone,
    links: row.links,
    availability: row.availability,
    highlights: row.highlights,
    trackOpens: row.trackOpens,
  })
  return parsed.success ? parsed.data : { ...EMPTY_PROFILE, trackOpens: row.trackOpens }
}

export async function saveOutreachProfile(userId: string, profile: OutreachProfile): Promise<void> {
  const values = { ...profile, updatedAt: new Date() }
  await getDb()
    .insert(schema.outreachProfiles)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: schema.outreachProfiles.userId, set: values })
}

const isProvider = (value: string): value is MailProviderId => (MAIL_PROVIDER_IDS as string[]).includes(value)

export async function getMailboxStatus(userId: string): Promise<MailboxStatus | null> {
  const [row] = await getDb()
    .select({
      provider: schema.mailAccounts.provider,
      address: schema.mailAccounts.address,
      host: schema.mailAccounts.host,
      port: schema.mailAccounts.port,
      verifiedAt: schema.mailAccounts.verifiedAt,
    })
    .from(schema.mailAccounts)
    .where(eq(schema.mailAccounts.userId, userId))
    .limit(1)
  if (!row || !isProvider(row.provider)) return null
  return { provider: row.provider, address: row.address, host: row.host, port: row.port, verifiedAt: isoOrNow(row.verifiedAt) }
}

/**
 * The mailbox with its password, for signing in to send. Null when none is
 * connected, or when its password can't be read any more (NEXTAUTH_SECRET
 * changed): then the user connects it again.
 */
export async function getMailboxLogin(userId: string): Promise<MailboxLogin | null> {
  const [row] = await getDb()
    .select()
    .from(schema.mailAccounts)
    .where(eq(schema.mailAccounts.userId, userId))
    .limit(1)
  if (!row || !isProvider(row.provider)) return null
  const password = decryptSecret(row.password)
  if (password === null) return null
  return { provider: row.provider, host: row.host, port: row.port, address: row.address, password }
}

export async function saveMailbox(userId: string, login: MailboxLogin): Promise<void> {
  const now = new Date()
  const values = {
    provider: login.provider,
    host: login.host,
    port: login.port,
    address: login.address,
    password: encryptSecret(login.password),
    verifiedAt: now,
    updatedAt: now,
  }
  await getDb()
    .insert(schema.mailAccounts)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: schema.mailAccounts.userId, set: values })
}

export async function deleteMailbox(userId: string): Promise<void> {
  await getDb().delete(schema.mailAccounts).where(eq(schema.mailAccounts.userId, userId))
}
