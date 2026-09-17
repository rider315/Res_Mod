'use client'
import { useEffect, useRef, useState } from 'react'
import { Briefcase, CheckCircle, Paperclip, Send, Users } from '@/components/brand/Icons'

/**
 * The hero: a job post becoming a tailored resume, and that resume becoming the
 * email that carries it to the recruiter — the two halves of ResMod in one
 * unbroken chain, drawn with the real thing rather than a diagram of it.
 *
 * The job's requirements lift off the post and land in the resume, where the
 * bullets rewrite themselves and the coverage climbs. The finished resume then
 * hops across into the email, whose lines say the same words the resume now
 * carries, with the tailored PDF attached. It ends on "ready to send", never
 * sent: nothing ResMod writes reaches a recruiter until the user presses Send.
 *
 * Decorative — the heading beside it says this in words — so it is hidden from
 * screen readers and holds still for anyone who asks for less motion. The
 * observer may only pause it, never gate it: in a webview that never reports,
 * it must still play rather than freeze on its first frame.
 */

interface Bullet {
  before: string
  after: [string, string, string]
}

interface Job {
  role: string
  company: string
  place: string
  recruiter: string
  keywords: [string, string, string]
  summary: Array<{ text: string; mark?: boolean }>
  bullets: [Bullet, Bullet, Bullet]
  subject: string
  /** The email, a line at a time, with the words the resume now carries marked. */
  lines: [Array<{ text: string; mark?: boolean }>, Array<{ text: string; mark?: boolean }>]
  candidate: string
  from: number
}

const JOBS: Job[] = [
  {
    role: 'Senior Platform Engineer',
    company: 'Northwind Labs',
    place: 'Bengaluru',
    recruiter: 'Priya Rao',
    keywords: ['Kubernetes', 'Terraform', 'incident response'],
    summary: [
      { text: 'Own our ' },
      { text: 'Kubernetes', mark: true },
      { text: ' clusters, write ' },
      { text: 'Terraform', mark: true },
      { text: ', lead ' },
      { text: 'incident response', mark: true },
      { text: '.' },
    ],
    bullets: [
      { before: 'Deployed services to the cloud', after: ['Ran production ', 'Kubernetes', ', cutting deploy time 40%'] },
      { before: 'Managed infrastructure', after: ['Defined every environment in ', 'Terraform', ''] },
      { before: 'Fixed production bugs on call', after: ['Led ', 'incident response', ' for 2M users'] },
    ],
    subject: 'Platform Engineer — Kubernetes and Terraform',
    lines: [
      [{ text: 'Hi Priya, I saw you’re hiring a Platform Engineer at Northwind.' }],
      [
        { text: 'I run production ' },
        { text: 'Kubernetes', mark: true },
        { text: ', define environments in ' },
        { text: 'Terraform', mark: true },
        { text: ', and led ' },
        { text: 'incident response', mark: true },
        { text: ' for 2M users.' },
      ],
    ],
    candidate: 'Asha Menon',
    from: 3,
  },
  {
    role: 'Site Reliability Engineer',
    company: 'Fabrikam',
    place: 'Pune',
    recruiter: 'Karan Mehta',
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
      { before: 'Set up monitoring dashboards', after: ['Rebuilt ', 'observability', ' around traces'] },
      { before: 'Kept uptime high', after: ['Set error-budget ', 'SLOs', ' reviewed weekly'] },
      { before: 'Automated manual work', after: ['Automated releases in ', 'Python', ', saving 6 hrs a week'] },
    ],
    subject: 'SRE — observability and error-budget SLOs',
    lines: [
      [{ text: 'Hi Karan, I saw Fabrikam is hiring an SRE in Pune.' }],
      [
        { text: 'I rebuilt ' },
        { text: 'observability', mark: true },
        { text: ' around traces, set error-budget ' },
        { text: 'SLOs', mark: true },
        { text: ', and automate in ' },
        { text: 'Python', mark: true },
        { text: '.' },
      ],
    ],
    candidate: 'Asha Menon',
    from: 3,
  },
]

/** read the post · three keywords across · scored · into the email · subject · two lines · ready · hold. */
const STEP_MS = [1400, 800, 800, 800, 850, 800, 700, 750, 900, 2200]
const LAST_STEP = STEP_MS.length - 1
const RING = 2 * Math.PI * 22

export default function HeroWorkflow() {
  const [jobIndex, setJobIndex] = useState(0)
  const [step, setStep] = useState(0)
  const [still, setStill] = useState(false)
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
      { threshold: 0.1 }
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
      if (step < LAST_STEP) setStep(step + 1)
      else {
        setStep(0)
        setJobIndex((current) => (current + 1) % JOBS.length)
      }
    }, STEP_MS[step])
    return () => clearTimeout(timer)
  }, [step, still, running])

  const job = JOBS[jobIndex]
  const landed = Math.min(Math.max(step, 0), 3)
  const tailored = step >= 4
  const covered = tailored ? 9 : job.from
  const handedOver = step >= 5
  const emailLines = Math.min(Math.max(step - 5, 0), 2)
  const attached = step >= 7
  const ready = step >= 8
  const cycle = `${jobIndex}-${step}`

  return (
    <div ref={frame} aria-hidden className="relative max-w-6xl mx-auto mt-14">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_56px_minmax(0,1fr)_56px_minmax(0,1fr)] items-stretch">
        {/* ── 1. The job, and who is hiring for it ── */}
        <Card label="The job they’re hiring for" tone="var(--color-yellow-soft)">
          {!still && step === 0 && <span key={cycle} className="hero-scan" />}
          <div className="flex items-center gap-2.5">
            <span className="nb-badge w-9 h-9 shrink-0 bg-[var(--color-yellow)]">
              <Briefcase size={17} />
            </span>
            <div className="min-w-0">
              <p className="font-extrabold text-sm leading-tight truncate">{job.role}</p>
              <p className="text-[11px] text-[var(--color-text-muted)] truncate">
                {job.company} · {job.place}
              </p>
            </div>
          </div>
          <p className="mt-3 text-[13px] text-[var(--color-text-muted)] leading-relaxed">
            {job.summary.map((part, i) =>
              part.mark ? (
                <Mark key={i}>{part.text}</Mark>
              ) : (
                <span key={i}>{part.text}</span>
              )
            )}
          </p>
          <div className="mt-3 flex items-center gap-2 pt-2.5 border-t-[1.6px] border-[var(--color-border-soft)]">
            <span className="nb-badge w-7 h-7 shrink-0 bg-[var(--color-sky)] text-[11px] font-black">{job.recruiter.charAt(0)}</span>
            <p className="text-[11px] min-w-0 truncate">
              <span className="font-bold">{job.recruiter}</span>
              <span className="text-[var(--color-text-faint)]"> · recruiting</span>
            </p>
          </div>
        </Card>

        <Link active={!still && step >= 1 && step <= 3}>
          {!still &&
            job.keywords.map((keyword, i) =>
              step === i + 1 ? (
                <span key={`${cycle}-${keyword}`} className="hero-fly nb-chip bg-[var(--color-accent)] whitespace-nowrap text-[11px]">
                  {keyword}
                </span>
              ) : null
            )}
        </Link>

        {/* ── 2. The resume, tailored to it ── */}
        <Card label="Your resume, tailored" tone="var(--color-surface)" lift={tailored}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-extrabold text-sm leading-tight truncate">{job.candidate}</p>
              <p className="text-[11px] text-[var(--color-text-muted)] truncate">Platform Engineer</p>
            </div>
            <Ring covered={covered} done={tailored} />
          </div>
          <ul className="mt-3 space-y-2 text-[13px]">
            {job.bullets.map((bullet, i) => (
              <li key={`${jobIndex}-${i}`} className="leading-snug">
                {landed > i ? (
                  <span className="hero-bullet-in block font-medium">
                    • {bullet.after[0]}
                    <Mark>{bullet.after[1]}</Mark>
                    {bullet.after[2]}
                  </span>
                ) : (
                  <span className="block text-[var(--color-text-faint)]">• {bullet.before}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Link active={!still && step === 5}>
          {!still && step === 5 && (
            <span key={`${cycle}-pdf`} className="hero-fly nb-chip bg-[var(--color-sky)] whitespace-nowrap text-[11px]">
              <Paperclip size={12} /> PDF
            </span>
          )}
        </Link>

        {/* ── 3. The email that carries it ── */}
        <Card label="The email to the recruiter" tone="var(--color-accent-soft)" lift={ready}>
          <div className="flex items-center gap-2.5">
            <span className="nb-badge w-9 h-9 shrink-0 bg-[var(--color-periwinkle)] text-white">
              <Users size={17} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] text-[var(--color-text-faint)] font-bold uppercase tracking-wide">To</p>
              <p className="font-extrabold text-sm leading-tight truncate">{job.recruiter}</p>
            </div>
          </div>
          <div className="mt-3 min-h-[92px]">
            {handedOver ? (
              <p className="hero-bullet-in text-[13px] font-black leading-snug">{job.subject}</p>
            ) : (
              <p className="text-[13px] text-[var(--color-text-faint)]">Waiting for the tailored resume…</p>
            )}
            {job.lines.slice(0, emailLines).map((line, i) => (
              <p key={`${jobIndex}-line-${i}`} className="hero-bullet-in mt-1.5 text-[13px] leading-snug text-[var(--color-text-muted)]">
                {line.map((part, j) => (part.mark ? <Mark key={j}>{part.text}</Mark> : <span key={j}>{part.text}</span>))}
              </p>
            ))}
          </div>
          <div className="mt-2 pt-2.5 border-t-[1.6px] border-[var(--color-border-soft)] flex flex-wrap items-center gap-2">
            {attached && (
              <span className="hero-bullet-in nb-chip bg-[var(--color-surface)] text-[11px] whitespace-nowrap">
                <Paperclip size={12} /> {job.candidate} Resume.pdf
              </span>
            )}
            {ready && (
              <span className="hero-bullet-in nb-chip bg-[var(--color-accent)] text-[11px] whitespace-nowrap">
                <Send size={12} /> Ready to send
              </span>
            )}
          </div>
        </Card>
      </div>

      <p className="mt-6 text-center text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-text-faint)]">
        Tailored for the job · written from that resume · you press Send
      </p>
    </div>
  )
}

function Mark({ children }: { children: React.ReactNode }) {
  return <span className="bg-[var(--color-accent)] px-1 font-semibold text-[#0a0a0a]">{children}</span>
}

function Card({ label, tone, lift = false, children }: { label: string; tone: string; lift?: boolean; children: React.ReactNode }) {
  return (
    <section
      className={`nb-card nb-rounded relative overflow-hidden p-4 flex flex-col transition-all duration-500 ${
        lift ? 'shadow-[6px_6px_0_0_var(--color-ink)] -translate-y-0.5' : ''
      }`}
      style={{ background: tone }}
    >
      <p className="text-[10px] font-black uppercase tracking-wider text-[var(--color-text-faint)] mb-2.5">{label}</p>
      {children}
    </section>
  )
}

/** The gap between two cards, and whatever is crossing it. */
function Link({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div className="hero-lane hero-lane-wide h-10 lg:h-auto flex items-center justify-center">
      <span className={`hero-rail ${active ? 'hero-rail-live' : ''}`} />
      {children}
    </div>
  )
}

function Ring({ covered, done }: { covered: number; done: boolean }) {
  return (
    <span className="relative shrink-0 w-[52px] h-[52px] grid place-items-center">
      <svg viewBox="0 0 52 52" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="26" cy="26" r="22" fill="none" stroke="var(--color-border-soft)" strokeWidth="4.5" />
        <circle
          cx="26"
          cy="26"
          r="22"
          fill="none"
          stroke={done ? 'var(--color-accent-strong)' : 'var(--color-primary)'}
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeDasharray={RING}
          strokeDashoffset={RING * (1 - covered / 9)}
          style={{ transition: 'stroke-dashoffset 800ms cubic-bezier(0.22,1,0.36,1), stroke 300ms ease' }}
        />
      </svg>
      <span className="relative text-center leading-none">
        {done ? (
          <CheckCircle size={17} className="mx-auto text-[var(--color-success)]" />
        ) : (
          <>
            <span className="block text-sm font-black tabular-nums">{covered}</span>
            <span className="block text-[8px] font-bold text-[var(--color-text-faint)]">of 9</span>
          </>
        )}
      </span>
    </span>
  )
}
