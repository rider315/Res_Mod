'use client'
import { useEffect, useRef, useState } from 'react'
import { Briefcase, CheckCircle, FileText, Mail, Send, Sparkles, Users } from '@/components/brand/Icons'

/**
 * The hero: two halves of the product becoming one run.
 *
 * It opens on what ResMod used to be — tailoring on one track, recruiter
 * outreach on another, each doing half the job. The two tracks then close
 * together and turn into a single pipeline, which runs: the recruiter and the
 * posting they are hiring for, the role read from that posting, the resume
 * tailored to it, the email written from the same reading, and the email
 * waiting to be sent.
 *
 * The last step says "waiting for you" on purpose. Nothing ResMod writes
 * reaches a recruiter until the user presses Send, and the hero should not
 * imply otherwise.
 *
 * Decorative: the heading beside it says this in words, so it is hidden from
 * screen readers, holds still for anyone who asks for less motion, and stops
 * while it is off screen or the tab is in the background.
 */

interface Stage {
  label: string
  detail: string
  icon: React.ReactNode
  tint: string
}

const PIPELINE: Stage[] = [
  { label: 'Recruiter and posting', detail: 'You give a name and the job they’re hiring for', icon: <Users size={17} />, tint: 'var(--color-sky)' },
  { label: 'The role, read', detail: 'From the posting itself, not from a guess', icon: <Briefcase size={17} />, tint: 'var(--color-yellow)' },
  { label: 'Resume tailored', detail: 'Every requirement it asks for, none invented', icon: <FileText size={17} />, tint: 'var(--color-accent)' },
  { label: 'Email written', detail: 'From that same resume, so the two agree', icon: <Mail size={17} />, tint: 'var(--color-periwinkle)' },
  { label: 'Waiting for you', detail: 'Nothing sends until you press Send', icon: <Send size={17} />, tint: 'var(--color-accent-strong)' },
]

/** apart · closing · one node per step · hold. */
const STEP_MS = [2100, 1100, 850, 850, 850, 850, 950, 2300]
const LAST_STEP = STEP_MS.length - 1
/** The step at which the tracks have finished merging and the pipeline runs. */
const MERGED_AT = 2

export default function HeroWorkflow() {
  const [step, setStep] = useState(0)
  const [still, setStill] = useState(false)
  // Starts true: the observer below may only pause it. Where an observer never
  // reports — a webview that isn't compositing — the animation must still play
  // rather than freeze on its first frame.
  const [running, setRunning] = useState(true)
  const frame = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => {
      setStill(query.matches)
      if (query.matches) setStep(LAST_STEP)
    }
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    const element = frame.current
    if (!element) return
    let onScreen = true
    // Being on screen is what decides this. A hidden page only stops it once the
    // page has reported itself visible at least once: some in-app browsers — the
    // ones people arrive in from LinkedIn — say "hidden" the whole time they are
    // on screen, and the hero must not sit frozen there.
    let everVisible = false
    const sync = () => {
      if (document.visibilityState === 'visible') everVisible = true
      setRunning(onScreen && !(everVisible && document.hidden))
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting
        sync()
      },
      { threshold: 0.15 }
    )
    observer.observe(element)
    document.addEventListener('visibilitychange', sync)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  useEffect(() => {
    if (still || !running) return
    const timer = setTimeout(() => setStep(step >= LAST_STEP ? 0 : step + 1), STEP_MS[step])
    return () => clearTimeout(timer)
  }, [step, still, running])

  const closing = step >= 1
  const merged = step >= MERGED_AT
  /** How many pipeline stages have lit: all of them once it is holding. */
  const lit = Math.min(Math.max(step - MERGED_AT + 1, 0), PIPELINE.length)

  return (
    <div ref={frame} aria-hidden className="relative max-w-5xl mx-auto mt-14">
      <div className="relative min-h-[330px] sm:min-h-[260px]">
        {/* ── Before: two tracks, each doing half the job ── */}
        <div
          className={`absolute inset-x-0 top-0 grid gap-3 sm:grid-cols-2 transition-all duration-700 ease-[cubic-bezier(0.65,0,0.35,1)] ${
            merged ? 'opacity-0 scale-[0.97] pointer-events-none' : 'opacity-100'
          }`}
        >
          <Track
            name="Resume tailoring"
            shift={closing ? 'sm:translate-x-[14%] translate-y-[14%]' : ''}
            tint="var(--color-accent-soft)"
            steps={['A job description you paste', 'A resume tailored to it']}
          />
          <Track
            name="Recruiter outreach"
            shift={closing ? 'sm:-translate-x-[14%] -translate-y-[14%]' : ''}
            tint="var(--color-yellow-soft)"
            steps={['A recruiter you add', 'An email written for them']}
          />
        </div>

        {/* ── After: one run ── */}
        <div
          className={`absolute inset-x-0 top-0 transition-all duration-700 delay-150 ease-[cubic-bezier(0.34,1.4,0.64,1)] ${
            merged ? 'opacity-100 scale-100' : 'opacity-0 scale-[0.94] pointer-events-none'
          }`}
        >
          <div className="nb-card nb-rounded p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b-[1.6px] border-[var(--color-ink)]">
              <p className="font-black flex items-center gap-2">
                <span className="nb-badge w-8 h-8 bg-[var(--color-yellow)]">
                  <Sparkles size={16} />
                </span>
                One run, start to finish
              </p>
              <span className="nb-chip bg-[var(--color-accent)] whitespace-nowrap">
                <CheckCircle size={13} /> Premium
              </span>
            </div>
            <ol className="grid gap-2 sm:grid-cols-5">
              {PIPELINE.map((stage, i) => (
                <li
                  key={stage.label}
                  className={`relative rounded-[9px] border-[1.6px] border-[var(--color-ink)] p-2.5 transition-all duration-500 ${
                    lit > i ? 'shadow-[3px_3px_0_0_var(--color-ink)] -translate-y-px' : 'opacity-45'
                  }`}
                  style={{ background: lit > i ? stage.tint : 'var(--color-surface-offset)' }}
                >
                  <span className="flex items-center gap-1.5 text-[#0a0a0a]">
                    {stage.icon}
                    <span className="text-[11px] font-black uppercase tracking-wide tabular-nums opacity-70">{i + 1}</span>
                  </span>
                  <p className="mt-1.5 text-sm font-black leading-tight text-[#0a0a0a]">{stage.label}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-[#0a0a0a] opacity-75">{stage.detail}</p>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs font-bold text-[var(--color-text-muted)]">
              The resume and the email come from the same reading of the job, so they say the same thing.
            </p>
          </div>
        </div>
      </div>

      <p className="mt-5 text-center text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-text-faint)]">
        Two halves of the job · one run · you still press Send
      </p>
    </div>
  )
}

function Track({ name, shift, tint, steps }: { name: string; shift: string; tint: string; steps: [string, string] }) {
  return (
    <div
      className={`nb-card nb-rounded p-4 transition-transform duration-700 ease-[cubic-bezier(0.65,0,0.35,1)] ${shift}`}
      style={{ background: tint }}
    >
      <p className="text-[11px] font-black uppercase tracking-wider text-[var(--color-text-faint)]">{name}</p>
      <ol className="mt-3 space-y-2">
        {steps.map((text, i) => (
          <li key={text} className="flex items-center gap-2.5 text-sm font-semibold">
            <span className="nb-badge w-7 h-7 shrink-0 text-xs bg-[var(--color-surface)]">{i + 1}</span>
            {text}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-[var(--color-text-muted)]">On its own, this is half an application.</p>
    </div>
  )
}
