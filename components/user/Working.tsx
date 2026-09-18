'use client'
import { useEffect, useState } from 'react'
import { CheckCircle, FileText, KeyIcon, Mail, Paperclip, Send, Users } from '@/components/brand/Icons'
import { cardClass } from '@/components/user/shared'

/**
 * What a long job shows while it runs.
 *
 * Every one of these takes model calls and seconds, and until now most of them
 * changed a button's label and left the page still. Each kind gets a small scene
 * of the work actually being done — a page being read, keywords lifting out of a
 * job post, an email writing itself — over the same stage list and rail, so the
 * screens still read as one product.
 *
 * The scenes loop and claim no percentage: none of this work can say how far
 * along it is, and a bar that pretends otherwise is worse than one that doesn't.
 */

export type WorkKind = 'import' | 'keywords' | 'letter' | 'email' | 'reply' | 'send' | 'pdf' | 'recruiters' | 'mailbox'

interface WorkingProps {
  kind: WorkKind
  /** The stages this job goes through, in order. */
  steps: string[]
  /** The stage running now. Everything before it is done. */
  active: number
  /** A line under the scene: what this stage is, or what it won't do. */
  note?: string
  /** When it started, for the clock. */
  startedAt?: number | null
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function useElapsed(startedAt: number | null | undefined): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!startedAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  return startedAt ? now - startedAt : 0
}

export default function Working({ kind, steps, active, note, startedAt }: WorkingProps) {
  const elapsed = useElapsed(startedAt)
  return (
    <section
      className={`${cardClass} p-5 space-y-4 bg-[var(--color-sky-soft)]`}
      role="status"
      aria-live="polite"
      aria-label={steps[active] ?? 'Working'}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-black leading-tight">{steps[active] ?? 'Working'}</h2>
        {startedAt ? <span className="nb-chip bg-[var(--color-yellow)] text-[#0a0a0a] tabular-nums shrink-0">{clock(elapsed)}</span> : null}
      </div>

      <div
        className="relative overflow-hidden rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-surface)] h-[104px] p-3"
        aria-hidden
      >
        <Scene kind={kind} />
      </div>

      <div className="h-2.5 overflow-hidden rounded-full border-[1.6px] border-[var(--color-ink)] bg-[var(--color-surface)]" aria-hidden>
        <div className="work-rail h-full bg-[var(--color-primary)]" />
      </div>

      {steps.length > 1 && (
        <ol className="space-y-1.5">
          {steps.map((step, i) => {
            const state = i < active ? 'done' : i === active ? 'running' : 'waiting'
            return (
              <li key={step} className="flex items-center gap-2.5 text-sm">
                <span
                  className={`inline-block h-3 w-3 shrink-0 rounded-full border-[1.6px] border-[var(--color-ink)] ${
                    state === 'done'
                      ? 'bg-[var(--color-accent)]'
                      : state === 'running'
                        ? 'bg-[var(--color-primary)] animate-pulse'
                        : 'bg-[var(--color-surface)]'
                  }`}
                  aria-hidden
                />
                <span className={state === 'waiting' ? 'text-[var(--color-text-faint)]' : 'font-semibold'}>{step}</span>
              </li>
            )
          })}
        </ol>
      )}

      {note && <p className="text-xs text-[var(--color-text-muted)]">{note}</p>}
    </section>
  )
}

// ─── The scenes ──────────────────────────────────────────────────────────────

const delay = (ms: number) => ({ animationDelay: `${ms}ms` })
const bar = 'h-2 rounded-sm bg-[var(--color-surface-dynamic)]'

function Scene({ kind }: { kind: WorkKind }) {
  switch (kind) {
    case 'import':
      return <ImportScene />
    case 'keywords':
      return <KeywordScene />
    case 'letter':
    case 'email':
    case 'reply':
      return <WritingScene kind={kind} />
    case 'send':
      return <SendScene />
    case 'pdf':
      return <PdfScene />
    case 'recruiters':
      return <RecruiterScene />
    case 'mailbox':
      return <MailboxScene />
  }
}

/** A page being read, its parts named as the reader passes them. */
function ImportScene() {
  const sections = ['Summary', 'Experience', 'Skills']
  return (
    <div className="relative h-full flex gap-3">
      <div className="relative flex-1 space-y-2 overflow-hidden">
        <span className="work-sweep" />
        <div className={`${bar} w-1/2 !bg-[var(--color-ink)]`} />
        <div className={`${bar} w-full`} />
        <div className={`${bar} w-5/6`} />
        <div className={`${bar} w-full`} />
        <div className={`${bar} w-2/3`} />
      </div>
      <ul className="w-[104px] shrink-0 space-y-1.5">
        {sections.map((name, i) => (
          <li key={name} className="work-pop nb-chip w-full justify-center bg-[var(--color-accent)] text-[10px]" style={delay(300 + i * 320)}>
            {name}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Terms lifting out of a job post and stacking up, scored. */
function KeywordScene() {
  const found = ['Kubernetes', 'Terraform', 'Go']
  return (
    <div className="relative h-full flex gap-3">
      <div className="relative flex-1 space-y-2 overflow-hidden">
        <span className="work-sweep" />
        <div className="flex gap-1.5">
          <div className={`${bar} w-10`} />
          <div className={`${bar} w-14 !bg-[var(--color-accent)]`} />
          <div className={`${bar} w-8`} />
        </div>
        <div className="flex gap-1.5">
          <div className={`${bar} w-12`} />
          <div className={`${bar} w-9`} />
          <div className={`${bar} w-12 !bg-[var(--color-accent)]`} />
        </div>
        <div className="flex gap-1.5">
          <div className={`${bar} w-8 !bg-[var(--color-accent)]`} />
          <div className={`${bar} w-16`} />
        </div>
        <div className={`${bar} w-3/4`} />
      </div>
      <ul className="w-[110px] shrink-0 space-y-1.5">
        {found.map((term, i) => (
          <li
            key={term}
            className="work-pop flex items-center gap-1.5 rounded-[6px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-yellow)] px-1.5 py-0.5 text-[10px] font-bold text-[#0a0a0a]"
            style={delay(280 + i * 300)}
          >
            <KeyIcon size={11} /> <span className="truncate">{term}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Lines appearing as they are written, with a caret at the end. */
function WritingScene({ kind }: { kind: 'letter' | 'email' | 'reply' }) {
  const widths = ['70%', '100%', '86%', '54%']
  return (
    <div className="h-full flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="nb-badge w-6 h-6 shrink-0 bg-[var(--color-periwinkle)] text-white">
          <Mail size={12} />
        </span>
        <div className={`${bar} w-24 !bg-[var(--color-ink)]`} />
        {kind === 'reply' && <span className="nb-chip bg-[var(--color-accent-soft)] text-[9px] ml-auto">reading theirs</span>}
      </div>
      <div className="flex-1 space-y-2 pt-1">
        {widths.map((width, i) => (
          <div key={width + i} className="flex items-center gap-1">
            <div
              className={`work-type h-2 rounded-sm bg-[var(--color-surface-dynamic)]`}
              style={{ ...delay(i * 260), ['--work-width' as string]: width }}
            />
            {i === widths.length - 1 && <span className="work-caret inline-block h-3 w-[2px] bg-[var(--color-ink)]" />}
          </div>
        ))}
      </div>
    </div>
  )
}

/** An envelope carried along the wire, with what it carries. */
function SendScene() {
  return (
    <div className="h-full flex flex-col justify-center gap-3">
      <div className="relative h-8">
        <span className="absolute inset-x-0 top-1/2 h-[1.6px] -translate-y-1/2 bg-[repeating-linear-gradient(90deg,var(--color-ink)_0_6px,transparent_6px_12px)] opacity-30" />
        {[0, 1].map((i) => (
          <span
            key={i}
            className="work-travel absolute top-1/2 left-0 -translate-y-1/2 nb-badge w-8 h-8 bg-[var(--color-accent)]"
            style={delay(i * 1100)}
          >
            <Send size={15} />
          </span>
        ))}
      </div>
      <div className="flex items-center justify-center gap-2 text-[10px] font-bold text-[var(--color-text-muted)]">
        <span className="nb-chip bg-[var(--color-surface-offset)] text-[10px]">
          <Paperclip size={11} /> resume.pdf
        </span>
        <span>from your mailbox</span>
      </div>
    </div>
  )
}

/** Sheets settling into a stack, then the tick. */
function PdfScene() {
  return (
    <div className="h-full flex items-center justify-center gap-4">
      <div className="relative w-14 h-16">
        {[-5, 3, 0].map((tilt, i) => (
          <span
            key={tilt}
            className="work-stack absolute inset-0 grid place-items-center rounded-[6px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-surface)] shadow-[2px_2px_0_0_var(--color-ink)]"
            style={{ ...delay(i * 280), ['--work-tilt' as string]: `${tilt}deg` }}
          >
            <FileText size={18} />
          </span>
        ))}
      </div>
      <span className="work-pop nb-chip bg-[var(--color-accent)] text-[10px]" style={delay(1000)}>
        <CheckCircle size={11} /> typeset
      </span>
    </div>
  )
}

/** Addresses arriving and being checked, one after another. */
function RecruiterScene() {
  const rows = [
    { ok: true, w: 'w-28' },
    { ok: true, w: 'w-20' },
    { ok: false, w: 'w-24' },
    { ok: true, w: 'w-16' },
  ]
  return (
    <div className="h-full flex flex-col justify-center gap-1.5">
      {rows.map((row, i) => (
        <div key={i} className="work-rise flex items-center gap-2" style={delay(i * 260)}>
          <span className="nb-badge w-5 h-5 shrink-0 bg-[var(--color-sky)]">
            <Users size={10} />
          </span>
          <div className={`${bar} ${row.w}`} />
          <span
            className={`ml-auto shrink-0 text-[10px] font-black ${row.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}
          >
            {row.ok ? '✓' : '✕'}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Signing in: the two ends reaching for each other. */
function MailboxScene() {
  return (
    <div className="h-full flex items-center justify-center gap-3">
      <span className="work-meet-l nb-badge w-10 h-10 bg-[var(--color-yellow)]">
        <Mail size={18} />
      </span>
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="work-pop h-1.5 w-1.5 rounded-full bg-[var(--color-ink)]" style={delay(i * 200)} />
        ))}
      </span>
      <span className="work-meet-r nb-badge w-10 h-10 bg-[var(--color-accent)]">
        <KeyIcon size={18} />
      </span>
    </div>
  )
}
