'use client'
import { useState } from 'react'
import { Check, Copy, ExternalLink, Paperclip, Send, Trash } from '@/components/brand/Icons'
import { cardClass, errorBox, inputClass, linkButton, primaryButton, secondaryButton, successBox } from '@/components/user/shared'
import { gmailComposeUrl, LIMITS, mailtoUrl, outlookComposeUrl } from '@/lib/outreach/model'
import type { EmailDetail } from '@/lib/outreach/types'
import Dialog from '@/components/user/outreach/Dialog'
import { Toggle } from '@/components/user/outreach/controls'
import { outreachApi } from '@/components/user/outreach/outreach-client'

/**
 * Editing a draft and sending it: from the connected mailbox with the resume
 * attached, or by opening it in Gmail, Outlook or the device's mail app. A
 * draft is saved before it is sent, so what goes out is what's on screen.
 */

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

export interface EditorProps {
  email: EmailDetail
  recruiter: { email: string; name: string }
  /** The connected mailbox's address, or null. */
  mailbox: string | null
  /** The resume the email attaches, e.g. "Riya Patel's resume, tailored for Platform Engineer"; null when it is gone. */
  attachment: string | null
  onChange: (email: EmailDetail) => void
  onDeleted: () => void
  onOpenSetup: () => void
  /** Sending is paused while a batch is running. */
  locked?: boolean
  /** Shown beside the other actions, such as "Rewrite with AI". */
  extraActions?: React.ReactNode
}

export default function EmailEditor({ email, recruiter, mailbox, attachment, onChange, onDeleted, onOpenSetup, locked = false, extraActions }: EditorProps) {
  const [subject, setSubject] = useState(email.subject)
  const [body, setBody] = useState(email.body)
  const [attachResume, setAttachResume] = useState(email.attachResume && attachment !== null)
  const [busy, setBusy] = useState<'save' | 'send' | 'delete' | 'mark' | null>(null)
  const [error, setError] = useState<string | null>(email.lastError)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [openedElsewhere, setOpenedElsewhere] = useState(false)

  const dirty = subject !== email.subject || body !== email.body || attachResume !== email.attachResume
  const words = body.trim().split(/\s+/).filter(Boolean).length
  const ready = subject.trim().length > 0 && body.replace(/\s+/g, ' ').trim().length >= 40
  const target = { to: recruiter.email, subject, body }

  async function save(): Promise<EmailDetail | null> {
    if (!dirty) return email
    const result = await outreachApi.saveDraft(email.id, { subject, body, attachResume })
    onChange(result.email)
    return result.email
  }

  async function run(kind: 'save' | 'send' | 'delete' | 'mark', action: () => Promise<void>) {
    setBusy(kind)
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  const saveNow = () =>
    run('save', async () => {
      await save()
      setNotice('Saved.')
    })

  const send = () =>
    run('send', async () => {
      setConfirming(false)
      await save()
      const result = await outreachApi.send(email.id)
      onChange(result.email)
    })

  const markSent = () =>
    run('mark', async () => {
      await save()
      const result = await outreachApi.markSentByHand(email.id)
      onChange(result.email)
    })

  const remove = () => {
    if (!window.confirm(email.threadId ? 'Delete this follow-up draft?' : 'Delete this draft?')) return
    run('delete', async () => {
      await outreachApi.remove(email.id)
      onDeleted()
    })
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`)
      setNotice('Copied to the clipboard.')
    } catch {
      setError('Copying was blocked by the browser. Select the text and copy it instead.')
    }
  }

  function openElsewhere(url: string) {
    window.open(url, '_blank', 'noopener,noreferrer')
    setOpenedElsewhere(true)
  }

  const disabled = busy !== null || locked

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="flex items-center justify-between text-sm font-bold mb-1.5">
          Subject
          <span className="text-xs font-semibold text-[var(--color-text-faint)] tabular-nums">
            {subject.length}/{LIMITS.subject}
          </span>
        </span>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={LIMITS.subject}
          disabled={disabled}
          placeholder="What the email is about"
          className={`${inputClass} font-semibold`}
        />
      </label>
      <label className="block">
        <span className="flex items-center justify-between text-sm font-bold mb-1.5">
          Email
          <span className={`text-xs font-semibold tabular-nums ${words > 220 ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-faint)]'}`}>
            {words} words{words > 220 ? ' · recruiters skim, shorter reads better' : ''}
          </span>
        </span>
        <textarea
          rows={14}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={LIMITS.body}
          disabled={disabled}
          aria-label="Email text"
          className={`${inputClass} resize-y leading-relaxed`}
        />
      </label>

      <div className="rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-bg)] p-3">
        {attachment ? (
          <Toggle
            checked={attachResume}
            onChange={setAttachResume}
            disabled={disabled}
            label="Attach my resume as a PDF"
            description={attachment}
          />
        ) : (
          <p className="text-sm text-[var(--color-text-muted)] flex items-center gap-2">
            <Paperclip size={15} /> No resume is attached: the one this email was written from was deleted.
          </p>
        )}
      </div>

      {error && <div className={errorBox}>{error}</div>}
      {notice && !error && <div className={successBox}>{notice}</div>}

      <div className="flex flex-wrap items-center gap-2">
        {mailbox ? (
          <button onClick={() => setConfirming(true)} disabled={disabled || !ready} className={primaryButton}>
            <Send size={16} /> {busy === 'send' ? 'Sending…' : 'Send'}
          </button>
        ) : (
          <button onClick={onOpenSetup} className={primaryButton}>
            <Send size={16} /> Connect your mailbox to send
          </button>
        )}
        <button onClick={saveNow} disabled={disabled || !dirty} className={secondaryButton}>
          {busy === 'save' ? 'Saving…' : dirty ? 'Save draft' : 'Saved'}
        </button>
        {extraActions}
        <button onClick={remove} disabled={disabled} className={`${secondaryButton} text-[var(--color-error)]`} aria-label="Delete this draft">
          <Trash size={15} />
        </button>
      </div>

      <div className={`${cardClass} p-3 bg-[var(--color-surface-offset)] shadow-none`}>
        <p className="text-xs font-bold text-[var(--color-text-muted)] mb-2">Or send it yourself</p>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => openElsewhere(gmailComposeUrl(target))} disabled={disabled || !ready} className={secondaryButton}>
            Gmail <ExternalLink size={14} />
          </button>
          <button onClick={() => openElsewhere(outlookComposeUrl(target))} disabled={disabled || !ready} className={secondaryButton}>
            Outlook <ExternalLink size={14} />
          </button>
          <a
            href={ready ? mailtoUrl(target) : undefined}
            onClick={() => ready && setOpenedElsewhere(true)}
            aria-disabled={disabled || !ready}
            className={`${secondaryButton} ${disabled || !ready ? 'pointer-events-none opacity-50' : ''}`}
          >
            Mail app
          </a>
          <button onClick={copy} disabled={!ready} className={secondaryButton}>
            <Copy size={14} /> Copy
          </button>
        </div>
        {openedElsewhere && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-[var(--color-text-muted)]">
              Attach your resume PDF there before sending. Sent it?
            </span>
            <button onClick={markSent} disabled={disabled} className={`${linkButton} inline-flex items-center gap-1`}>
              <Check size={14} /> {busy === 'mark' ? 'Saving…' : 'Mark as sent'}
            </button>
          </div>
        )}
      </div>

      {confirming && mailbox && (
        <Dialog
          title="Send this email?"
          icon={<Send size={18} />}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <button onClick={() => setConfirming(false)} className={secondaryButton}>
                Not yet
              </button>
              <button onClick={send} className={primaryButton}>
                <Send size={16} /> Send now
              </button>
            </>
          }
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="font-bold">To</dt>
            <dd className="break-all">{recruiter.name ? `${recruiter.name} <${recruiter.email}>` : recruiter.email}</dd>
            <dt className="font-bold">From</dt>
            <dd className="break-all">{mailbox}</dd>
            <dt className="font-bold">Subject</dt>
            <dd>{subject}</dd>
            <dt className="font-bold">Attached</dt>
            <dd>{attachResume && attachment ? 'Your resume, as a PDF' : 'Nothing'}</dd>
          </dl>
          <p className="mt-4 text-xs text-[var(--color-text-muted)]">
            It goes out from your mailbox straight away and can’t be taken back. A copy appears in your Sent folder.
          </p>
        </Dialog>
      )}
    </div>
  )
}
