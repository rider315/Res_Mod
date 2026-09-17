'use client'
import { useState } from 'react'
import { diffWords } from 'diff'
import { ResumeChange } from '@/types/resume'
import { visible } from '@/lib/latex/match'
import { editableToLatex, latexToEditable } from '@/lib/tailor/edit-text'
import { Briefcase, Check, ChevronDown, Close, FileText, Layers, Pencil, Sparkles, User } from '@/components/brand/Icons'

/**
 * The review list: each suggested change next to the line it replaces, grouped
 * by section, to approve, reject or (where the screen allows) edit.
 */

const TYPE_LABELS: Record<ResumeChange['type'], string> = {
  rewrite: 'Rewrite',
  add_keywords: 'Keywords',
  improve_clarity: 'Clarity',
  action_verb: 'Action verb',
}

const TYPE_COLORS: Record<ResumeChange['type'], string> = {
  rewrite: 'bg-[var(--color-sky)]',
  add_keywords: 'bg-[var(--color-accent)]',
  improve_clarity: 'bg-[var(--color-yellow)]',
  action_verb: 'bg-[var(--color-purple-highlight)]',
}

function InlineDiff({ original, proposed }: { original: string; proposed: string }) {
  const parts = diffWords(original, proposed)
  return (
    <span className="leading-relaxed">
      {parts.map((part, i) => {
        if (part.added)
          return (
            <mark key={i} className="bg-[var(--color-accent)] text-[#0a0a0a] px-0.5 font-semibold">
              {part.value}
            </mark>
          )
        if (part.removed)
          return (
            <del key={i} className="text-[var(--color-error)] decoration-2 px-0.5">
              {part.value}
            </del>
          )
        return <span key={i}>{part.value}</span>
      })}
    </span>
  )
}

/**
 * Rewrites are allowed to grow so JD keywords fit, which can push a bullet onto
 * an extra line. Surface the delta so layout risk is visible before approving.
 */
function LengthDelta({ original, proposed }: { original: string; proposed: string }) {
  const delta = proposed.length - original.length
  if (Math.abs(delta) < 10) return null
  const notable = Math.abs(delta) >= 30
  return (
    <span
      title={`${original.length} → ${proposed.length} characters`}
      className={`nb-chip text-[10px] ${notable ? 'bg-[var(--color-yellow-soft)]' : 'bg-[var(--color-surface)]'}`}
    >
      {delta > 0 ? '+' : ''}
      {delta} chars
    </span>
  )
}

function DiffCard({
  change,
  plainText,
  onApprove,
  onReject,
  onEdit,
}: {
  change: ResumeChange
  plainText: boolean
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onEdit?: (id: string, proposed: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const isApproved = change.approved === true
  const isRejected = change.approved === false
  const original = plainText ? visible(change.original) : change.original
  const proposed = plainText ? visible(change.proposed) : change.proposed

  function startEditing() {
    setDraft(latexToEditable(change.proposed))
    setProblem(null)
    setEditing(true)
  }

  function saveEdit() {
    const result = editableToLatex(draft)
    if (!result.ok) {
      setProblem(result.problem)
      return
    }
    onEdit?.(change.id, result.latex)
    setEditing(false)
  }

  return (
    <div
      className={`rounded-[10px] border-[1.6px] border-[var(--color-ink)] transition-all duration-200 ${
        isApproved
          ? 'bg-[var(--color-accent-soft)] shadow-[4px_4px_0_0_var(--color-ink)]'
          : isRejected
            ? 'bg-[var(--color-surface-offset)] opacity-60'
            : 'bg-[var(--color-surface)] shadow-[4px_4px_0_0_var(--color-ink)]'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b-[1.6px] border-[var(--color-ink)]">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`nb-chip text-[#0a0a0a] ${TYPE_COLORS[change.type]}`}>{TYPE_LABELS[change.type]}</span>
          {change.edited && <span className="nb-chip bg-[var(--color-yellow)] text-[#0a0a0a]">Edited by you</span>}
          <LengthDelta original={change.original} proposed={change.proposed} />
        </div>
        <div className="flex items-center gap-2">
          {onEdit && !editing && (
            <button onClick={startEditing} className="nb-btn nb-btn-sm px-2.5 py-1.5 text-sm" title="Edit this suggestion">
              <Pencil size={14} /> Edit
            </button>
          )}
          <button
            onClick={() => onReject(change.id)}
            aria-pressed={isRejected}
            className={`nb-btn nb-btn-sm px-3 py-1.5 text-sm ${isRejected ? 'bg-[var(--color-error-highlight)] text-[var(--color-error)]' : ''}`}
          >
            <Close size={14} /> {isRejected ? 'Rejected' : 'Reject'}
          </button>
          <button
            onClick={() => onApprove(change.id)}
            aria-pressed={isApproved}
            className={`nb-btn nb-btn-sm px-3 py-1.5 text-sm ${isApproved ? 'nb-btn-accent' : ''}`}
          >
            <Check size={14} /> {isApproved ? 'Approved' : 'Approve'}
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-[11px] font-black mb-1.5 uppercase tracking-wider text-[var(--color-text-faint)]">Original</p>
            <div
              className={`text-sm rounded-[8px] p-3 border-[1.6px] border-[var(--color-border-soft)] bg-[var(--color-bg)] leading-relaxed ${
                plainText ? '' : 'font-mono'
              }`}
            >
              {original}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-black mb-1.5 uppercase tracking-wider text-[var(--color-primary)]">Suggested</p>
            {editing ? (
              <div className="space-y-2">
                <textarea
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value)
                    setProblem(null)
                  }}
                  rows={Math.min(8, Math.max(3, Math.ceil(draft.length / 70)))}
                  className="nb-input text-sm leading-relaxed resize-y"
                  aria-label="Edit the suggested line"
                  autoFocus
                />
                <p className="text-[11px] text-[var(--color-text-muted)]">Put **double asterisks** around words to make them bold.</p>
                {problem && <p className="text-xs font-semibold text-[var(--color-error)]">{problem}</p>}
                <div className="flex gap-2">
                  <button onClick={saveEdit} className="nb-btn nb-btn-sm nb-btn-accent px-3 py-1.5 text-sm">
                    <Check size={14} /> Use my version
                  </button>
                  <button onClick={() => setEditing(false)} className="nb-btn nb-btn-sm px-3 py-1.5 text-sm">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                className={`text-sm rounded-[8px] p-3 border-[1.6px] border-[var(--color-ink)] bg-[var(--color-surface)] leading-relaxed ${
                  plainText ? '' : 'font-mono'
                }`}
              >
                <InlineDiff original={original} proposed={proposed} />
              </div>
            )}
          </div>
        </div>
        {change.reason && (
          <p className="text-xs text-[var(--color-text-muted)] flex items-start gap-1.5">
            <Sparkles size={14} className="mt-0.5 shrink-0 text-[var(--color-text-faint)]" />
            {change.reason}
          </p>
        )}
      </div>
    </div>
  )
}

function SectionIcon({ title }: { title: string }) {
  const t = title.toLowerCase()
  if (t.includes('experience') || t.includes('work')) return <Briefcase size={18} />
  if (t.includes('skill')) return <Sparkles size={18} />
  if (t.includes('project')) return <Layers size={18} />
  if (t.includes('soft') || t.includes('summary')) return <User size={18} />
  return <FileText size={18} />
}

function SectionGroup({
  sectionTitle,
  changes,
  plainText,
  onApprove,
  onReject,
  onEdit,
  onApproveSection,
  onRejectSection,
}: {
  sectionTitle: string
  changes: ResumeChange[]
  plainText: boolean
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onEdit?: (id: string, proposed: string) => void
  onApproveSection: () => void
  onRejectSection: () => void
}) {
  const [isOpen, setIsOpen] = useState(true)
  const approved = changes.filter((c) => c.approved === true).length

  return (
    <div className="nb-card rounded-[10px] overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-[var(--color-surface-offset)] transition-colors"
      >
        <span className="nb-badge w-9 h-9 shrink-0 bg-[var(--color-yellow)]">
          <SectionIcon title={sectionTitle} />
        </span>
        <span className="font-black text-left flex-1">{sectionTitle}</span>
        <span className="nb-chip bg-[var(--color-surface)]">
          {approved}/{changes.length} approved
        </span>
        <ChevronDown size={18} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="border-t-[1.6px] border-[var(--color-ink)] bg-[var(--color-bg)]">
          <div className="flex items-center justify-end gap-2 px-5 pt-3">
            <button onClick={onRejectSection} className="text-xs font-bold underline underline-offset-4 hover:text-[var(--color-error)]">
              Reject section
            </button>
            <button onClick={onApproveSection} className="nb-btn nb-btn-sm nb-btn-accent px-2.5 py-1 text-xs">
              Approve section
            </button>
          </div>
          <div className="p-4 space-y-4 anim-expand">
            {changes.map((change) => (
              <DiffCard
                key={change.id}
                change={change}
                plainText={plainText}
                onApprove={onApprove}
                onReject={onReject}
                onEdit={onEdit}
              />
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
  onEdit,
  plainText = false,
}: {
  changes: ResumeChange[]
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onApproveAll: () => void
  onRejectAll: () => void
  /** Offer an Edit button on each change, and receive the edited LaTeX. */
  onEdit?: (id: string, proposed: string) => void
  /** Show lines as readable text rather than LaTeX. */
  plainText?: boolean
}) {
  const approvedCount = changes.filter((c) => c.approved === true).length
  const rejectedCount = changes.filter((c) => c.approved === false).length
  const pendingCount = changes.filter((c) => c.approved === null).length

  const grouped = changes.reduce<Record<string, ResumeChange[]>>((acc, change) => {
    const key = change.sectionTitle || 'Other'
    if (!acc[key]) acc[key] = []
    acc[key].push(change)
    return acc
  }, {})
  const sectionOrder = Object.keys(grouped)

  return (
    <div className="space-y-5">
      <div className="nb-card rounded-[10px] flex flex-wrap items-center justify-between gap-3 p-3.5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-bold">
            {changes.length} change{changes.length === 1 ? '' : 's'} in {sectionOrder.length} section{sectionOrder.length === 1 ? '' : 's'}
          </span>
          <span className="nb-chip bg-[var(--color-accent)] text-[#0a0a0a]">{approvedCount} approved</span>
          <span className="nb-chip bg-[var(--color-error-highlight)] text-[#0a0a0a]">{rejectedCount} rejected</span>
          {pendingCount > 0 && <span className="nb-chip bg-[var(--color-surface)]">{pendingCount} to decide</span>}
        </div>
        <div className="flex gap-2">
          <button onClick={onRejectAll} className="nb-btn nb-btn-sm px-3 py-1.5 text-sm">
            Reject all
          </button>
          <button onClick={onApproveAll} className="nb-btn nb-btn-sm nb-btn-accent px-3 py-1.5 text-sm">
            Approve all
          </button>
        </div>
      </div>

      <div className="space-y-5">
        {sectionOrder.map((sectionTitle) => (
          <SectionGroup
            key={sectionTitle}
            sectionTitle={sectionTitle}
            changes={grouped[sectionTitle]}
            plainText={plainText}
            onApprove={onApprove}
            onReject={onReject}
            onEdit={onEdit}
            onApproveSection={() => grouped[sectionTitle].forEach((c) => onApprove(c.id))}
            onRejectSection={() => grouped[sectionTitle].forEach((c) => onReject(c.id))}
          />
        ))}
      </div>
    </div>
  )
}
