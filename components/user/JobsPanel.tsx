'use client'
import { useCallback, useEffect, useState } from 'react'
import { useConfirm } from '@/components/ConfirmProvider'
import { ArrowLeft, Briefcase, ExternalLink, Mail, Sparkles, Trash } from '@/components/brand/Icons'
import { formatDate } from '@/components/user/billing-client'
import { describeJob, JOB_STATUSES, JobRow, STATUS_LABELS } from '@/lib/jobs'
import { backLinkClass, cardClass, errorBox, inputClass, primaryButton, secondaryButton } from '@/components/user/shared'

/**
 * The jobs the browser extension picked up, and what became of each.
 *
 * This is the one screen that makes capturing a job worth doing: without it the
 * rows are write-only, and "Saved jobs" in the extension points at nothing.
 *
 * It answers a question the email tracker cannot — what have I applied to —
 * because the tracker only knows the jobs that led to an email. Plenty do not.
 *
 * The status is moved by hand and by nothing else. Chills could advance it when
 * an email goes out, and would be wrong often enough to make the screen useless:
 * a draft sent to a recruiter is not an application, and a record that guesses
 * is worse than no record.
 */

interface JobsPanelProps {
  /** Tailor a resume against this job. The posting goes with it. */
  onTailor: (job: JobRow) => void
  /** Write to a recruiter about this job. */
  onEmail: (job: JobRow) => void
  onBack: () => void
}

const scoreTone = (score: number) =>
  score >= 70 ? 'bg-[var(--color-accent)]' : score >= 45 ? 'bg-[var(--color-yellow)]' : 'bg-[var(--color-surface)]'

export default function JobsPanel({ onTailor, onEmail, onBack }: JobsPanelProps) {
  const confirm = useConfirm()
  const [jobs, setJobs] = useState<JobRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/extension/capture', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? 'Your saved jobs could not be loaded.')
      setJobs(data.jobs ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setJobs((current) => current ?? [])
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function setStatus(job: JobRow, status: string) {
    // Optimistic: a dropdown that waits for a round trip feels broken, and the
    // only cost of being wrong is one row reverting.
    const before = job.status
    setJobs((current) => (current ?? []).map((row) => (row.id === job.id ? { ...row, status } : row)))
    try {
      const res = await fetch('/api/extension/capture', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: job.id, status }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? 'That change could not be saved.')
      }
    } catch (err) {
      setJobs((current) => (current ?? []).map((row) => (row.id === job.id ? { ...row, status: before } : row)))
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function forget(job: JobRow) {
    const ok = await confirm({
      title: `Remove ${describeJob(job)}?`,
      body: 'It comes off this list. Any resume you tailored for it stays in your history.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    setBusyId(job.id)
    try {
      const res = await fetch(`/api/extension/capture?id=${encodeURIComponent(job.id)}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? 'That job could not be removed.')
      }
      setJobs((current) => (current ?? []).filter((row) => row.id !== job.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-8 anim-page-enter">
      <div>
        <button onClick={onBack} className={backLinkClass}>
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="mt-3 text-4xl sm:text-5xl font-black tracking-tight">
          Your <span className="nb-highlight">saved jobs</span>
        </h1>
        <p className="mt-5 text-lg text-[var(--color-text-muted)] max-w-3xl">
          Jobs the Chills extension picked up while you were reading them, newest first. Tailor a resume for one or write to a
          recruiter about it without pasting the posting again. Where each one has got to is yours to set.
        </p>
      </div>

      {error && <div className={errorBox}>{error}</div>}

      {jobs === null ? (
        <p className="text-sm font-semibold text-[var(--color-text-muted)]">Loading your saved jobs…</p>
      ) : jobs.length === 0 ? (
        <div className={`${cardClass} p-10 text-center space-y-3`}>
          <span className="nb-badge w-12 h-12 bg-[var(--color-yellow)] mx-auto">
            <Briefcase size={24} />
          </span>
          <p className="text-xl font-black">No saved jobs yet</p>
          <p className="text-[var(--color-text-muted)] max-w-md mx-auto">
            Install the Chills browser extension, open a job posting, and press Save job. It lands here with the posting
            already read, so nothing has to be pasted.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {jobs.map((job) => (
            <li key={job.id} className={`${cardClass} p-5 space-y-4`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-wide text-[var(--color-text-muted)]">
                    {job.source} · saved {formatDate(job.capturedAt)}
                  </p>
                  <h2 className="text-xl font-black leading-tight break-words">{job.title || 'A saved job'}</h2>
                  {(job.company || job.location) && (
                    <p className="text-[var(--color-text-muted)]">{[job.company, job.location].filter(Boolean).join(' · ')}</p>
                  )}
                </div>
                {job.score !== null && (
                  <span
                    title="How well the resume you scored against this job already covers its keywords"
                    className={`nb-chip px-3 py-1.5 font-black shrink-0 ${scoreTone(job.score)}`}
                  >
                    {job.score}% match
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => onTailor(job)} className={primaryButton} disabled={job.description.length < 80}>
                  <Sparkles size={16} /> Tailor a resume
                </button>
                <button onClick={() => onEmail(job)} className={secondaryButton}>
                  <Mail size={16} /> Email a recruiter
                </button>
                {job.url && (
                  <a href={job.url} target="_blank" rel="noopener noreferrer" className={secondaryButton}>
                    <ExternalLink size={14} /> Posting
                  </a>
                )}
                <label className="flex items-center gap-2 ml-auto text-sm font-bold">
                  <span className="sr-only">Status</span>
                  <select
                    value={job.status}
                    onChange={(e) => setStatus(job, e.target.value)}
                    className={`${inputClass} py-1.5`}
                    aria-label={`Status of ${describeJob(job)}`}
                  >
                    {JOB_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={() => forget(job)}
                  disabled={busyId === job.id}
                  className={secondaryButton}
                  aria-label={`Remove ${describeJob(job)}`}
                >
                  <Trash size={14} />
                </button>
              </div>

              {job.description.length < 80 && (
                <p className="text-sm text-[var(--color-text-muted)]">
                  Too little of this posting was read to tailor against. Open it again and press Save job.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
