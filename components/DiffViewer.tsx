'use client'
import { diffWords } from 'diff'
import { ResumeChange } from '@/types/resume'

const TYPE_LABELS: Record<ResumeChange['type'], string> = {
  rewrite: 'Rewrite',
  add_keywords: 'Keyword Alignment',
  improve_clarity: 'Clarity',
  action_verb: 'Action Verb',
}

const TYPE_COLORS: Record<ResumeChange['type'], string> = {
  rewrite: 'bg-[var(--color-blue-highlight)] text-[var(--color-blue)]',
  add_keywords: 'bg-[var(--color-primary-highlight)] text-[var(--color-primary)]',
  improve_clarity: 'bg-[var(--color-gold-highlight)] text-[var(--color-gold)]',
  action_verb: 'bg-[var(--color-purple-highlight)] text-[var(--color-purple)]',
}

function InlineDiff({ original, proposed }: { original: string; proposed: string }) {
  const parts = diffWords(original, proposed)
  return (
    <span className="leading-relaxed">
      {parts.map((part, i) => {
        if (part.added)
          return (
            <mark key={i} className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 rounded px-0.5 not-italic">
              {part.value}
            </mark>
          )
        if (part.removed)
          return (
            <del key={i} className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 rounded px-0.5 line-through">
              {part.value}
            </del>
          )
        return <span key={i}>{part.value}</span>
      })}
    </span>
  )
}

function DiffCard({
  change,
  onApprove,
  onReject,
}: {
  change: ResumeChange
  onApprove: (id: string) => void
  onReject: (id: string) => void
}) {
  const isApproved = change.approved === true
  const isRejected = change.approved === false

  return (
    <div
      className={`rounded-xl border transition-all duration-200 ${
        isApproved
          ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/20'
          : isRejected
          ? 'border-[var(--color-border)] bg-[var(--color-surface-offset)] opacity-50'
          : 'border-[var(--color-border)] bg-[var(--color-surface)]'
      }`}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
            {change.sectionTitle}
          </span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TYPE_COLORS[change.type]}`}>
            {TYPE_LABELS[change.type]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onReject(change.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
              isRejected
                ? 'bg-red-100 border-red-300 text-red-700 dark:bg-red-900/30 dark:border-red-700 dark:text-red-400'
                : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-red-300 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20'
            }`}
          >
            {isRejected ? '✕ Rejected' : 'Reject'}
          </button>
          <button
            onClick={() => onApprove(change.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
              isApproved
                ? 'bg-green-100 border-green-300 text-green-700 dark:bg-green-900/30 dark:border-green-700 dark:text-green-400'
                : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-green-400 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/20'
            }`}
          >
            {isApproved ? '✓ Approved' : 'Approve'}
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wide">Original</p>
            <div className="text-sm text-[var(--color-text)] bg-[var(--color-bg)] rounded-lg p-3 border border-[var(--color-border)] leading-relaxed font-mono">
              {change.original}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-[var(--color-primary)] mb-1.5 uppercase tracking-wide">Proposed</p>
            <div className="text-sm text-[var(--color-text)] bg-[var(--color-bg)] rounded-lg p-3 border border-[var(--color-border)] leading-relaxed font-mono">
              <InlineDiff original={change.original} proposed={change.proposed} />
            </div>
          </div>
        </div>
        <p className="text-xs text-[var(--color-text-muted)] flex items-start gap-1.5">
          <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[var(--color-text-faint)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
          </svg>
          {change.reason}
        </p>
      </div>
    </div>
  )
}

export default function DiffViewer({
  changes,
  onApprove,
  onReject,
  onApproveAll,
  onRejectAll,
}: {
  changes: ResumeChange[]
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onApproveAll: () => void
  onRejectAll: () => void
}) {
  const approvedCount = changes.filter((c) => c.approved === true).length
  const rejectedCount = changes.filter((c) => c.approved === false).length
  const pendingCount = changes.filter((c) => c.approved === null).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-[var(--color-surface)] rounded-xl p-3 border border-[var(--color-border)]">
        <div className="flex items-center gap-4 text-sm">
          <span className="text-[var(--color-text-muted)]">
            <span className="font-semibold text-[var(--color-text)]">{changes.length}</span> suggested changes
          </span>
          <span className="text-green-600 dark:text-green-400 font-medium">{approvedCount} approved</span>
          <span className="text-red-500 dark:text-red-400 font-medium">{rejectedCount} rejected</span>
          {pendingCount > 0 && (
            <span className="text-[var(--color-text-muted)]">{pendingCount} pending</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onRejectAll}
            className="text-xs px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-red-600 hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all"
          >
            Reject all
          </button>
          <button
            onClick={onApproveAll}
            className="text-xs px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] transition-all"
          >
            Approve all
          </button>
        </div>
      </div>
      <div className="space-y-3">
        {changes.map((change) => (
          <DiffCard key={change.id} change={change} onApprove={onApprove} onReject={onReject} />
        ))}
      </div>
    </div>
  )
}