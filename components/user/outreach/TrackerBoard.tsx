'use client'
import { useMemo, useState } from 'react'
import { Clock, Search } from '@/components/brand/Icons'
import { cardClass, inputClass } from '@/components/user/shared'
import { followUpDue, STATUS_LABELS, THREAD_STAGES, ThreadStage, wasSent } from '@/lib/outreach/model'
import { rate, summarizeThreads } from '@/lib/outreach/stats'
import type { ThreadSummary } from '@/lib/outreach/types'
import { relativeDay } from '@/components/user/outreach/controls'

/**
 * Every sent email, by where it stands: sent, opened, replied, interview,
 * offer, or not moving forward. Follow-ups that are due come first.
 */

const COLUMN_FILL: Record<ThreadStage, string> = {
  sent: 'bg-[var(--color-sky-soft)]',
  opened: 'bg-[var(--color-yellow-soft)]',
  replied: 'bg-[var(--color-purple-highlight)]',
  interview: 'bg-[var(--color-accent-soft)]',
  offer: 'bg-[var(--color-success-highlight)]',
  rejected: 'bg-[var(--color-surface-offset)]',
}

export default function TrackerBoard({
  threads,
  recruiters,
  onOpenThread,
}: {
  threads: ThreadSummary[]
  recruiters: number
  onOpenThread: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const sent = useMemo(() => threads.filter((thread) => wasSent(thread.status)), [threads])
  const stats = useMemo(() => summarizeThreads(threads, recruiters), [threads, recruiters])
  const due = useMemo(() => sent.filter((thread) => followUpDue(thread)), [sent])

  const needle = query.trim().toLowerCase()
  const shown = needle
    ? sent.filter((thread) =>
        [thread.recruiter.name, thread.recruiter.email, thread.recruiter.company, thread.subject, thread.jobTitle]
          .join(' ')
          .toLowerCase()
          .includes(needle)
      )
    : sent

  if (sent.length === 0) {
    return (
      <div className={`${cardClass} p-10 text-center space-y-3`}>
        <span className="nb-badge w-14 h-14 mx-auto bg-[var(--color-sky)]">
          <Clock size={26} />
        </span>
        <h2 className="text-2xl font-black">Nothing sent yet</h2>
        <p className="text-[var(--color-text-muted)] max-w-md mx-auto">
          Emails you send show up here and move along as recruiters open and answer them. Paste in their replies to keep it up to date.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        {[
          { label: 'Sent', value: stats.sent, detail: '' },
          { label: 'Opened', value: stats.opened, detail: rate(stats.opened, stats.sent) },
          { label: 'Replied', value: stats.replied, detail: rate(stats.replied, stats.sent) },
          { label: 'Interviews', value: stats.interviews, detail: '' },
          { label: 'Offers', value: stats.offers, detail: '' },
        ].map((item) => (
          <div key={item.label} className={`${cardClass} p-4 shadow-[3px_3px_0_0_var(--color-ink)]`}>
            <p className="text-[11px] font-black uppercase tracking-wider text-[var(--color-text-faint)]">{item.label}</p>
            <p className="text-3xl font-black tabular-nums leading-tight">
              {item.value}
              {item.detail && <span className="ml-2 text-sm font-bold text-[var(--color-text-muted)]">{item.detail}</span>}
            </p>
          </div>
        ))}
      </div>

      {due.length > 0 && (
        <div className="nb-card rounded-[10px] p-4 bg-[var(--color-yellow-soft)] space-y-2">
          <p className="font-black">
            {due.length} follow-up{due.length === 1 ? ' is' : 's are'} due
          </p>
          <p className="text-sm text-[var(--color-text-muted)]">No answer in a while. A short, polite nudge often gets one.</p>
          <div className="flex flex-wrap gap-2">
            {due.slice(0, 8).map((thread) => (
              <button
                key={thread.id}
                onClick={() => onOpenThread(thread.id)}
                className="nb-chip px-3 py-1 bg-[var(--color-surface)] hover:bg-[var(--color-yellow)] transition-colors"
              >
                {thread.recruiter.name || thread.recruiter.email}
                {thread.recruiter.company ? ` · ${thread.recruiter.company}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people, companies, subjects"
          aria-label="Search sent emails"
          className={`${inputClass} pl-9`}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 items-start">
        {THREAD_STAGES.map((stage) => {
          const column = shown.filter((thread) => thread.status === stage)
          return (
            <section key={stage} className={`rounded-[10px] border-[1.6px] border-[var(--color-ink)] p-3 ${COLUMN_FILL[stage]}`}>
              <h3 className="flex items-center justify-between gap-2 px-1 pb-2 text-sm font-black">
                {STATUS_LABELS[stage]}
                <span className="nb-chip text-[11px] bg-[var(--color-surface)] tabular-nums">{column.length}</span>
              </h3>
              <ul className="space-y-2 max-h-[520px] overflow-y-auto pr-0.5">
                {column.length === 0 && <li className="px-1 py-3 text-xs text-[var(--color-text-faint)]">Nothing here.</li>}
                {column.map((thread) => (
                  <li key={thread.id}>
                    <button
                      onClick={() => onOpenThread(thread.id)}
                      className="w-full text-left rounded-[8px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-surface)] p-3 hover:shadow-[3px_3px_0_0_var(--color-ink)] hover:-translate-y-px transition-all"
                    >
                      <p className="font-black text-sm leading-tight break-words">{thread.recruiter.name || thread.recruiter.email}</p>
                      {thread.recruiter.company && <p className="text-xs text-[var(--color-text-muted)] break-words">{thread.recruiter.company}</p>}
                      <p className="mt-1.5 text-xs leading-snug line-clamp-2">{thread.subject}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                        <span>{relativeDay(thread.lastSentAt)}</span>
                        {thread.openCount > 0 && <span className="nb-chip text-[10px] bg-[var(--color-yellow-soft)]">Opened</span>}
                        {thread.replies > 0 && (
                          <span className="nb-chip text-[10px] bg-[var(--color-sky-soft)]">
                            {thread.replies} repl{thread.replies === 1 ? 'y' : 'ies'}
                          </span>
                        )}
                        {thread.followUps > 0 && <span>{thread.followUps} follow-up{thread.followUps === 1 ? '' : 's'}</span>}
                        {thread.draftFollowUpId && <span className="nb-chip text-[10px] bg-[var(--color-surface-offset)]">Draft follow-up</span>}
                        {followUpDue(thread) && <span className="nb-chip text-[10px] bg-[var(--color-yellow)] text-[#0a0a0a]">Follow up</span>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}
