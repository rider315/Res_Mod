'use client'

import Link from 'next/link'
import HeroTailoring from '@/components/brand/HeroTailoring'
import HeroWorkflow from '@/components/brand/HeroWorkflow'
import SiteFooter from '@/components/brand/SiteFooter'
import SiteHeader from '@/components/brand/SiteHeader'
import { StartButton } from '@/components/brand/SignInButton'
import {
  ArrowRight,
  Briefcase,
  CheckCircle,
  ChevronDown,
  FileText,
  KeyIcon,
  Layers,
  Mail,
  Pencil,
  Reply,
  Send,
  Shield,
  Sliders,
  Upload,
} from '@/components/brand/Icons'
import { CREDIT_PACKS, EMAIL_DRAFTS_PER_MONTH, formatPrice, IMPORTS_PER_MONTH, PREMIUM_PLAN, PRO_PLAN } from '@/lib/billing/plans'

/**
 * The public home page: what Chills does, how, reaching recruiters with the
 * result, an example of the changes it makes, answers to the usual questions,
 * and the prices. Every "start" button
 * signs in with Google.
 */

interface LoginPageProps {
  /** Free tailorings every account gets; null while Chills AI isn't switched on. */
  freeTailorings: number | null
  /** Arrived here straight after deleting an account. */
  accountDeleted: boolean
}

const FEATURES: Array<{ icon: React.ReactNode; title: string; text: string }> = [
  {
    icon: <KeyIcon />,
    title: 'Every required keyword',
    text: 'Chills picks out the terms an ATS screens the job for, works them into your resume, and shows a score so you can see nothing is missing.',
  },
  {
    icon: <Sliders />,
    title: 'Soft, Hard or Hardest',
    text: 'Choose how much changes: a light touch on the summary and skills, or every bullet reframed around the role.',
  },
  {
    icon: <Shield />,
    title: 'Still your resume',
    text: 'Employers, job titles, dates, degrees and your numbers stay exactly as they are. Nothing is made up.',
  },
  {
    icon: <Pencil />,
    title: 'You approve every change',
    text: 'See each rewrite next to the original. Keep it, edit it, or leave it out. Your saved resume never changes.',
  },
  {
    icon: <Mail />,
    title: 'A cover letter to match',
    text: 'Write a cover letter from any tailored resume, in the tone you want, and edit it before you send it.',
  },
  {
    icon: <FileText />,
    title: 'Any format in, a clean resume out',
    text: 'Import a PDF, Word, LaTeX or text file. You get a clean LaTeX resume that ATS software can read, as a PDF or .tex.',
  },
]

const WAYS: Array<{ icon: React.ReactNode; name: string; title: string; text: string; premium?: boolean }> = [
  {
    icon: <FileText size={22} />,
    name: 'On its own',
    title: 'Resume tailoring',
    text: 'Paste a job description and get your resume rewritten toward it, every change shown next to the original for you to keep or drop. Download it as a PDF or .tex, with a cover letter to match.',
  },
  {
    icon: <Mail size={22} />,
    name: 'On its own',
    title: 'Recruiter emails',
    text: 'Import the recruiters you want to reach, and Chills writes each a short email from your resume. Send from your own mailbox, then track who opened, who replied, and what to say next.',
  },
  {
    icon: <Layers size={22} />,
    name: 'Both, in one run',
    title: 'The whole application',
    text: 'Give Chills a recruiter and the job they’re hiring for. It reads that posting, tailors your resume to it, and writes the email from the same reading — so the email and the resume attached to it say the same thing.',
    premium: true,
  },
]

const OUTREACH_POINTS: Array<{ icon: React.ReactNode; title: string; text: string }> = [
  {
    icon: <Pencil size={18} />,
    title: 'Written from your resume',
    text: 'Short, specific emails built from your real experience and the job post. No invented facts, no made-up company news.',
  },
  {
    icon: <Send size={18} />,
    title: 'Sent as you, with the right resume',
    text: 'Emails go out from your own Gmail, Outlook or Zoho, with the tailored PDF for that job attached. Replies land in your inbox.',
  },
  {
    icon: <Reply size={18} />,
    title: 'Every reply followed up',
    text: 'See who opened and who answered, get a follow-up after a quiet week, and paste a reply to get an answer you can send.',
  },
]

const FAQ: Array<[string, React.ReactNode]> = [
  [
    'How does Chills tailor my resume?',
    <>
      It reads the job description, picks out the <strong>keywords an ATS screens for</strong>, and rewrites your summary, skills and
      bullets around them at the level you choose. You then see <strong>every change next to the original</strong> and decide what goes in.
    </>,
  ],
  [
    'Will it change my experience or invent anything?',
    <>
      No. Your <strong>employers, job titles, dates, degrees and contact details never change</strong>, and your metrics are kept. If a
      skill ends up listed with no bullet behind it, Chills flags it so you can remove it or be ready to talk about it.
    </>,
  ],
  [
    'What do Soft, Hard and Hardest mean?',
    <>
      <strong>Soft</strong> adjusts the summary, skills and at most one bullet per role. <strong>Hard</strong> rebuilds the summary and skills
      and rewrites at least two bullets per role. <strong>Hardest</strong> rewrites every editable line toward the job.
    </>,
  ],
  [
    'What is an ATS, and how does Chills help with it?',
    <>
      An Applicant Tracking System is the software many employers use to collect and filter applications. Chills&apos;s resume template
      is plain, selectable text that these systems read well, and every <strong>required keyword</strong> from the job ends up in your
      resume.
    </>,
  ],
  [
    'Which file formats can I import?',
    <>
      <strong>PDF, Word (.docx), LaTeX (.tex) and plain text</strong>, up to 4 MB, or paste the text in. You check the imported resume and
      fix anything before it is saved. Old Word .doc files need saving as .docx first.
    </>,
  ],
  [
    'Can I edit the tailored resume?',
    <>
      Yes. You can <strong>edit any suggested change</strong> before applying it, and edit your saved resume at any time. Every tailored
      copy is kept in your history, so you can download it again later.
    </>,
  ],
  [
    'Can I get a cover letter too?',
    <>
      Yes. From any tailored resume you can write a <strong>matching cover letter</strong>, pick its tone, edit it, and download it as a PDF
      or copy it.
    </>,
  ],
  [
    'Can Chills email recruiters for me?',
    <>
      Yes. Add the recruiters you want to reach, and Chills writes each one a <strong>short email from your resume</strong>. You read and
      edit it, then send it from <strong>your own mailbox with the tailored PDF attached</strong>, or open it in Gmail or Outlook and send it
      there. Chills never emails anyone without you pressing Send.
    </>,
  ],
  [
    'Is it safe to connect my mailbox?',
    <>
      Chills uses an <strong>app password</strong>, a separate password your email provider makes for one app, never your real one. It is
      stored encrypted, used only to send the emails you send, and you can disconnect it or delete it at your provider at any time.
    </>,
  ],
  [
    'How long does it take?',
    <>Usually a minute or two. You can watch each step, and the AI used, as it happens.</>,
  ],
  [
    'Does it work in other languages?',
    <>Chills works best with resumes and job descriptions written in English.</>,
  ],
  [
    'What happens to my data?',
    <>
      Your resumes are kept in your account until you delete them, and you can delete your whole account at any time. They are not used
      to train AI models. The <Link href="/privacy" className="underline font-semibold">Privacy Policy</Link> has the details.
    </>,
  ],
]

export default function LoginPage({ freeTailorings, accountDeleted }: LoginPageProps) {
  const startNote = freeTailorings
    ? `${freeTailorings} free tailorings · No card needed`
    : 'Sign in with Google to get started'

  return (
    <div className="min-h-screen bg-[var(--color-surface)] text-[var(--color-text)]">
      <SiteHeader />

      {accountDeleted && (
        <div className="bg-[var(--color-success-highlight)] border-b-[1.6px] border-[var(--color-ink)]">
          <p className="max-w-6xl mx-auto px-6 py-3 text-sm font-semibold">Your account has been deleted.</p>
        </div>
      )}

      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="px-4 sm:px-6 pt-14 sm:pt-20 pb-16 overflow-hidden">
        <div className="max-w-5xl mx-auto text-center">
          <h1 className="text-[2.6rem] leading-[1.15] sm:text-6xl sm:leading-[1.2] font-black tracking-tight">
            <span className="nb-highlight">Tailor your resume</span>
            <br />
            and email it to the recruiter
          </h1>
          <p className="mt-7 text-lg sm:text-2xl text-[var(--color-text-muted)] max-w-3xl mx-auto leading-relaxed">
            Paste a job and get a resume that speaks to it, with every required keyword in and nothing made up. Then let Chills write
            the recruiter an email from that same resume, with it attached. Use either on its own, or both in one run.
          </p>
          <div className="mt-9 flex flex-col items-center gap-3">
            <StartButton />
            <p className="text-sm font-bold text-[var(--color-text-muted)]">{startNote}</p>
          </div>
        </div>

        <HeroWorkflow />
      </section>

      {/* ── Three ways to use it ─────────────────────────── */}
      <section className="bg-[var(--color-cream)] border-y-[1.6px] border-[var(--color-ink)] px-4 sm:px-6 py-20">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-black">Use one half, or both</h2>
            <p className="mt-5 text-lg text-[var(--color-text-muted)]">
              Tailoring and recruiter emails each work on their own, on every plan. Run them together and they stop guessing at each
              other.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3 items-stretch">
            {WAYS.map((way) => (
              <div
                key={way.title}
                className={`nb-card p-6 flex flex-col ${way.premium ? 'md:-translate-y-2 border-[3px] shadow-[6px_6px_0_0_#0a0a0a] bg-[var(--color-accent-soft)]' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="nb-badge w-11 h-11 bg-[var(--color-yellow)]">{way.icon}</span>
                  {way.premium && (
                    <span className="nb-chip bg-[var(--color-accent)] whitespace-nowrap">
                      <CheckCircle size={13} /> Premium
                    </span>
                  )}
                </div>
                <p className="mt-4 text-[11px] font-black uppercase tracking-wider text-[var(--color-text-faint)]">{way.name}</p>
                <h3 className="mt-1 text-xl font-extrabold leading-tight">{way.title}</h3>
                <p className="mt-3 text-[var(--color-text-muted)] leading-relaxed flex-1">{way.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────── */}
      <section id="how-it-works" className="scroll-mt-20 bg-[var(--color-periwinkle)] border-y-[1.6px] border-[var(--color-ink)] px-4 sm:px-6 py-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-black text-center">How Chills works</h2>
          <div className="mt-12 grid gap-10 md:grid-cols-3">
            <Step n={1} label="Import your resume">
              <div className="flex items-center gap-3">
                <span className="nb-badge w-11 h-11 bg-[var(--color-accent)]">
                  <Upload size={22} />
                </span>
                <div className="text-left">
                  <p className="font-bold">resume.pdf</p>
                  <p className="text-xs text-[var(--color-text-muted)]">PDF · Word · LaTeX · text</p>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <Line w="w-full" />
                <Line w="w-4/5" />
                <Line w="w-3/5" />
              </div>
            </Step>
            <Step n={2} label="Paste the job description">
              <div className="flex items-center gap-2">
                <Briefcase size={18} />
                <p className="font-bold">Platform Engineer</p>
              </div>
              <p className="mt-3 text-sm text-[var(--color-text-muted)] text-left leading-relaxed">
                You will run <Mark>Kubernetes</Mark> clusters, write <Mark>Terraform</Mark> and build tools in <Mark>Python</Mark>…
              </p>
            </Step>
            <Step n={3} label="Review and download">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-faint)] text-left">Suggested change</p>
              <p className="mt-2 text-sm text-left line-through decoration-2 decoration-[var(--color-error)] text-[var(--color-text-muted)]">
                Deployed services to the cloud
              </p>
              <p className="mt-1 text-sm text-left font-semibold">
                Deployed services on <Mark>Kubernetes</Mark> with <Mark>Terraform</Mark>
              </p>
              <div className="mt-4 flex gap-2">
                <span className="nb-chip bg-[var(--color-accent)]">
                  <CheckCircle size={14} /> Keep
                </span>
                <span className="nb-chip bg-white">PDF</span>
                <span className="nb-chip bg-white">.tex</span>
              </div>
            </Step>
          </div>
          <HeroTailoring />
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────── */}
      <section className="bg-[var(--color-sky)] border-b-[1.6px] border-[var(--color-ink)] px-4 sm:px-6 py-20">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-black">Stop rewriting your resume for every application</h2>
            <p className="mt-4 text-lg sm:text-xl font-bold text-[var(--color-text-muted)]">
              A job-specific resume in a couple of minutes, built from your real experience.
            </p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="nb-card p-6">
                <div className="flex items-center gap-3">
                  <span className="nb-badge w-11 h-11 bg-[var(--color-accent)] shrink-0">{feature.icon}</span>
                  <h3 className="text-xl font-extrabold leading-tight">{feature.title}</h3>
                </div>
                <p className="mt-4 text-[var(--color-text-muted)] leading-relaxed">{feature.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-12 flex flex-col items-center gap-3">
            <StartButton />
            <p className="text-sm font-bold text-[var(--color-text-muted)]">{startNote}</p>
          </div>
        </div>
      </section>

      {/* ── Outreach ─────────────────────────────────────── */}
      <section id="outreach" className="scroll-mt-20 px-4 sm:px-6 py-20 bg-[var(--color-yellow-soft)] border-b-[1.6px] border-[var(--color-ink)]">
        <div className="max-w-6xl mx-auto grid gap-12 lg:grid-cols-2 items-center">
          <div>
            <h2 className="text-3xl sm:text-4xl font-black">
              Then get it in front of <span className="nb-highlight">a recruiter</span>
            </h2>
            <p className="mt-4 text-lg text-[var(--color-text-muted)]">
              Import the recruiters you want to reach, from a spreadsheet, a PDF list or a Google Sheet, and send each one a personal email
              with the resume tailored for their job.
            </p>
            <ul className="mt-8 space-y-5">
              {OUTREACH_POINTS.map((point) => (
                <li key={point.title} className="flex items-start gap-3">
                  <span className="nb-badge w-10 h-10 shrink-0 bg-[var(--color-accent)]">{point.icon}</span>
                  <span>
                    <span className="block text-lg font-extrabold">{point.title}</span>
                    <span className="block text-[var(--color-text-muted)] leading-relaxed">{point.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <OutreachVisual />
        </div>
      </section>

      {/* ── Example ──────────────────────────────────────── */}
      <section className="px-4 sm:px-6 py-20 bg-[var(--color-surface)]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center">
            <h2 className="text-3xl sm:text-4xl font-black">See what a tailoring changes</h2>
            <p className="mt-3 text-lg text-[var(--color-text-muted)]">
              A backend engineer&apos;s resume, tailored to a platform engineering job.
            </p>
          </div>
          <ExampleResume />
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────── */}
      <section id="faq" className="scroll-mt-20 px-4 sm:px-6 py-20 bg-[var(--color-bg)] border-y-[1.6px] border-[var(--color-ink)]">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-black text-center">Frequently asked questions</h2>
          <div className="mt-10 space-y-4">
            {FAQ.map(([question, answer], i) => (
              <details key={question} open={i === 0} className="group nb-card nb-rounded bg-[var(--color-accent-soft)] px-5 py-4">
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none font-bold text-lg">
                  {question}
                  <ChevronDown size={20} className="shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-3 text-[var(--color-text-muted)] leading-relaxed [&_strong]:text-[var(--color-text)]">{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────── */}
      <section id="pricing" className="scroll-mt-20 px-4 sm:px-6 py-20 bg-[var(--color-sky-soft)]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-black text-center">Simple, clear pricing</h2>
          <p className="mt-3 text-center text-lg text-[var(--color-text-muted)]">
            Start free. Get Pro or a credit pack whenever you like.
          </p>
          <PricingCards freeTailorings={freeTailorings} />
          <div className="mt-12 flex flex-col items-center gap-3">
            <StartButton label="Get started" />
            <Link href="/pricing" className="text-sm font-bold underline underline-offset-4">
              Full pricing details
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}

function Mark({ children }: { children: React.ReactNode }) {
  return <span className="bg-[var(--color-accent)] px-1 font-semibold text-[#0a0a0a]">{children}</span>
}

function Line({ w }: { w: string }) {
  return <div className={`h-2.5 ${w} bg-[var(--color-surface-dynamic)] rounded-sm`} />
}

function Step({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-3">
        <span className="nb-badge w-10 h-10 bg-[var(--color-accent)] text-lg">{n}.</span>
        <span className="nb-badge h-10 px-4 bg-[var(--color-yellow)]">{label}</span>
      </div>
      <div className="nb-card nb-rounded mt-5 w-full p-5">{children}</div>
    </div>
  )
}

/** Original example of a tailoring, with the reason for each change. */
function ExampleResume() {
  const changes: Array<{ note: string; before: string; after: React.ReactNode }> = [
    {
      note: 'Added the tools the job lists as required.',
      before: 'Skills: Python, Go, PostgreSQL, Docker',
      after: (
        <>
          Skills: Go, Python, <Mark>Kubernetes</Mark>, <Mark>Terraform</Mark>, PostgreSQL, Docker
        </>
      ),
    },
    {
      note: 'Reframed a bullet around the on-call work the role asks for.',
      before: 'Maintained the payments service and fixed production bugs',
      after: (
        <>
          Kept the payments service running as part of the on-call rota, leading <Mark>incident response</Mark> and postmortems
        </>
      ),
    },
    {
      note: 'Moved Go first: it is the job’s main language.',
      before: 'Built internal tools in Python and Go',
      after: (
        <>
          Built internal deployment tools in <Mark>Go</Mark> and Python used by 40 engineers
        </>
      ),
    },
  ]

  return (
    <div className="nb-card nb-rounded mt-10 p-5 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b-[1.6px] border-[var(--color-ink)] pb-4">
        <div>
          <p className="text-2xl font-black">Rahul Verma</p>
          <p className="text-sm text-[var(--color-text-muted)]">Backend Engineer · Pune · rahul@example.com</p>
        </div>
        <div className="flex items-center gap-2 text-sm font-bold">
          <span className="nb-chip bg-[var(--color-error-highlight)]">Before 38%</span>
          <ArrowRight size={16} />
          <span className="nb-chip bg-[var(--color-accent)]">After 100%</span>
        </div>
      </div>
      <div className="mt-6 space-y-7">
        {changes.map((change) => (
          <div key={change.note}>
            <span className="nb-badge inline-flex px-3 py-1 text-sm bg-[var(--color-yellow)] -rotate-1">{change.note}</span>
            <div className="mt-3 rounded-[10px] border-[1.6px] border-[var(--color-border-soft)] shadow-[4px_4px_0_0_rgba(0,0,0,0.25)] p-4 space-y-2 text-sm">
              <p className="text-[var(--color-text-muted)] line-through decoration-2 decoration-[var(--color-error)]">{change.before}</p>
              <p className="font-medium leading-relaxed">{change.after}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** A recruiter email and where it got to, drawn with the page's own pieces. */
function OutreachVisual() {
  return (
    <div className="relative mx-auto w-full max-w-md" aria-hidden>
      <div className="nb-card p-5 rotate-[-1.5deg] bg-[var(--color-surface)]">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-bold text-[var(--color-text-muted)]">To: Priya Rao · Northwind</span>
          <span className="nb-chip bg-[var(--color-sky)]">Sent</span>
        </div>
        <p className="mt-3 font-black">Platform Engineer: Kubernetes and Terraform experience</p>
        <div className="mt-3 space-y-2">
          <Line w="w-full" />
          <Line w="w-11/12" />
          <Line w="w-4/5" />
        </div>
        <div className="mt-4 inline-flex items-center gap-2 rounded-[8px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-bg)] px-3 py-1.5 text-xs font-bold">
          <FileText size={14} /> Riya Patel Resume.pdf
        </div>
      </div>
      <div className="nb-card p-4 mt-5 ml-10 rotate-[1.5deg] bg-[var(--color-accent-soft)]">
        <div className="flex items-center gap-2 text-xs">
          <span className="nb-chip bg-[var(--color-accent-strong)]">Wants an interview</span>
          <span className="text-[var(--color-text-muted)] font-semibold">2 days later</span>
        </div>
        <p className="mt-2 text-sm font-semibold">&ldquo;Thanks Riya, are you free for a call on Tuesday?&rdquo;</p>
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">A suggested reply is ready to copy.</p>
      </div>
    </div>
  )
}

function PricingCards({ freeTailorings }: { freeTailorings: number | null }) {
  const free = freeTailorings ?? 3
  const cards: Array<{ name: string; price: string; per?: string; points: string[]; highlight?: boolean; note?: string; comingSoon?: boolean }> = [
    {
      name: 'Free',
      price: '₹0',
      points: [
        `${free} tailorings, once for every account`,
        'A cover letter for each one',
        `${EMAIL_DRAFTS_PER_MONTH.free} AI-written recruiter emails a month`,
        'A fresh list of recruiters every week',
        `${IMPORTS_PER_MONTH.free} resume imports a month`,
        'Keyword finder and match check',
        'History and PDF downloads',
      ],
    },
    {
      name: PRO_PLAN.label,
      price: formatPrice(PRO_PLAN.pricePaise),
      per: '/month',
      highlight: true,
      points: [
        `${PRO_PLAN.runsPerCycle} tailorings every month`,
        'A cover letter for each one',
        `${EMAIL_DRAFTS_PER_MONTH.paid} AI-written recruiter emails a month`,
        'A fresh list of recruiters every week',
        `${IMPORTS_PER_MONTH.paid} resume imports a month`,
        'Tailoring and emails, each on their own',
        'Cancel any time',
      ],
    },
    {
      name: PREMIUM_PLAN.label,
      price: formatPrice(PREMIUM_PLAN.pricePaise),
      per: '/month',
      note: 'The whole application in one run',
      comingSoon: true,
      points: [
        `${PREMIUM_PLAN.appliesPerCycle} complete applications a month`,
        'Chills reads the posting you point it at',
        'Resume and recruiter email from that one reading',
        `Everything in ${PRO_PLAN.label}, including ${PREMIUM_PLAN.runsPerCycle} tailorings`,
        'Every email waits for you to send it',
        'Cancel any time',
      ],
    },
    {
      name: 'Credit packs',
      price: formatPrice(CREDIT_PACKS[0].pricePaise),
      per: ` / ${CREDIT_PACKS[0].runs} tailorings`,
      points: [
        ...CREDIT_PACKS.map((pack) => `${pack.runs} tailorings for ${formatPrice(pack.pricePaise)}`),
        'A one-time payment',
        'Credits never expire',
      ],
    },
  ]

  return (
    <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4 items-stretch">
      {cards.map((card) => (
        <div
          key={card.name}
          className={`nb-card p-7 flex flex-col ${card.highlight ? 'md:-translate-y-2 border-[3px] shadow-[6px_6px_0_0_#0a0a0a]' : ''}`}
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-xl font-extrabold">{card.name}</h3>
            {card.comingSoon && <span className="nb-chip bg-[var(--color-yellow)] text-[#0a0a0a] whitespace-nowrap">Coming soon</span>}
          </div>
          {card.note && <p className="mt-1 text-xs font-bold uppercase tracking-wide text-[var(--color-text-faint)]">{card.note}</p>}
          <p className={`mt-3 ${card.comingSoon ? 'text-[var(--color-text-faint)]' : ''}`}>
            <span className="text-4xl font-black">{card.price}</span>
            {card.per && <span className="text-[var(--color-text-muted)]">{card.per}</span>}
          </p>
          {card.comingSoon && <p className="mt-2 text-sm font-semibold text-[var(--color-text-muted)]">Not on sale yet — everything below is what it will do.</p>}
          <ul className="mt-6 space-y-3 flex-1">
            {card.points.map((point) => (
              <li key={point} className="flex items-start gap-2.5">
                <CheckCircle size={20} className="text-[var(--color-success)] shrink-0 mt-0.5" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
