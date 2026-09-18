'use client'
import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle, Mail, Sparkles } from '@/components/brand/Icons'
import Working from '@/components/user/Working'
import { UsageLine } from '@/components/user/UsageMeter'
import { readRunStream } from '@/components/user/run-stream'
import { ApiError } from '@/components/user/billing-client'
import { AiUsage, emptyUsage } from '@/lib/ai-usage'
import { APPLY_STAGES, ApplyStage } from '@/lib/apply/run'
import { BILLING_CODES } from '@/lib/billing/types'
import { COVER_LETTER_TONES, TONE_LABELS } from '@/lib/cover-letter'
import { LEVELS, TAILOR_LEVELS, TailorLevel } from '@/lib/tailor/levels'
import type { OutreachContext } from '@/components/user/outreach/outreach-client'
import type { CompanyNote, RecruiterSummary } from '@/lib/outreach/types'
import type { AISettings } from '@/lib/settings-storage'
import {
  backLinkClass,
  cardClass,
  errorBox,
  inputClass,
  primaryButton,
  ResumeSummary,
  secondaryButton,
} from '@/components/user/shared'

/**
 * The Premium run: one job, start to finish.
 *
 * The user gives the resume, the recruiter and the posting, and gets back a
 * tailored copy in their history and a recruiter email waiting as a draft. The
 * email is never sent from here — it opens in Outreach, where it is read,
 * edited and sent like any other.
 *
 * This screen deliberately asks for the posting's link rather than its text:
 * the run reads the employer's own page, so the resume and the email are both
 * built from what the company actually wrote, not from a paste that has lost
 * half of it. Pasting still works when a board blocks the read.
 */

interface ApplyPanelProps {
  resumes: ResumeSummary[] | null
  settings: AISettings
  isOwner: boolean
  /** Open this finished application in Outreach, where its draft is waiting. */
  onOpenOutreach: (context: OutreachContext) => void
  /** Shown when the plan, or this cycle, has no complete applications left. */
  onOpenBilling: () => void
  onImportResume: () => void
  onBack: () => void
}

interface ApplyOutcome {
  role: { title: string; company: string; location: string }
  posting: { url: string; structured: boolean }
  tailoringId: string
  appliedCount: number
  unevidencedSkills: string[]
  email: { id: string; subject: string }
  company: CompanyNote | null
  usage: AiUsage
}

const STEPS = APPLY_STAGES.map((entry) => entry.label)
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

export default function ApplyPanel({
  resumes,
  settings,
  isOwner,
  onOpenOutreach,
  onOpenBilling,
  onImportResume,
  onBack,
}: ApplyPanelProps) {
  const [recruiters, setRecruiters] = useState<RecruiterSummary[] | null>(null)
  const [resumeId, setResumeId] = useState('')
  const [recruiterId, setRecruiterId] = useState('')
  const [jobUrl, setJobUrl] = useState('')
  const [jobText, setJobText] = useState('')
  const [pasting, setPasting] = useState(false)
  const [level, setLevel] = useState<TailorLevel>('hard')
  const [tone, setTone] = useState<(typeof COVER_LETTER_TONES)[number]>('professional')
  const [notes, setNotes] = useState('')

  const [running, setRunning] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [stage, setStage] = useState<ApplyStage>('posting')
  const [label, setLabel] = useState(STEPS[0])
  const [usage, setUsage] = useState<AiUsage>(emptyUsage)
  const [outcome, setOutcome] = useState<ApplyOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The failure was about the plan, not the run, so the Plans page is the way out. */
  const [needsPlan, setNeedsPlan] = useState(false)

  useEffect(() => {
    fetch('/api/outreach/recruiters', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setRecruiters(data?.recruiters ?? []))
      .catch(() => setRecruiters([]))
  }, [])

  useEffect(() => {
    if (!resumeId && resumes && resumes.length > 0) setResumeId(resumes[0].id)
  }, [resumes, resumeId])
  useEffect(() => {
    if (!recruiterId && recruiters && recruiters.length > 0) setRecruiterId(recruiters[0].id)
  }, [recruiters, recruiterId])

  const ready = Boolean(resumeId && recruiterId && (pasting ? jobText.trim().length >= 200 : jobUrl.trim()))
  const activeStep = Math.max(0, APPLY_STAGES.findIndex((entry) => entry.stage === stage))

  async function run() {
    if (!ready || running) return
    setRunning(true)
    setError(null)
    setNeedsPlan(false)
    setOutcome(null)
    setUsage(emptyUsage())
    setStage('posting')
    setLabel(STEPS[0])
    setStartedAt(Date.now())
    try {
      const res = await fetch('/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resumeId,
          recruiterId,
          jobUrl: pasting ? '' : jobUrl.trim(),
          jobText: pasting ? jobText.trim() : '',
          level,
          tone,
          notes,
          // The owner runs on their own AI settings; everyone else on Chills AI.
          ...(isOwner
            ? { provider: settings.provider, apiKey: settings.apiKeys[settings.provider], model: settings.models[settings.provider] }
            : {}),
        }),
      })
      const result = await readRunStream<ApplyOutcome>({
        res,
        whatFailed: 'That application could not be finished.',
        onUpdate: (update) => {
          setStage(update.stage as ApplyStage)
          setLabel(update.label)
          setUsage(update.usage)
        },
        readResult: (event) => event as unknown as ApplyOutcome,
      })
      setOutcome(result)
      setUsage(result.usage)
    } catch (err) {
      if (err instanceof ApiError && (err.code === BILLING_CODES.applyTier || err.code === BILLING_CODES.applyLimit)) {
        setNeedsPlan(true)
      }
      setError(errorText(err))
    } finally {
      setRunning(false)
      setStartedAt(null)
    }
  }

  const noResumes = resumes !== null && resumes.length === 0
  const noRecruiters = recruiters !== null && recruiters.length === 0

  return (
    <div className="space-y-7 anim-page-enter">
      <div>
        <button onClick={onBack} className={backLinkClass}>
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="mt-3 text-4xl sm:text-5xl font-black tracking-tight">
          One <span className="nb-highlight">complete application</span>
        </h1>
        <p className="mt-4 text-lg text-[var(--color-text-muted)] max-w-3xl">
          Give Chills the job and the person hiring for it. It reads the posting once, tailors your resume to it, and writes the
          email from that same reading — so the two say the same thing. The email waits as a draft for you to read and send.
        </p>
      </div>

      {error && (
        <div className={errorBox}>
          {error}
          {needsPlan && (
            <button onClick={onOpenBilling} className="ml-2 underline font-bold">
              See plans
            </button>
          )}
        </div>
      )}

      {outcome ? (
        <Finished outcome={outcome} onOpenOutreach={onOpenOutreach} onAgain={() => setOutcome(null)} />
      ) : running ? (
        <>
          <Working
            kind={stage === 'email' ? 'email' : stage === 'role' ? 'keywords' : stage === 'posting' ? 'import' : 'letter'}
            steps={STEPS}
            active={activeStep}
            note={label}
            startedAt={startedAt}
          />
          <UsageLine usage={usage} />
        </>
      ) : (
        <section className={`${cardClass} p-6 space-y-5`}>
          <Field label="Your resume">
            {noResumes ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                You haven&apos;t imported a resume yet.{' '}
                <button onClick={onImportResume} className="underline font-bold">
                  Import one
                </button>
                .
              </p>
            ) : (
              <select value={resumeId} onChange={(e) => setResumeId(e.target.value)} className={inputClass}>
                {(resumes ?? []).map((resume) => (
                  <option key={resume.id} value={resume.id}>
                    {resume.title}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Who is hiring">
            {noRecruiters ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                Add a recruiter in Outreach first, or take one from the week&apos;s list.
              </p>
            ) : (
              <select value={recruiterId} onChange={(e) => setRecruiterId(e.target.value)} className={inputClass}>
                {(recruiters ?? []).map((recruiter) => (
                  <option key={recruiter.id} value={recruiter.id}>
                    {[recruiter.name || recruiter.email, recruiter.company].filter(Boolean).join(' · ')}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field
            label={pasting ? 'The job posting' : 'Link to the job posting'}
            aside={
              <button onClick={() => setPasting(!pasting)} className="text-xs underline font-bold text-[var(--color-text-muted)]">
                {pasting ? 'Use a link instead' : 'Paste it instead'}
              </button>
            }
          >
            {pasting ? (
              <textarea
                rows={7}
                value={jobText}
                onChange={(e) => setJobText(e.target.value)}
                placeholder="Paste the whole posting, not just the title."
                className={`${inputClass} resize-y`}
              />
            ) : (
              <input
                value={jobUrl}
                onChange={(e) => setJobUrl(e.target.value)}
                placeholder="https://careers.example.com/jobs/platform-engineer"
                className={inputClass}
              />
            )}
            <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
              {pasting
                ? 'Chills uses exactly this text for both the resume and the email.'
                : 'Chills opens the page itself and uses the employer’s own words. If a board blocks it, paste the posting instead.'}
            </p>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="How far to tailor">
              <select value={level} onChange={(e) => setLevel(e.target.value as TailorLevel)} className={inputClass}>
                {TAILOR_LEVELS.map((entry) => (
                  <option key={entry} value={entry}>
                    {LEVELS[entry].label}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">{LEVELS[level].blurb}</p>
            </Field>
            <Field label="How the email should read">
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value as (typeof COVER_LETTER_TONES)[number])}
                className={inputClass}
              >
                {COVER_LETTER_TONES.map((entry) => (
                  <option key={entry} value={entry}>
                    {TONE_LABELS[entry].label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Anything to mention in this email (optional)">
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="A referral, a mutual contact, when you can start."
              className={`${inputClass} resize-y`}
            />
          </Field>

          <button onClick={run} disabled={!ready} className={`w-full ${primaryButton} py-3.5 text-base`}>
            <Sparkles size={18} /> Run the whole application
          </button>
          <p className="text-xs text-[var(--color-text-muted)]">
            This spends one complete application and one tailoring. Nothing is emailed: the draft waits in Outreach.
          </p>
        </section>
      )}
    </div>
  )
}

function Field({ label, aside, children }: { label: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-sm font-bold">{label}</span>
        {aside}
      </span>
      {children}
    </label>
  )
}

function Finished({
  outcome,
  onOpenOutreach,
  onAgain,
}: {
  outcome: ApplyOutcome
  onOpenOutreach: (context: OutreachContext) => void
  onAgain: () => void
}) {
  const role = [outcome.role.title, outcome.role.company && `at ${outcome.role.company}`].filter(Boolean).join(' ')
  return (
    <div className="space-y-5">
      <section className={`${cardClass} p-6 space-y-4 bg-[var(--color-accent-soft)]`}>
        <h2 className="text-2xl font-black flex items-center gap-2.5">
          <CheckCircle size={24} className="text-[var(--color-success)]" /> {role || 'That application'} is ready
        </h2>
        <ul className="space-y-2 text-sm">
          <li className="flex items-start gap-2.5">
            <CheckCircle size={18} className="text-[var(--color-success)] shrink-0 mt-0.5" />
            <span>
              {outcome.appliedCount} {outcome.appliedCount === 1 ? 'line' : 'lines'} of your resume rewritten for this posting, and
              the copy saved in your history.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <Mail size={18} className="text-[var(--color-text)] shrink-0 mt-0.5" />
            <span>
              The email is written from that same reading and waiting as a draft: <strong>{outcome.email.subject}</strong>
            </span>
          </li>
          {outcome.company?.status === 'found' && (
            <li className="flex items-start gap-2.5">
              <CheckCircle size={18} className="text-[var(--color-success)] shrink-0 mt-0.5" />
              <span>It can mention what {outcome.company.site} says the company does.</span>
            </li>
          )}
          {outcome.posting.structured && (
            <li className="flex items-start gap-2.5">
              <CheckCircle size={18} className="text-[var(--color-success)] shrink-0 mt-0.5" />
              <span>Read from the employer&apos;s own posting data, not the page furniture around it.</span>
            </li>
          )}
        </ul>
        {outcome.unevidencedSkills.length > 0 && (
          <p className="text-xs text-[var(--color-warning)]">
            Nothing in your experience backs {outcome.unevidencedSkills.join(', ')}. They are listed in your skills only — be ready
            to talk about them, or take them out before you send.
          </p>
        )}
        <div className="flex flex-wrap gap-3 pt-1">
          <button
            onClick={() =>
              onOpenOutreach({ tailoringId: outcome.tailoringId, jobTitle: outcome.role.title, company: outcome.role.company })
            }
            className={primaryButton}
          >
            Read the email <ArrowRight size={16} />
          </button>
          <button onClick={onAgain} className={secondaryButton}>
            Run another
          </button>
        </div>
      </section>
      <UsageLine usage={outcome.usage} />
    </div>
  )
}
