import { readApiError } from '@/components/user/billing-client'
import type { CoverLetterTone } from '@/lib/cover-letter'
import type { TailorLevel } from '@/lib/tailor/levels'
import type { MailboxStatus, OutreachProfile, ThreadStage } from '@/lib/outreach/model'
import type { OutreachStats } from '@/lib/outreach/stats'
import type {
  CompanyNote,
  EmailDetail,
  EmailSource,
  ImportSummary,
  OutreachSetup,
  RecruiterSummary,
  ReplyRecord,
  ThreadDetail,
  ThreadSummary,
} from '@/lib/outreach/types'
import { AISettings } from '@/lib/settings-storage'

/** The Outreach routes, from the browser. Every failure throws an ApiError with the route's message and code. */

async function call<T>(path: string, fallback: string, init: { method?: string; json?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    cache: 'no-store',
    headers: init.json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
  })
  if (!res.ok) throw await readApiError(res, fallback)
  return (res.status === 204 ? undefined : await res.json()) as T
}

/** The owner writes with their own AI settings; everyone else runs on Chills AI and sends nothing. */
export function ownerAi(isOwner: boolean, settings: AISettings) {
  return isOwner
    ? { provider: settings.provider, apiKey: settings.apiKeys[settings.provider], model: settings.models[settings.provider] }
    : {}
}

export interface WriteRequest {
  recruiterId: string
  source: EmailSource
  jobTitle?: string
  jobDescription?: string
  tone?: CoverLetterTone
  /**
   * "original" attaches the chosen resume as it is; "tailored" rewrites a copy
   * of it for this job first and attaches that. The saved resume never changes.
   */
  resumeMode?: 'original' | 'tailored'
  /** How far to tailor, when tailoring. */
  level?: TailorLevel
  /** Write a cover letter in the same call as the email, and attach it too. */
  coverLetter?: boolean
  notes?: string
  attachResume?: boolean
  replaceDraftId?: string
  blank?: boolean
  /** Read the company's website first; on unless turned off. */
  research?: boolean
}

export interface DraftChange {
  subject: string
  body: string
  attachResume: boolean
  /** Whether the cover letter written with it goes out too. */
  attachCoverLetter?: boolean
  source?: EmailSource
}

export interface OutreachSummary {
  stats: OutreachStats
  byTailoring: Record<string, { emails: number; sent: number }>
  mailboxConnected: boolean
}

/** One recruiter in the published directory. No address until it is taken. */
export interface DirectoryEntry {
  id: string
  name: string
  company: string
  title: string
  field: string
  location: string
  batch: string
  /** Already in this account's own list. */
  taken: boolean
  /** Places left before the contact closes to new accounts. */
  spotsLeft: number
}

export interface DirectoryList {
  entries: DirectoryEntry[]
  fields: Array<{ field: string; open: number }>
  latestBatch: string | null
  weeklyLeft: number
  weeklyLimit: number
}

/** A tailored copy an email can be written from and attach. */
export interface TailoringOption {
  id: string
  resumeId: string | null
  resumeTitle: string
  jobTitle: string
  company: string
  createdAt: string
}

export const outreachApi = {
  setup: () => call<OutreachSetup>('/api/outreach/setup', 'Your outreach settings couldn’t be loaded.'),
  saveProfile: (profile: OutreachProfile) =>
    call<{ profile: OutreachProfile }>('/api/outreach/setup', 'Your settings couldn’t be saved.', { method: 'PUT', json: profile }),
  connectMailbox: (input: { provider: string; address: string; password: string; host?: string; port?: number }) =>
    call<{ mailbox: MailboxStatus }>('/api/outreach/mailbox', 'The mailbox couldn’t be connected.', { method: 'PUT', json: input }),
  disconnectMailbox: () => call<void>('/api/outreach/mailbox', 'The mailbox couldn’t be disconnected.', { method: 'DELETE' }),

  recruiters: () => call<{ recruiters: RecruiterSummary[]; limit: number }>('/api/outreach/recruiters', 'Your recruiters couldn’t be loaded.'),
  addRecruiter: (input: { email: string; name: string; company: string; title: string }) =>
    call<{ recruiter: RecruiterSummary }>('/api/outreach/recruiters', 'That recruiter couldn’t be added.', { method: 'POST', json: input }),
  editRecruiter: (id: string, patch: { name: string; company: string; title: string }) =>
    call<{ ok: true }>(`/api/outreach/recruiters/${id}`, 'Those changes couldn’t be saved.', { method: 'PATCH', json: patch }),
  removeRecruiters: (ids: string[]) =>
    call<{ deleted: number }>('/api/outreach/recruiters/delete', 'Those recruiters couldn’t be removed.', { method: 'POST', json: { ids } }),
  importFile: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return call<ImportSummary>('/api/outreach/recruiters/import', 'That file couldn’t be imported.', { method: 'POST', form })
  },
  importSheet: (sheetUrl: string) =>
    call<ImportSummary>('/api/outreach/recruiters/import', 'That sheet couldn’t be imported.', { method: 'POST', json: { sheetUrl } }),
  importText: (text: string) =>
    call<ImportSummary>('/api/outreach/recruiters/import', 'That list couldn’t be imported.', { method: 'POST', json: { text } }),

  threads: () => call<{ threads: ThreadSummary[] }>('/api/outreach/emails', 'Your emails couldn’t be loaded.'),
  thread: (id: string) => call<ThreadDetail>(`/api/outreach/emails/${id}`, 'That email couldn’t be loaded.'),
  write: (request: WriteRequest, ai: object) =>
    call<{ email: EmailDetail; company: CompanyNote | null }>('/api/outreach/emails', 'The email couldn’t be written.', {
      method: 'POST',
      json: { ...request, ...ai },
    }),
  saveDraft: (id: string, change: DraftChange) =>
    call<{ email: EmailDetail }>(`/api/outreach/emails/${id}`, 'Your changes couldn’t be saved.', {
      method: 'PATCH',
      json: { action: 'edit', ...change },
    }),
  setStage: (id: string, stage: ThreadStage) =>
    call<ThreadDetail>(`/api/outreach/emails/${id}`, 'That couldn’t be updated.', { method: 'PATCH', json: { action: 'stage', stage } }),
  markSentByHand: (id: string) =>
    call<{ email: EmailDetail }>(`/api/outreach/emails/${id}`, 'That couldn’t be updated.', { method: 'PATCH', json: { action: 'sentByHand' } }),
  remove: (id: string) => call<void>(`/api/outreach/emails/${id}`, 'That email couldn’t be deleted.', { method: 'DELETE' }),
  send: (id: string) => call<{ email: EmailDetail }>(`/api/outreach/emails/${id}/send`, 'The email couldn’t be sent.', { method: 'POST' }),
  followUp: (id: string, tone: CoverLetterTone, ai: object) =>
    call<{ email: EmailDetail }>(`/api/outreach/emails/${id}/follow-up`, 'The follow-up couldn’t be written.', {
      method: 'POST',
      json: { tone, ...ai },
    }),
  readReply: (id: string, reply: string, ai: object) =>
    call<{ reply: ReplyRecord; stage: ThreadStage }>(`/api/outreach/emails/${id}/replies`, 'That reply couldn’t be read.', {
      method: 'POST',
      json: { reply, ...ai },
    }),
  summary: () => call<OutreachSummary>('/api/outreach/summary', 'Your outreach couldn’t be loaded.'),

  /** The tailored copies an email can be written from. Loaded with the recruiters, never separately. */
  tailorings: async () =>
    (await call<{ tailorings: TailoringOption[] }>('/api/tailorings', 'Your tailored copies couldn’t be loaded.')).tailorings ?? [],
}

/** The recruiters Chills publishes, and taking them into your own list. */
export const directoryApi = {
  list: (filter: { field?: string; q?: string; newOnly?: boolean }) => {
    const params = new URLSearchParams()
    if (filter.field) params.set('field', filter.field)
    if (filter.q) params.set('q', filter.q)
    if (filter.newOnly) params.set('new', '1')
    const query = params.toString()
    return call<DirectoryList>(`/api/outreach/directory${query ? `?${query}` : ''}`, 'The recruiter directory couldn’t be loaded.')
  },
  take: (ids: string[]) =>
    call<{ added: number; skipped: number; overLimit: number; weeklyLeft: number }>(
      '/api/outreach/directory/take',
      'Those recruiters couldn’t be added.',
      { method: 'POST', json: { ids } }
    ),
}

/** What the Outreach screen was opened for, when it came from a tailored copy. */
export interface OutreachContext {
  tailoringId: string
  jobTitle: string
  company: string
}

export function describeTailoring(item: { jobTitle: string; company: string }): string {
  if (item.jobTitle && item.company) return `${item.jobTitle} at ${item.company}`
  return item.jobTitle || item.company || 'Tailored resume'
}
