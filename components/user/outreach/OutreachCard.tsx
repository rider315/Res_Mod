'use client'
import { useEffect, useState } from 'react'
import { ArrowRight, Send } from '@/components/brand/Icons'
import { cardClass, primaryButton, secondaryButton } from '@/components/user/shared'
import { rate } from '@/lib/outreach/stats'
import { outreachApi, OutreachSummary } from '@/components/user/outreach/outreach-client'

/** Outreach at a glance on the dashboard: how emails to recruiters are going, and the way in. */

export default function OutreachCard({ refreshKey, onOpen }: { refreshKey: unknown; onOpen: () => void }) {
  const [summary, setSummary] = useState<OutreachSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    outreachApi
      .summary()
      .then((result) => !cancelled && setSummary(result))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  const stats = summary?.stats
  const started = Boolean(stats && (stats.sent > 0 || stats.drafts > 0 || stats.recruiters > 0))

  return (
    <section className={`${cardClass} p-5 space-y-4 bg-[var(--color-sky-soft)]`}>
      <div className="flex items-center gap-3">
        <span className="nb-badge w-10 h-10 shrink-0 bg-[var(--color-periwinkle)] text-white">
          <Send size={18} />
        </span>
        <div>
          <h2 className="text-lg font-black leading-tight">Recruiter outreach</h2>
          <p className="text-xs text-[var(--color-text-muted)]">Email recruiters from your resume, sent as you, with replies tracked.</p>
        </div>
      </div>

      {started && stats ? (
        <>
          <dl className="grid grid-cols-4 gap-2 text-center">
            {[
              ['Sent', String(stats.sent)],
              ['Opened', rate(stats.opened, stats.sent) || '0'],
              ['Replied', String(stats.replied)],
              ['Interviews', String(stats.interviews)],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col-reverse rounded-[8px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-surface)] px-1 py-2">
                <dt className="mt-1 text-[10px] font-black uppercase tracking-wider text-[var(--color-text-faint)]">{label}</dt>
                <dd className="text-xl font-black tabular-nums leading-none">{value}</dd>
              </div>
            ))}
          </dl>
          {(stats.followUpsDue > 0 || stats.drafts > 0) && (
            <p className="text-sm font-semibold">
              {[
                stats.followUpsDue > 0 && `${stats.followUpsDue} follow-up${stats.followUpsDue === 1 ? '' : 's'} due`,
                stats.drafts > 0 && `${stats.drafts} draft${stats.drafts === 1 ? '' : 's'} waiting`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
          <button onClick={onOpen} className={secondaryButton}>
            Open outreach <ArrowRight size={15} />
          </button>
        </>
      ) : (
        <button onClick={onOpen} className={primaryButton}>
          Start reaching out <ArrowRight size={16} />
        </button>
      )}
    </section>
  )
}
