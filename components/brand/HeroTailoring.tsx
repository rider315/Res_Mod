'use client'
import { useEffect, useRef, useState } from 'react'
import { Briefcase, CheckCircle, FileText } from '@/components/brand/Icons'

/**
 * The hero animation: one resume, reshaped for whichever job it is pointed at.
 *
 * A job's requirements lift off the post on the left, arc through the tailoring
 * core, and land in the resume on the right, where the bullet they belong to
 * rewrites itself and the keyword coverage climbs. Then the job changes and the
 * same resume adapts again.
 *
 * It is decorative — the heading beside it says the same thing in words — so it
 * is hidden from screen readers, holds still for anyone who asks for less
 * motion, and stops while it is off screen or the tab is in the background.
 */

interface Bullet {
  /** The resume as written, before this job was pasted in. */
  before: string
  /** The same experience, said in the job's own words. */
  after: [string, string, string]
}

interface Job {
  role: string
  company: string
  place: string
  /** What the post asks for, in the order they fly across. */
  keywords: [string, string, string]
  /** The post's own wording, with its requirements marked. */
  summary: Array<{ text: string; mark?: boolean }>
  bullets: [Bullet, Bullet, Bullet]
  /** Keywords already covered before tailoring, out of nine. */
  from: number
}

const JOBS: Job[] = [
  {
    role: 'Senior Platform Engineer',
    company: 'Northwind Labs',
    place: 'Bengaluru',
    keywords: ['Kubernetes', 'Terraform', 'incident response'],
    summary: [
      { text: 'Own our ' },
      { text: 'Kubernetes', mark: true },
      { text: ' clusters, write ' },
      { text: 'Terraform', mark: true },
      { text: ', and lead ' },
      { text: 'incident response', mark: true },
      { text: '.' },
    ],
    bullets: [
      { before: 'Deployed services to the cloud', after: ['Ran production ', 'Kubernetes', ' clusters, cutting deploy time 40%'] },
      { before: 'Managed infrastructure', after: ['Defined every environment in ', 'Terraform', ', reviewed as code'] },
      { before: 'Fixed production bugs on call', after: ['Led ', 'incident response', ' for a platform serving 2M users'] },
    ],
    from: 3,
  },
  {
    role: 'Backend Engineer',
    company: 'Contoso',
    place: 'Remote',
    keywords: ['Go', 'PostgreSQL', 'gRPC'],
    summary: [
      { text: 'Build services in ' },
      { text: 'Go', mark: true },
      { text: ' on ' },
      { text: 'PostgreSQL', mark: true },
      { text: ', talking over ' },
      { text: 'gRPC', mark: true },
      { text: '.' },
    ],
    bullets: [
      { before: 'Wrote internal tools', after: ['Built deployment tools in ', 'Go', ', used by 40 engineers'] },
      { before: 'Worked with databases', after: ['Tuned ', 'PostgreSQL', ' queries, cutting p95 from 900ms to 80ms'] },
      { before: 'Connected services together', after: ['Moved service calls to ', 'gRPC', ', halving payload size'] },
    ],
    from: 4,
  },
  {
    role: 'Site Reliability Engineer',
    company: 'Fabrikam',
    place: 'Pune',
    keywords: ['observability', 'SLOs', 'Python'],
    summary: [
      { text: 'Improve ' },
      { text: 'observability', mark: true },
      { text: ', hold us to ' },
      { text: 'SLOs', mark: true },
      { text: ', automate in ' },
      { text: 'Python', mark: true },
      { text: '.' },
    ],
    bullets: [
      { before: 'Set up monitoring dashboards', after: ['Rebuilt ', 'observability', ' around traces, not just dashboards'] },
      { before: 'Kept uptime high', after: ['Set error-budget ', 'SLOs', ' the team actually reviewed each week'] },
      { before: 'Automated manual work', after: ['Automated the release checklist in ', 'Python', ', saving 6 hrs a week'] },
    ],
    from: 3,
  },
]

/** scan the post · three keywords across · score · hold. */
const STEP_MS = [1500, 900, 900, 900, 1300, 2000]
const LAST_STEP = STEP_MS.length - 1
const RING = 2 * Math.PI * 26

export default function HeroTailoring() {
  const [jobIndex, setJobIndex] = useState(0)
  const [step, setStep] = useState(0)
  const [still, setStill] = useState(false)
  const frame = useRef<HTMLDivElement>(null)
  // Starts true: the observer below may only pause it. Where an observer never
  // reports — a webview that isn't compositing — the animation must still play
  // rather than freeze on its first frame.
  const [running, setRunning] = useState(true)

  // Anyone who asks for less motion gets the finished tailoring, not a slideshow of it.
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

  // Nothing runs while it is scrolled away or the tab is hidden.
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
    const timer = setTimeout(() => {
      if (step < LAST_STEP) {
        setStep(step + 1)
      } else {
        setStep(0)
        setJobIndex((current) => (current + 1) % JOBS.length)
      }
    }, STEP_MS[step])
    return () => clearTimeout(timer)
  }, [step, still, running])

  const job = JOBS[jobIndex]
  const landed = Math.min(Math.max(step, 0), 3)
  const scored = step >= 4
  const covered = scored ? 9 : job.from
  // Each cycle gets its own key so the cards animate in when the job changes.
  const cycle = `${jobIndex}-${step === 0 ? 'a' : 'b'}`

  return (
    <div ref={frame} aria-hidden className="relative max-w-5xl mx-auto mt-16">
      <div className="grid gap-5 md:gap-0 md:grid-cols-[minmax(0,1fr)_128px_minmax(0,1fr)] items-center">
        {/* ── The job post ─────────────────────────────── */}
        <div key={`post-${jobIndex}`} className="nb-card nb-rounded p-5 md:-rotate-2 relative overflow-hidden hero-card-in">
          {!still && step === 0 && <span key={cycle} className="hero-scan" />}
          <div className="flex items-center gap-3">
            <span className="nb-badge w-10 h-10 shrink-0 bg-[var(--color-yellow)]">
              <Briefcase size={20} />
            </span>
            <div className="min-w-0">
              <p className="font-extrabold leading-tight truncate">{job.role}</p>
              <p className="text-xs text-[var(--color-text-muted)] truncate">
                {job.company} · {job.place}
              </p>
            </div>
          </div>
          <p className="mt-4 text-sm text-[var(--color-text-muted)] leading-relaxed">
            {job.summary.map((part, i) =>
              part.mark ? (
                <span key={i} className="bg-[var(--color-accent)] px-1 font-semibold text-[#0a0a0a]">
                  {part.text}
                </span>
              ) : (
                <span key={i}>{part.text}</span>
              )
            )}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {job.keywords.map((keyword, i) => (
              <span
                key={keyword}
                className={`nb-chip transition-all duration-300 ${
                  landed > i ? 'bg-[var(--color-surface-offset)] text-[var(--color-text-faint)] opacity-50' : 'bg-white'
                }`}
              >
                {keyword}
              </span>
            ))}
          </div>
        </div>

        {/* ── The lane the keywords cross ──────────────── */}
        <div className="hero-lane h-16 md:h-40 flex items-center justify-center">
          <span className="hero-rail" />
          <span className={`hero-core ${!still && step >= 1 && step <= 3 ? 'hero-core-live' : ''}`}>
            <FileText size={18} />
          </span>
          {!still &&
            job.keywords.map((keyword, i) =>
              step === i + 1 ? (
                <span key={`${cycle}-${keyword}`} className="hero-fly nb-chip bg-[var(--color-accent)] whitespace-nowrap">
                  {keyword}
                </span>
              ) : null
            )}
        </div>

        {/* ── The resume ───────────────────────────────── */}
        <div key={`resume-${jobIndex}`} className="nb-card nb-rounded p-5 md:rotate-2 hero-card-in">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-extrabold text-lg leading-tight">Asha Menon</p>
              <p className="text-xs text-[var(--color-text-muted)] truncate">Platform Engineer · asha@example.com</p>
            </div>
            <Coverage covered={covered} scored={scored} />
          </div>
          <ul className="mt-4 space-y-2.5 text-sm">
            {job.bullets.map((bullet, i) => (
              <li key={`${jobIndex}-${i}`} className="leading-relaxed">
                {landed > i ? (
                  <span key="after" className="hero-bullet-in block font-medium">
                    • {bullet.after[0]}
                    <span className="bg-[var(--color-accent)] px-1 font-semibold text-[#0a0a0a]">{bullet.after[1]}</span>
                    {bullet.after[2]}
                  </span>
                ) : (
                  <span className="block text-[var(--color-text-faint)]">• {bullet.before}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-6 text-center text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-text-faint)]">
        One resume · {JOBS.length} jobs · nothing invented
      </p>
    </div>
  )
}

/** The share of the job's keywords the resume now carries. */
function Coverage({ covered, scored }: { covered: number; scored: boolean }) {
  return (
    <span className="relative shrink-0 w-[62px] h-[62px] grid place-items-center">
      <svg viewBox="0 0 62 62" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="31" cy="31" r="26" fill="none" stroke="var(--color-border-soft)" strokeWidth="5" />
        <circle
          cx="31"
          cy="31"
          r="26"
          fill="none"
          stroke={scored ? 'var(--color-accent-strong)' : 'var(--color-primary)'}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={RING}
          strokeDashoffset={RING * (1 - covered / 9)}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.22,1,0.36,1), stroke 300ms ease' }}
        />
      </svg>
      <span className="relative text-center leading-none">
        {scored ? (
          <CheckCircle size={20} className="mx-auto text-[var(--color-success)]" />
        ) : (
          <>
            <span className="block text-base font-black tabular-nums">{covered}</span>
            <span className="block text-[9px] font-bold text-[var(--color-text-faint)]">of 9</span>
          </>
        )}
      </span>
    </span>
  )
}
