'use client'
import { useCallback, useEffect, useState } from 'react'
import { Copy, ExternalLink, Inbox, Refresh, Reply, Trash, Wand } from '@/components/brand/Icons'
import { ApiError } from '@/components/user/billing-client'
import { errorBox, inputClass, linkButton, primaryButton, ResumeSummary, secondaryButton, successBox } from '@/components/user/shared'
import { BILLING_CODES } from '@/lib/billing/types'
import type { BillingStatus } from '@/lib/billing/types'
import { COVER_LETTER_TONES, CoverLetterTone, TONE_LABELS } from '@/lib/cover-letter'
import {
  FOLLOW_UP_AFTER_DAYS,
  followUpDue,
  gmailComposeUrl,
  INTENT_LABELS,
  isThreadStage,
  LIMITS,
  outlookComposeUrl,
  STATUS_LABELS,
  THREAD_STAGES,
  ThreadStage,
} from '@/lib/outreach/model'
import { followUpSubject } from '@/lib/outreach/prompt'
import type { EmailDetail, ReplyRecord, ThreadDetail } from '@/lib/outreach/types'
import { AISettings } from '@/lib/settings-storage'
import Dialog from '@/components/user/outreach/Dialog'
import EmailEditor from '@/components/user/outreach/EmailEditor'
import { attachmentLabel, TailoringOption } from '@/components/user/outreach/Composer'
import { relativeDay, StatusChip } from '@/components/user/outreach/controls'
import { outreachApi, ownerAi } from '@/components/user/outreach/outreach-client'

/**
 * One conversation with a recruiter: what was sent and when, whether it was
 * opened, their replies with a suggested answer, follow-ups, and where it stands.
 */

interface ThreadDialogProps {
  threadId: string
  resumes: ResumeSummary[]
  tailorings: TailoringOption[]
  mailbox: string | null
  billing: BillingStatus | null | undefined
  isOwner: boolean
  settings: AISettings
  onClose: () => void
  onChanged: () => void
  onOpenSetup: () => void
  onOpenBilling: () => void
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

const INTENT_FILL: Record<string, string> = {
  interested: 'bg-[var(--color-accent)]',
  interview: 'bg-[var(--color-accent-strong)]',
  question: 'bg-[var(--color-sky)]',
  referral: 'bg-[var(--color-sky-soft)]',
  rejection: 'bg-[var(--color-error-highlight)]',
  automatic: 'bg-[var(--color-surface-offset)]',
  unclear: 'bg-[var(--color-yellow-soft)]',
}

export default function ThreadDialog(props: ThreadDialogProps) {
  const { threadId, resumes, tailorings, isOwner, settings } = props
  const [thread, setThread] = useState<ThreadDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'stage' | 'followUp' | 'reply' | 'delete' | null>(null)
  const [tone, setTone] = useState<CoverLetterTone>('professional')
  const [reply, setReply] = useState('')
  const [limitHit, setLimitHit] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(
    () =>
      outreachApi
        .thread(threadId)
        .then(setThread)
        .catch((err) => setError(errorText(err))),
    [threadId]
  )

  useEffect(() => {
    load()
  }, [load])

  async function run(kind: NonNullable<typeof busy>, action: () => Promise<void>) {
    setBusy(kind)
    setError(null)
    setNotice(null)
    setLimitHit(false)
    try {
      await action()
    } catch (err) {
      if (err instanceof ApiError && err.code === BILLING_CODES.draftLimit) setLimitHit(true)
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  const changeStage = (stage: ThreadStage) =>
    run('stage', async () => {
      setThread(await outreachApi.setStage(threadId, stage))
      props.onChanged()
    })

  const writeFollowUp = () =>
    run('followUp', async () => {
      await outreachApi.followUp(threadId, tone, ownerAi(isOwner, settings))
      await load()
      props.onChanged()
    })

  const readReply = () =>
    run('reply', async () => {
      const result = await outreachApi.readReply(threadId, reply, ownerAi(isOwner, settings))
      setReply('')
      await load()
      setNotice(`Read as “${INTENT_LABELS[result.reply.intent]}”. It now shows as ${STATUS_LABELS[result.stage]}.`)
      props.onChanged()
    })

  const remove = () => {
    if (!window.confirm('Delete this conversation? Its emails, follow-ups and replies are removed from ResMod. Emails already sent stay in your mailbox.')) return
    run('delete', async () => {
      await outreachApi.remove(threadId)
      props.onChanged()
      props.onClose()
    })
  }

  const recruiter = thread?.recruiter
  const first = thread?.email
  const sentFollowUps = thread?.followUps.filter((email) => email.sentAt) ?? []
  const draftFollowUp = thread?.followUps.find((email) => email.status === 'draft') ?? null
  const lastSentAt = [first?.sentAt, ...sentFollowUps.map((email) => email.sentAt)].filter(Boolean).pop() ?? null
  const stage = first && isThreadStage(first.status) ? first.status : null
  const due = stage && lastSentAt ? followUpDue({ status: stage, lastSentAt, followUps: sentFollowUps.length }) : false
  const canFollowUp = Boolean(stage) && !draftFollowUp && sentFollowUps.length < LIMITS.followUps

  return (
    <Dialog
      title={recruiter ? recruiter.name || recruiter.email : 'Conversation'}
      subtitle={recruiter ? [recruiter.title, recruiter.company, recruiter.name ? recruiter.email : ''].filter(Boolean).join(' · ') : undefined}
      icon={<Inbox size={20} />}
      width="max-w-3xl"
      busy={busy !== null}
      onClose={props.onClose}
      footer={
        <>
          <button onClick={remove} disabled={!thread || busy !== null} className={`${secondaryButton} mr-auto text-[var(--color-error)]`}>
            <Trash size={14} /> {busy === 'delete' ? 'Deleting…' : 'Delete conversation'}
          </button>
          <button onClick={props.onClose} disabled={busy !== null} className={primaryButton}>
            Done
          </button>
        </>
      }
    >
      {!thread ? (
        error ? <div className={errorBox}>{error}</div> : <p className="text-sm font-semibold text-[var(--color-text-muted)]">Loading the conversation…</p>
      ) : (
        <div className="space-y-6">
          {stage && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm font-bold">
                Where it stands
                <select
                  value={stage}
                  onChange={(e) => changeStage(e.target.value as ThreadStage)}
                  disabled={busy !== null}
                  className={`${inputClass} w-auto py-1.5`}
                >
                  {THREAD_STAGES.map((option) => (
                    <option key={option} value={option}>
                      {STATUS_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>
              {due && <span className="nb-chip text-[11px] bg-[var(--color-yellow)] text-[#0a0a0a]">Follow-up due</span>}
            </div>
          )}

          {error && (
            <div className={errorBox}>
              {error}
              {limitHit && (
                <button onClick={props.onOpenBilling} className={`${linkButton} ml-2`}>
                  See plans
                </button>
              )}
            </div>
          )}
          {notice && !error && <div className={successBox}>{notice}</div>}

          <ol className="relative space-y-4 pl-6 before:absolute before:left-[9px] before:top-2 before:bottom-2 before:w-[2px] before:bg-[var(--color-border-soft)]">
            {first && <SentEmail email={first} label="First email" />}
            {thread.followUps.map((email, i) =>
              email.status === 'draft' ? (
                <li key={email.id} className="relative">
                  <Dot fill="bg-[var(--color-yellow)]" />
                  <p className="text-xs font-black uppercase tracking-wider text-[var(--color-text-faint)] mb-2">Follow-up draft</p>
                  <EmailEditor
                    email={email}
                    recruiter={thread.recruiter}
                    mailbox={props.mailbox}
                    attachment={attachmentLabel(email.source, resumes, tailorings)}
                    onChange={() => {
                      load()
                      props.onChanged()
                    }}
                    onDeleted={() => {
                      load()
                      props.onChanged()
                    }}
                    onOpenSetup={props.onOpenSetup}
                  />
                </li>
              ) : (
                <SentEmail key={email.id} email={email} label={`Follow-up ${i + 1}`} />
              )
            )}
            {thread.replies.map((item) => (
              <ReplyItem key={item.id} reply={item} to={thread.recruiter.email} subject={followUpSubject(first?.subject ?? '')} />
            ))}
          </ol>

          {stage && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-bg)] p-4 space-y-3">
                <p className="font-black flex items-center gap-2">
                  <Reply size={16} /> They replied?
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">Paste their reply to see what they want and get an answer to send.</p>
                <textarea
                  rows={4}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  maxLength={LIMITS.reply}
                  disabled={busy !== null}
                  placeholder="Paste the recruiter’s reply…"
                  className={`${inputClass} resize-y`}
                />
                <button onClick={readReply} disabled={busy !== null || reply.trim().length < 10} className={primaryButton}>
                  <Wand size={15} /> {busy === 'reply' ? 'Reading…' : 'Read the reply'}
                </button>
              </div>
              <div className="rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-bg)] p-4 space-y-3">
                <p className="font-black flex items-center gap-2">
                  <Refresh size={16} /> No answer yet?
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {draftFollowUp
                    ? 'A follow-up is waiting above. Send it or delete it first.'
                    : sentFollowUps.length >= LIMITS.followUps
                      ? `You’ve followed up ${LIMITS.followUps} times. Try someone else at the company.`
                      : due
                        ? `It’s been ${FOLLOW_UP_AFTER_DAYS}+ days since your last email: a good time for a short follow-up.`
                        : `A follow-up works best ${FOLLOW_UP_AFTER_DAYS} or more days after your last email.`}
                </p>
                {canFollowUp && (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {COVER_LETTER_TONES.map((id) => (
                        <button
                          key={id}
                          onClick={() => setTone(id)}
                          aria-pressed={tone === id}
                          disabled={busy !== null}
                          className={`nb-chip px-2.5 py-0.5 text-xs ${tone === id ? 'bg-[var(--color-yellow)] text-[#0a0a0a]' : 'bg-[var(--color-surface)]'}`}
                        >
                          {TONE_LABELS[id].label}
                        </button>
                      ))}
                    </div>
                    <button onClick={writeFollowUp} disabled={busy !== null} className={due ? primaryButton : secondaryButton}>
                      <Wand size={15} /> {busy === 'followUp' ? 'Writing…' : 'Write a follow-up'}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}

function Dot({ fill }: { fill: string }) {
  return <span className={`absolute -left-6 top-1 w-5 h-5 rounded-full border-[1.6px] border-[var(--color-ink)] ${fill}`} aria-hidden />
}

function SentEmail({ email, label }: { email: EmailDetail; label: string }) {
  const [open, setOpen] = useState(false)
  const sent = Boolean(email.sentAt)
  return (
    <li className="relative">
      <Dot fill={sent ? 'bg-[var(--color-sky)]' : 'bg-[var(--color-surface)]'} />
      <div className="rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-surface)] p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-black uppercase tracking-wider text-[var(--color-text-faint)]">{label}</span>
          {sent ? (
            <span className="text-[var(--color-text-muted)]">
              sent {relativeDay(email.sentAt)}
              {!email.tracked && ' · sent outside ResMod or not tracked'}
            </span>
          ) : (
            <StatusChip status={email.status} />
          )}
          {email.openedAt && (
            <span className="nb-chip text-[11px] bg-[var(--color-yellow-soft)]">
              Opened {email.openCount > 1 ? `${email.openCount}×` : relativeDay(email.openedAt)}
            </span>
          )}
        </div>
        <p className="font-bold leading-snug">{email.subject || '(no subject)'}</p>
        <button onClick={() => setOpen(!open)} className={linkButton}>
          {open ? 'Hide the email' : 'Show the email'}
        </button>
        {open && <p className="text-sm whitespace-pre-wrap leading-relaxed text-[var(--color-text-muted)]">{email.body}</p>}
      </div>
    </li>
  )
}

function ReplyItem({ reply, to, subject }: { reply: ReplyRecord; to: string; subject: string }) {
  const [showOriginal, setShowOriginal] = useState(false)
  const [copied, setCopied] = useState(false)
  const compose = { to, subject, body: reply.suggestedReply }

  async function copy() {
    try {
      await navigator.clipboard.writeText(reply.suggestedReply)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <li className="relative">
      <Dot fill="bg-[var(--color-accent)]" />
      <div className="rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-accent-soft)] p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-black uppercase tracking-wider text-[var(--color-text-faint)]">Their reply</span>
          <span className={`nb-chip text-[11px] text-[#0a0a0a] ${INTENT_FILL[reply.intent] ?? ''}`}>{INTENT_LABELS[reply.intent]}</span>
          <span className="text-[var(--color-text-muted)]">added {relativeDay(reply.createdAt)}</span>
        </div>
        <p className="text-sm font-semibold">{reply.summary}</p>
        <button onClick={() => setShowOriginal(!showOriginal)} className={linkButton}>
          {showOriginal ? 'Hide their reply' : 'Show their reply'}
        </button>
        {showOriginal && <p className="text-sm whitespace-pre-wrap text-[var(--color-text-muted)]">{reply.body}</p>}
        {reply.suggestedReply && (
          <div className="rounded-[8px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-surface)] p-3 space-y-2">
            <p className="text-[11px] font-black uppercase tracking-wider text-[var(--color-text-faint)]">A reply you could send</p>
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{reply.suggestedReply}</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={copy} className={secondaryButton}>
                <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
              </button>
              <a href={gmailComposeUrl(compose)} target="_blank" rel="noopener noreferrer" className={secondaryButton}>
                Reply in Gmail <ExternalLink size={14} />
              </a>
              <a href={outlookComposeUrl(compose)} target="_blank" rel="noopener noreferrer" className={secondaryButton}>
                Outlook <ExternalLink size={14} />
              </a>
            </div>
            <p className="text-[11px] text-[var(--color-text-muted)]">
              Replying from your mail app keeps it in the same conversation: open their email there and paste this in.
            </p>
          </div>
        )}
      </div>
    </li>
  )
}
