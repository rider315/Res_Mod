'use client'
import { useState } from 'react'
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

/* ── Section icon mapping ── */
function SectionIcon({ title }: { title: string }) {
  const t = title.toLowerCase()
  if (t.includes('experience') || t.includes('work'))
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
      </svg>
    )
  if (t.includes('skill'))
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.27 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    )
  if (t.includes('project'))
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
      </svg>
    )
  if (t.includes('soft'))
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
      </svg>
    )
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

/* ── Section group with collapsible ── */
function SectionGroup({
  sectionTitle,
  changes,
  onApprove,
  onReject,
  onApproveSection,
  onRejectSection,
}: {
  sectionTitle: string
  changes: ResumeChange[]
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onApproveSection: () => void
  onRejectSection: () => void
}) {
  const [isOpen, setIsOpen] = useState(true)
  const approved = changes.filter((c) => c.approved === true).length
  const total = changes.length

  return (
    <div className="rounded-2xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)]">
      {/* Section header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-[var(--color-surface-offset)] transition-colors"
      >
        <div className="text-[var(--color-primary)]">
          <SectionIcon title={sectionTitle} />
        </div>
        <span className="font-semibold text-sm text-[var(--color-text)] flex-1 text-left">{sectionTitle}</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-primary-highlight)] text-[var(--color-primary)] font-medium">
          {approved}/{total} approved
        </span>
        <svg
          className={`w-4 h-4 text-[var(--color-text-muted)] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Section actions + cards */}
      {isOpen && (
        <div className="border-t border-[var(--color-border)]">
          <div className="flex items-center justify-end gap-2 px-5 py-2 bg-[var(--color-bg)]">
            <button
              onClick={onRejectSection}
              className="text-xs px-2.5 py-1 rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-red-600 hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all"
            >
              Reject section
            </button>
            <button
              onClick={onApproveSection}
              className="text-xs px-2.5 py-1 rounded-lg bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] transition-all"
            >
              Approve section
            </button>
          </div>
          <div className="p-4 space-y-3 anim-expand">
            {changes.map((change) => (
              <DiffCard key={change.id} change={change} onApprove={onApprove} onReject={onReject} />
            ))}
          </div>
        </div>
      )}
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

  // Group changes by sectionTitle
  const grouped = changes.reduce<Record<string, ResumeChange[]>>((acc, change) => {
    const key = change.sectionTitle || 'Other'
    if (!acc[key]) acc[key] = []
    acc[key].push(change)
    return acc
  }, {})
  const sectionOrder = Object.keys(grouped)

  return (
    <div className="space-y-4">
      {/* Global stats bar */}
      <div className="flex items-center justify-between bg-[var(--color-surface)] rounded-xl p-3 border border-[var(--color-border)]">
        <div className="flex items-center gap-4 text-sm">
          <span className="text-[var(--color-text-muted)]">
            <span className="font-semibold text-[var(--color-text)]">{changes.length}</span> changes across{' '}
            <span className="font-semibold text-[var(--color-text)]">{sectionOrder.length}</span> sections
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

      {/* Section-grouped cards */}
      <div className="space-y-4">
        {sectionOrder.map((sectionTitle) => (
          <SectionGroup
            key={sectionTitle}
            sectionTitle={sectionTitle}
            changes={grouped[sectionTitle]}
            onApprove={onApprove}
            onReject={onReject}
            onApproveSection={() => grouped[sectionTitle].forEach((c) => onApprove(c.id))}
            onRejectSection={() => grouped[sectionTitle].forEach((c) => onReject(c.id))}
          />
        ))}
      </div>
    </div>
  )
}