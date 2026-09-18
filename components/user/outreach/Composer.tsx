'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Working from '@/components/user/Working'
import { ArrowRight, Pencil, Refresh, Sparkles, Wand } from '@/components/brand/Icons'
import { ApiError } from '@/components/user/billing-client'
import { cardClass, errorBox, inputClass, linkButton, primaryButton, ResumeSummary, secondaryButton, successBox } from '@/components/user/shared'
import { BILLING_CODES } from '@/lib/billing/types'
import type { BillingStatus } from '@/lib/billing/types'
import { COVER_LETTER_TONES, CoverLetterTone, TONE_LABELS } from '@/lib/cover-letter'
import { followUpDue, LIMITS } from '@/lib/outreach/model'
import type { EmailDetail, EmailSource, RecruiterSummary, ThreadSummary } from '@/lib/outreach/types'
import { AISettings } from '@/lib/settings-storage'
import EmailEditor from '@/components/user/outreach/EmailEditor'
import { Field, relativeDay, StatusChip, Toggle } from '@/components/user/outreach/controls'
import { describeTailoring, outreachApi, OutreachContext, ownerAi, TailoringOption } from '@/components/user/outreach/outreach-client'

/**
 * Everything for one recruiter: writing an email (from a saved resume or a
 * tailored copy), editing and sending the draft, or, once it's sent, where the
 * conversation stands.
 */

export type { TailoringOption }

export interface ComposerProps {
  recruiter: RecruiterSummary
  /** The newest thread with this recruiter. */
  thread: ThreadSummary | null
  resumes: ResumeSummary[]
  tailorings: TailoringOption[]
  context: OutreachContext | null
  mailbox: string | null
  billing: BillingStatus | null | undefined
  isOwner: boolean
  settings: AISettings
  /** A batch is running: writing and sending wait for it. */
  locked: boolean
  onChanged: () => void
  onOpenSetup: () => void
  onOpenThread: (id: string) => void
  onOpenBilling: () => void
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

const sourceKey = (source: EmailSource) => (source ? `${source.kind}:${source.id}` : '')

function parseSourceKey(key: string): EmailSource {
  const [kind, id] = key.split(':')
  return (kind === 'resume' || kind === 'tailoring') && id ? { kind, id } : null
}

/**
 * The resume to write from: the tailored copy the screen was opened for, else
 * one tailored for this recruiter's company, else the newest saved resume.
 */
export function defaultSourceKey(
  recruiter: { company: string },
  context: OutreachContext | null,
  tailorings: TailoringOption[],
  resumes: ResumeSummary[]
): string {
  if (context && tailorings.some((t) => t.id === context.tailoringId)) return `tailoring:${context.tailoringId}`
  const company = recruiter.company.trim().toLowerCase()
  const forCompany = company ? tailorings.find((t) => t.company.trim().toLowerCase() === company) : undefined
  if (forCompany) return `tailoring:${forCompany.id}`
  if (resumes[0]) return `resume:${resumes[0].id}`
  return tailorings[0] ? `tailoring:${tailorings[0].id}` : ''
}

/** How the attached resume is described next to the attachment switch; null when it is gone. */
export function attachmentLabel(source: EmailSource, resumes: ResumeSummary[], tailorings: TailoringOption[]): string | null {
  if (source?.kind === 'tailoring') {
    const tailoring = tailorings.find((t) => t.id === source.id)
    return tailoring ? `Your resume tailored for ${describeTailoring(tailoring)}` : null
  }
  if (source?.kind === 'resume') {
    const resume = resumes.find((r) => r.id === source.id)
    return resume ? `Your saved resume “${resume.title}”` : null
  }
  return null
}

export default function Composer(props: ComposerProps) {
  const { recruiter, thread, resumes, tailorings, context, billing, isOwner, settings, locked } = props
  const [writing, setWriting] = useState(!thread)
  const [draft, setDraft] = useState<EmailDetail | null>(null)
  const [loadingDraft, setLoadingDraft] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [limitHit, setLimitHit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)

  const [source, setSource] = useState(() => defaultSourceKey(recruiter, context, tailorings, resumes))
  const [jobTitle, setJobTitle] = useState(context?.jobTitle ?? '')
  const [jobDescription, setJobDescription] = useState('')
  const [showJobPost, setShowJobPost] = useState(false)
  const [tone, setTone] = useState<CoverLetterTone>('professional')
  const [notes, setNotes] = useState('')
  const [attachResume, setAttachResume] = useState(true)
  const [replacing, setReplacing] = useState<string | null>(null)
  /** Bumped when the AI replaces the draft, so the editor starts over from the new text. */
  const [revision, setRevision] = useState(0)

  const chosen = parseSourceKey(source)
  const chosenTailoring = chosen?.kind === 'tailoring' ? tailorings.find((t) => t.id === chosen.id) : undefined
  const draftsLeft = billing ? Math.max(0, billing.emailDrafts.limit - billing.emailDrafts.used) : null
  const aiOff = !isOwner && billing !== undefined && billing !== null && !billing.platformAi

  // A draft thread is opened in the editor; one just written is already here.
  const draftThreadId = thread && (thread.status === 'draft' || thread.status === 'sending') ? thread.id : null
  const current = useRef<EmailDetail | null>(null)
  useEffect(() => {
    current.current = draft
  })
  useEffect(() => {
    let cancelled = false
    if (!draftThreadId) return
    if (current.current?.id === draftThreadId) return
    setDraft(null)
    setLoadingDraft(true)
    outreachApi
      .thread(draftThreadId)
      .then((detail) => !cancelled && setDraft(detail.email))
      .catch((err) => !cancelled && setError(errorText(err)))
      .finally(() => !cancelled && setLoadingDraft(false))
    return () => {
      cancelled = true
    }
  }, [draftThreadId])

  // A draft sent from somewhere else, such as a batch, is history now.
  const threadId = thread?.id
  const threadSent = thread ? thread.status !== 'draft' && thread.status !== 'sending' : false
  useEffect(() => {
    const held = current.current
    if (threadSent && held && held.id === threadId && held.status === 'draft') setDraft(null)
  }, [threadId, threadSent])

  const sourceGroups = useMemo(
    () => ({
      tailored: tailorings.slice(0, 50),
      saved: resumes,
    }),
    [tailorings, resumes]
  )

  async function write(blank: boolean) {
    setBusy(true)
    setStartedAt(Date.now())
    setError(null)
    setLimitHit(false)
    try {
      const { email } = await outreachApi.write(
        {
          recruiterId: recruiter.id,
          source: chosen,
          jobTitle: chosenTailoring ? '' : jobTitle,
          jobDescription: chosenTailoring ? '' : jobDescription,
          tone,
          notes,
          attachResume,
          blank,
          ...(replacing ? { replaceDraftId: replacing } : {}),
        },
        ownerAi(isOwner, settings)
      )
      setDraft(email)
      setRevision((value) => value + 1)
      setWriting(false)
      setReplacing(null)
      props.onChanged()
    } catch (err) {
      if (err instanceof ApiError && err.code === BILLING_CODES.draftLimit) setLimitHit(true)
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const startRewrite = (email: EmailDetail) => {
    setReplacing(email.id)
    if (email.source) setSource(sourceKey(email.source))
    setAttachResume(email.attachResume)
    setWriting(true)
  }

  const header = (
    <RecruiterHeader recruiter={recruiter} onSaved={props.onChanged} />
  )

  // ---- the sent summary (unless a new draft was just written, and the list hasn't caught up)
  if (thread && !draftThreadId && !writing && !(draft && draft.status === 'draft' && draft.id !== thread.id)) {
    const due = followUpDue(thread)
    return (
      <section className={`${cardClass} p-6 space-y-5`}>
        {header}
        <div className="rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-bg)] p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={thread.status} />
            {thread.openCount > 0 && <span className="nb-chip text-[11px] bg-[var(--color-yellow-soft)]">Opened {thread.openCount}×</span>}
            {thread.replies > 0 && (
              <span className="nb-chip text-[11px] bg-[var(--color-sky-soft)]">
                {thread.replies} repl{thread.replies === 1 ? 'y' : 'ies'}
              </span>
            )}
            {due && <span className="nb-chip text-[11px] bg-[var(--color-yellow)] text-[#0a0a0a]">Follow-up due</span>}
          </div>
          <p className="font-black leading-snug">{thread.subject}</p>
          <p className="text-sm text-[var(--color-text-muted)]">
            Sent {relativeDay(thread.sentAt)}
            {thread.followUps > 0 ? ` · ${thread.followUps} follow-up${thread.followUps === 1 ? '' : 's'}` : ''}
            {thread.jobTitle ? ` · about ${thread.jobTitle}` : ''}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={() => props.onOpenThread(thread.id)} className={primaryButton}>
              {due ? 'Follow up' : 'Open the conversation'} <ArrowRight size={16} />
            </button>
            <button onClick={() => setWriting(true)} className={secondaryButton}>
              <Pencil size={14} /> Write about another role
            </button>
          </div>
        </div>
      </section>
    )
  }

  // ---- the draft editor
  if (!writing && (draftThreadId || draft)) {
    return (
      <section className={`${cardClass} p-6 space-y-5`}>
        {header}
        {draft && draft.status !== 'draft' ? (
          <div className={successBox}>
            Sent to {recruiter.name || recruiter.email}. It’s in your tracker now.{' '}
            <button onClick={() => props.onOpenThread(draft.threadId ?? draft.id)} className={linkButton}>
              Open the conversation
            </button>
          </div>
        ) : loadingDraft || !draft ? (
          error ? <div className={errorBox}>{error}</div> : <p className="text-sm font-semibold text-[var(--color-text-muted)]">Loading the draft…</p>
        ) : (
          <EmailEditor
            key={`${draft.id}-${revision}`}
            email={draft}
            recruiter={recruiter}
            mailbox={props.mailbox}
            attachment={attachmentLabel(draft.source, resumes, tailorings)}
            locked={locked}
            onChange={(email) => {
              setDraft(email)
              if (email.status !== 'draft') props.onChanged()
            }}
            onDeleted={() => {
              setDraft(null)
              setWriting(true)
              props.onChanged()
            }}
            onOpenSetup={props.onOpenSetup}
            extraActions={
              <button onClick={() => startRewrite(draft)} disabled={locked} className={secondaryButton}>
                <Refresh size={14} /> Rewrite with AI
              </button>
            }
          />
        )}
      </section>
    )
  }

  // ---- writing
  const noResumes = resumes.length === 0 && tailorings.length === 0
  return (
    <section className={`${cardClass} p-6 space-y-5`}>
      {header}
      {replacing && (
        <p className="text-sm font-semibold bg-[var(--color-yellow-soft)] border-[1.6px] border-[var(--color-ink)] rounded-[8px] px-3 py-2">
          The new email will replace your current draft.{' '}
          <button onClick={() => { setReplacing(null); setWriting(false) }} className={linkButton}>
            Keep the draft
          </button>
        </p>
      )}

      {noResumes ? (
        <div className={errorBox}>Import a resume first: every email is written from one, and it goes along as a PDF.</div>
      ) : (
        <>
          <Field label="Write from" hint={chosenTailoring ? 'Uses the job this copy was tailored for.' : undefined}>
            <select value={source} onChange={(e) => setSource(e.target.value)} disabled={busy} className={inputClass}>
              {sourceGroups.tailored.length > 0 && (
                <optgroup label="Tailored copies">
                  {sourceGroups.tailored.map((t) => (
                    <option key={t.id} value={`tailoring:${t.id}`}>
                      {describeTailoring(t)} · {t.resumeTitle}
                    </option>
                  ))}
                </optgroup>
              )}
              {sourceGroups.saved.length > 0 && (
                <optgroup label="Saved resumes">
                  {sourceGroups.saved.map((r) => (
                    <option key={r.id} value={`resume:${r.id}`}>
                      {r.title}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </Field>

          {!chosenTailoring && (
            <div className="space-y-3">
              <Field label="Role" optional hint="Leave it blank to ask about roles that fit you.">
                <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} disabled={busy} maxLength={160} placeholder="Platform Engineer" className={inputClass} />
              </Field>
              {showJobPost ? (
                <Field label="Job post" optional hint="The email picks up its key skills where your resume backs them.">
                  <textarea
                    rows={5}
                    value={jobDescription}
                    onChange={(e) => setJobDescription(e.target.value)}
                    disabled={busy}
                    maxLength={LIMITS.jobDescription}
                    placeholder="Paste the job post…"
                    className={`${inputClass} resize-y`}
                  />
                </Field>
              ) : (
                <button onClick={() => setShowJobPost(true)} className={linkButton}>
                  + Add the job post
                </button>
              )}
            </div>
          )}

          <div>
            <span className="block text-sm font-bold mb-2">Tone</span>
            <div className="flex flex-wrap gap-2">
              {COVER_LETTER_TONES.map((id) => (
                <button
                  key={id}
                  onClick={() => setTone(id)}
                  disabled={busy}
                  aria-pressed={tone === id}
                  title={TONE_LABELS[id].hint}
                  className={`nb-chip px-3 py-1 ${tone === id ? 'bg-[var(--color-yellow)] text-[#0a0a0a]' : 'bg-[var(--color-surface)]'}`}
                >
                  {TONE_LABELS[id].label}
                </button>
              ))}
            </div>
          </div>

          <Field label="Mention in this email" optional>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={busy}
              maxLength={600}
              placeholder="e.g. met them at the Pune tech meetup"
              className={inputClass}
            />
          </Field>

          <Toggle checked={attachResume} onChange={setAttachResume} disabled={busy} label="Attach the resume as a PDF" />

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
          {aiOff && <p className="text-sm font-semibold text-[var(--color-warning)]">The AI isn’t available right now. You can still write the email yourself.</p>}

          {busy && (
            <Working
              kind="email"
              startedAt={startedAt}
              active={0}
              steps={[replacing ? 'Rewriting the email' : 'Writing the email from your resume']}
              note="Only facts already in the resume you chose. Nothing is sent."
            />
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => write(false)} disabled={busy || locked || !chosen || aiOff} className={primaryButton}>
              <Wand size={16} /> {busy ? 'Writing…' : replacing ? 'Rewrite with AI' : 'Write with AI'}
            </button>
            {!replacing && (
              <button onClick={() => write(true)} disabled={busy || locked} className={secondaryButton}>
                Write it myself
              </button>
            )}
            {thread && !replacing && (
              <button onClick={() => setWriting(false)} disabled={busy} className={linkButton}>
                Cancel
              </button>
            )}
          </div>
          <p className="text-xs text-[var(--color-text-muted)] flex items-center gap-1.5">
            <Sparkles size={13} />
            {isOwner
              ? 'Written with your own AI settings, using only facts from your resume.'
              : draftsLeft !== null
                ? `${draftsLeft} of ${billing?.emailDrafts.limit} AI-written emails left this month. Written only from facts in your resume.`
                : 'Written only from facts in your resume.'}
          </p>
        </>
      )}
    </section>
  )
}

function RecruiterHeader({ recruiter, onSaved }: { recruiter: RecruiterSummary; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [values, setValues] = useState({ name: recruiter.name, company: recruiter.company, title: recruiter.title })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setValues({ name: recruiter.name, company: recruiter.company, title: recruiter.title })
    setEditing(false)
  }, [recruiter.id, recruiter.name, recruiter.company, recruiter.title])

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await outreachApi.editRecruiter(recruiter.id, values)
      setEditing(false)
      onSaved()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <input value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} maxLength={120} placeholder="Name" aria-label="Name" className={inputClass} />
          <input value={values.company} onChange={(e) => setValues({ ...values, company: e.target.value })} maxLength={160} placeholder="Company" aria-label="Company" className={inputClass} />
          <input value={values.title} onChange={(e) => setValues({ ...values, title: e.target.value })} maxLength={120} placeholder="Their job title" aria-label="Their job title" className={inputClass} />
        </div>
        {error && <div className={errorBox}>{error}</div>}
        <div className="flex gap-2">
          <button onClick={save} disabled={busy} className={primaryButton}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => setEditing(false)} disabled={busy} className={secondaryButton}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  const who = recruiter.name || recruiter.email
  const where = [recruiter.title, recruiter.company].filter(Boolean).join(' · ')
  return (
    <div className="flex items-start justify-between gap-3 pb-4 border-b-[1.6px] border-[var(--color-ink)]">
      <div className="flex items-center gap-3 min-w-0">
        <span className="nb-badge w-11 h-11 shrink-0 bg-[var(--color-sky)] text-lg font-black" aria-hidden>
          {who.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <h2 className="text-xl font-black leading-tight break-words">{who}</h2>
          {where && <p className="text-sm text-[var(--color-text-muted)] break-words">{where}</p>}
          {recruiter.name && <p className="text-xs text-[var(--color-text-faint)] break-all">{recruiter.email}</p>}
        </div>
      </div>
      <button onClick={() => setEditing(true)} className={`${secondaryButton} shrink-0`} aria-label="Edit the recruiter’s details">
        <Pencil size={14} /> <span className="hidden sm:inline">Edit</span>
      </button>
    </div>
  )
}
