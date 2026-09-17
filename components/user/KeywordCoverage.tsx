'use client'
import { useMemo } from 'react'
import { KeywordReport, ParsedResume, ResumeChange } from '@/types/resume'
import { JdKeyword, keywordCoverage, KeywordStatus } from '@/lib/tailor/keywords'
import { scoreFill } from '@/components/user/shared'

/**
 * The live keyword score on the review screen: where the resume started, where the
 * approved changes take it, and which required keywords a rejection would lose.
 */

const CHIP: Record<KeywordStatus, string> = {
  covered: 'bg-[var(--color-accent)]',
  skills_only: 'bg-[var(--color-yellow)]',
  missing: 'bg-[var(--color-error-highlight)] line-through decoration-[var(--color-error)] decoration-2',
}

const STATUS_LABEL: Record<KeywordStatus, string> = {
  covered: 'In your summary or experience',
  skills_only: 'Listed in skills only',
  missing: 'Missing',
}

function Score({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="text-center">
      <p
        className={`nb-badge tabular-nums ${
          strong ? `w-20 h-14 text-2xl ${scoreFill(value)}` : 'w-16 h-11 text-lg bg-[var(--color-surface)]'
        }`}
      >
        {value}%
      </p>
      <p className="mt-1.5 text-[10px] font-black uppercase tracking-wider text-[var(--color-text-muted)]">{label}</p>
    </div>
  )
}

export default function KeywordCoverage({
  resume,
  report,
  changes,
}: {
  resume: ParsedResume
  report: KeywordReport
  changes: ResumeChange[]
}) {
  // The server validated these kinds; the report type just widens them to string.
  const keywords = report.keywords as JdKeyword[]

  const approved = useMemo(() => keywordCoverage(resume, keywords, changes.filter((c) => c.approved === true)), [resume, keywords, changes])
  const notRejected = useMemo(() => keywordCoverage(resume, keywords, changes.filter((c) => c.approved !== false)), [resume, keywords, changes])
  const everything = useMemo(() => keywordCoverage(resume, keywords, changes), [resume, keywords, changes])

  const pending = changes.some((c) => c.approved === null)
  const missingNow = approved.statuses.filter((s) => s.keyword.required && s.status === 'missing').map((s) => s.keyword.term)
  const lostByRejecting = everything.statuses
    .filter((s, i) => s.keyword.required && s.status !== 'missing' && notRejected.statuses[i].status === 'missing')
    .map((s) => s.keyword.term)

  return (
    <section className="nb-card rounded-[10px] p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black">ATS keyword score</h2>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            {report.jobTitle ? `${report.jobTitle} · ` : ''}
            {approved.requiredPresent} of {approved.requiredTotal} required keywords with the changes you approved
          </p>
        </div>
        <div className="flex items-start gap-3">
          <Score label="Before" value={report.before.score} />
          <span className="pt-3 font-black">→</span>
          <Score label="Approved" value={approved.score} strong />
          {pending && (
            <>
              <span className="pt-3 text-[var(--color-text-faint)]">·</span>
              <Score label="Approve the rest" value={notRejected.score} />
            </>
          )}
        </div>
      </div>

      <div className="h-4 rounded-full border-[1.6px] border-[var(--color-ink)] bg-[var(--color-surface-offset)] overflow-hidden">
        <div className="h-full bg-[var(--color-accent)] border-r-[1.6px] border-[var(--color-ink)] transition-all duration-300" style={{ width: `${approved.score}%` }} />
      </div>

      {lostByRejecting.length > 0 && (
        <p className="text-sm font-semibold text-[var(--color-error)]">
          You rejected changes that carried required keywords, so these are now missing: {lostByRejecting.join(', ')}.
        </p>
      )}
      {lostByRejecting.length === 0 && pending && missingNow.length > 0 && (
        <p className="text-sm text-[var(--color-text-muted)]">Approve the remaining changes to cover {missingNow.join(', ')}.</p>
      )}
      {report.unplaced.length > 0 && (
        <p className="text-xs text-[var(--color-warning)]">
          No line in your resume could hold {report.unplaced.join(', ')}. Add a skills section or a summary to it, then
          tailor again.
        </p>
      )}

      <ul className="flex flex-wrap gap-1.5">
        {approved.statuses.map(({ keyword, status }) => (
          <li
            key={keyword.term}
            title={STATUS_LABEL[status]}
            className={`nb-chip text-[#0a0a0a] ${CHIP[status]}`}
          >
            {keyword.term}
            {keyword.required ? '' : ' · nice to have'}
          </li>
        ))}
      </ul>

      <p className="text-[11px] text-[var(--color-text-muted)] leading-snug">
        Green keywords appear in your summary or experience. Yellow ones are listed in your skills with nothing in your
        experience behind them: be ready to discuss them, or reject the change that added them. Crossed-out ones are missing.
      </p>
    </section>
  )
}
