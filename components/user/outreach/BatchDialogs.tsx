'use client'
import { useState } from 'react'
import { Close, Send, Wand } from '@/components/brand/Icons'
import { cardClass, errorBox, inputClass, primaryButton, ResumeSummary, secondaryButton } from '@/components/user/shared'
import { COVER_LETTER_TONES, CoverLetterTone, TONE_LABELS } from '@/lib/cover-letter'
import { BATCH_SEND_GAP_MS } from '@/lib/outreach/model'
import type { RecruiterSummary } from '@/lib/outreach/types'
import Dialog from '@/components/user/outreach/Dialog'
import { Field, Toggle } from '@/components/user/outreach/controls'
import type { TailoringOption } from '@/components/user/outreach/Composer'
import { describeTailoring, OutreachContext } from '@/components/user/outreach/outreach-client'

/** Writing or sending several emails at once, and the progress while it runs. */

export interface BatchWriteOptions {
  /** "best" picks, for each recruiter, a tailored copy for their company when there is one. */
  source: 'best' | string
  tone: CoverLetterTone
  jobTitle: string
  notes: string
  attachResume: boolean
}

const recipientName = (recruiter: RecruiterSummary) => recruiter.name || recruiter.email

function Recipients({ recruiters }: { recruiters: RecruiterSummary[] }) {
  return (
    <ul className="max-h-48 overflow-y-auto rounded-[8px] border-[1.6px] border-[var(--color-ink)] divide-y divide-[var(--color-border-soft)] bg-[var(--color-bg)]">
      {recruiters.map((recruiter) => (
        <li key={recruiter.id} className="px-3 py-2 text-sm flex justify-between gap-3">
          <span className="font-bold break-words">{recipientName(recruiter)}</span>
          <span className="text-[var(--color-text-muted)] text-right break-words">{recruiter.company}</span>
        </li>
      ))}
    </ul>
  )
}

export function BatchWriteDialog({
  recruiters,
  skipped,
  resumes,
  tailorings,
  context,
  draftsLeft,
  onStart,
  onClose,
}: {
  recruiters: RecruiterSummary[]
  /** Selected recruiters left out because they already have an email. */
  skipped: number
  resumes: ResumeSummary[]
  tailorings: TailoringOption[]
  context: OutreachContext | null
  /** AI-written emails left this month; null for the owner. */
  draftsLeft: number | null
  onStart: (options: BatchWriteOptions) => void
  onClose: () => void
}) {
  const [options, setOptions] = useState<BatchWriteOptions>({
    source: context ? `tailoring:${context.tailoringId}` : 'best',
    tone: 'professional',
    jobTitle: '',
    notes: '',
    attachResume: true,
  })
  const tooMany = draftsLeft !== null && recruiters.length > draftsLeft
  const usesTailoring = options.source.startsWith('tailoring:')

  return (
    <Dialog
      title={`Write ${recruiters.length} email${recruiters.length === 1 ? '' : 's'}`}
      subtitle="Each one is personal to its recruiter. Nothing is sent until you send it."
      icon={<Wand size={20} />}
      width="max-w-xl"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={secondaryButton}>
            Cancel
          </button>
          <button onClick={() => onStart(options)} disabled={recruiters.length === 0} className={primaryButton}>
            <Wand size={16} /> Write {recruiters.length} draft{recruiters.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {recruiters.length > 0 ? <Recipients recruiters={recruiters} /> : <div className={errorBox}>Everyone selected already has an email.</div>}
        {skipped > 0 && (
          <p className="text-xs text-[var(--color-text-muted)]">
            {skipped} selected recruiter{skipped === 1 ? ' already has' : 's already have'} an email, so {skipped === 1 ? 'is' : 'are'} left out.
          </p>
        )}
        <Field label="Write from">
          <select value={options.source} onChange={(e) => setOptions({ ...options, source: e.target.value })} className={inputClass}>
            <option value="best">Best match: a copy tailored for each recruiter’s company, else my newest resume</option>
            {tailorings.length > 0 && (
              <optgroup label="Tailored copies">
                {tailorings.slice(0, 50).map((t) => (
                  <option key={t.id} value={`tailoring:${t.id}`}>
                    {describeTailoring(t)} · {t.resumeTitle}
                  </option>
                ))}
              </optgroup>
            )}
            {resumes.length > 0 && (
              <optgroup label="Saved resumes">
                {resumes.map((r) => (
                  <option key={r.id} value={`resume:${r.id}`}>
                    {r.title}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>
        {!usesTailoring && (
          <Field label="Role" optional hint="Leave it blank to ask each recruiter about roles that fit you.">
            <input value={options.jobTitle} onChange={(e) => setOptions({ ...options, jobTitle: e.target.value })} maxLength={160} className={inputClass} />
          </Field>
        )}
        <div className="flex flex-wrap gap-2">
          {COVER_LETTER_TONES.map((id) => (
            <button
              key={id}
              onClick={() => setOptions({ ...options, tone: id })}
              aria-pressed={options.tone === id}
              title={TONE_LABELS[id].hint}
              className={`nb-chip px-3 py-1 ${options.tone === id ? 'bg-[var(--color-yellow)] text-[#0a0a0a]' : 'bg-[var(--color-surface)]'}`}
            >
              {TONE_LABELS[id].label}
            </button>
          ))}
        </div>
        <Field label="Mention in every email" optional>
          <input value={options.notes} onChange={(e) => setOptions({ ...options, notes: e.target.value })} maxLength={600} className={inputClass} />
        </Field>
        <Toggle checked={options.attachResume} onChange={(attachResume) => setOptions({ ...options, attachResume })} label="Attach the resume as a PDF" />
        {tooMany && (
          <div className={errorBox}>
            You have {draftsLeft} AI-written email{draftsLeft === 1 ? '' : 's'} left this month, so the batch will stop after {draftsLeft}.
          </div>
        )}
      </div>
    </Dialog>
  )
}

export function BatchSendDialog({
  recruiters,
  skipped,
  mailbox,
  sendsLeft,
  onStart,
  onClose,
}: {
  recruiters: RecruiterSummary[]
  skipped: number
  mailbox: string
  /** Sends left today; null for the owner. */
  sendsLeft: number | null
  onStart: () => void
  onClose: () => void
}) {
  const seconds = Math.round(((recruiters.length - 1) * BATCH_SEND_GAP_MS) / 1000)
  return (
    <Dialog
      title={`Send ${recruiters.length} email${recruiters.length === 1 ? '' : 's'}?`}
      subtitle={`From ${mailbox}, each with its own resume attached.`}
      icon={<Send size={18} />}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={secondaryButton}>
            Not yet
          </button>
          <button onClick={onStart} disabled={recruiters.length === 0} className={primaryButton}>
            <Send size={16} /> Send {recruiters.length}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {recruiters.length > 0 ? <Recipients recruiters={recruiters} /> : <div className={errorBox}>None of the selected recruiters has a draft to send.</div>}
        {skipped > 0 && (
          <p className="text-xs text-[var(--color-text-muted)]">
            {skipped} selected recruiter{skipped === 1 ? ' has' : 's have'} no draft to send, so {skipped === 1 ? 'is' : 'are'} left out.
          </p>
        )}
        <p className="text-sm text-[var(--color-text-muted)]">
          They go out one at a time, a few seconds apart{seconds > 0 ? ` (about ${seconds < 60 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`})` : ''}, so
          your mailbox doesn’t look like it’s spamming. Keep this page open until it finishes. Sent emails can’t be taken back.
        </p>
        {sendsLeft !== null && recruiters.length > sendsLeft && (
          <div className={errorBox}>You can send {sendsLeft} more today, so the batch will stop there. Sending starts again at midnight UTC.</div>
        )}
      </div>
    </Dialog>
  )
}

export interface BatchState {
  kind: 'write' | 'send'
  total: number
  done: number
  current: string
  failed: Array<{ who: string; error: string }>
  finished: boolean
  /** Why the batch stopped early, if it did. */
  stopped: string | null
}

export function BatchProgress({ batch, onStop, onDismiss }: { batch: BatchState; onStop: () => void; onDismiss: () => void }) {
  const verb = batch.kind === 'write' ? 'Writing' : 'Sending'
  const pastVerb = batch.kind === 'write' ? 'written' : 'sent'
  const succeeded = batch.done - batch.failed.length
  const percent = batch.total > 0 ? Math.round((batch.done / batch.total) * 100) : 0
  return (
    <div className={`${cardClass} p-4 space-y-3 ${batch.finished ? 'bg-[var(--color-surface)]' : 'bg-[var(--color-sky-soft)]'}`} role="status" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-black">
          {batch.finished
            ? `${succeeded} of ${batch.total} ${pastVerb}${batch.stopped ? ', then stopped' : ''}`
            : `${verb} ${batch.done + 1} of ${batch.total}${batch.current ? `: ${batch.current}` : ''}`}
        </p>
        {batch.finished ? (
          <button onClick={onDismiss} className={secondaryButton} aria-label="Dismiss">
            <Close size={14} />
          </button>
        ) : (
          <button onClick={onStop} className={secondaryButton}>
            Stop
          </button>
        )}
      </div>
      <div className="h-3 rounded-full border-[1.6px] border-[var(--color-ink)] bg-[var(--color-surface)] overflow-hidden">
        <div className="h-full bg-[var(--color-accent)] transition-all duration-300" style={{ width: `${percent}%` }} />
      </div>
      {batch.stopped && <div className={errorBox}>{batch.stopped}</div>}
      {batch.failed.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-bold">
            {batch.failed.length} didn’t go through
          </summary>
          <ul className="mt-2 space-y-1">
            {batch.failed.map((item, i) => (
              <li key={i}>
                <span className="font-semibold">{item.who}</span>: <span className="text-[var(--color-text-muted)]">{item.error}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
