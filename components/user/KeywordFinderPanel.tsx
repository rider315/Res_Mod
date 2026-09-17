'use client'
import { useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle, Close, Search, Target } from '@/components/brand/Icons'
import { ApiError, readApiError } from '@/components/user/billing-client'
import {
  backLinkClass,
  cardClass,
  errorBox,
  inputClass,
  primaryButton,
  ResumeSummary,
  scoreFill,
  secondaryButton,
} from '@/components/user/shared'
import { getProvider } from '@/lib/providers'
import { AISettings } from '@/lib/settings-storage'
import type { BillingStatus } from '@/lib/billing/types'
import { BILLING_CODES } from '@/lib/billing/types'
import { DAILY_AI_REQUESTS } from '@/lib/billing/quota'
import type { KeywordFinderResult, ScoredKeyword } from '@/lib/tailor/keyword-finder'
import type { KeywordCoverage, KeywordStatus } from '@/lib/tailor/keywords'

/**
 * The keyword finder: paste a job description, see the keywords it screens
 * for, scored, and check a saved resume against them before tailoring. Finding
 * keywords costs no tailoring; checking a resume makes no AI request at all.
 */

interface KeywordFinderPanelProps {
  isOwner: boolean
  settings: AISettings
  /** undefined while loading; null when it couldn't be loaded, and always for the owner. */
  billing: BillingStatus | null | undefined
  resumes: ResumeSummary[]
  onTailor: (resumeId: string, title: string, jobDescription: string) => void
  onImport: () => void
  onOpenBilling: () => void
  onBack: () => void
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

const STATUS: Record<KeywordStatus, { label: string; className: string }> = {
  covered: { label: 'In your resume', className: 'bg-[var(--color-accent)]' },
  skills_only: { label: 'Only in skills', className: 'bg-[var(--color-yellow)]' },
  missing: { label: 'Missing', className: 'bg-[var(--color-error-highlight)]' },
}

export default function KeywordFinderPanel({
  isOwner,
  settings,
  billing,
  resumes,
  onTailor,
  onImport,
  onBack,
}: KeywordFinderPanelProps) {
  const [jobDescription, setJobDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<KeywordFinderResult | null>(null)
  const [resumeId, setResumeId] = useState(resumes[0]?.id ?? '')
  const [checking, setChecking] = useState(false)
  const [match, setMatch] = useState<{ resumeId: string; coverage: KeywordCoverage } | null>(null)

  const length = jobDescription.trim().length
  const provider = getProvider(settings.provider)
  const aiOff = !isOwner && Boolean(billing) && !billing?.platformAi
  const resume = resumes.find((entry) => entry.id === resumeId)

  async function find() {
    setBusy(true)
    setError(null)
    setResult(null)
    setMatch(null)
    try {
      if (isOwner && provider.clientSide) {
        const [{ generatePuterResponse }, { extractJdKeywords }, { scoreKeywords }] = await Promise.all([
          import('@/lib/puter'),
          import('@/lib/tailor/keywords'),
          import('@/lib/tailor/keyword-finder'),
        ])
        const model = settings.models[settings.provider]
        const found = await extractJdKeywords({
          jobDescription,
          generate: ({ systemInstruction, prompt, temperature }) =>
            generatePuterResponse({ systemInstruction, prompt, temperature, model }),
        })
        setResult({ jobTitle: found.jobTitle, company: found.company, keywords: scoreKeywords(jobDescription, found.keywords) })
        return
      }
      const ai = isOwner
        ? { provider: settings.provider, apiKey: settings.apiKeys[settings.provider], model: settings.models[settings.provider] }
        : {}
      const res = await fetch('/api/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobDescription, ...ai }),
      })
      if (!res.ok) throw await readApiError(res, 'The keywords could not be found.')
      setResult(await res.json())
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === BILLING_CODES.dailyLimit
          ? `${errorText(err)} Checking a resume against keywords you already found still works.`
          : errorText(err)
      )
    } finally {
      setBusy(false)
    }
  }

  async function check(id: string) {
    if (!result || !id) return
    setChecking(true)
    setError(null)
    try {
      const [{ renderCheckedResume }, { ResumeDocSchema }, { keywordCoverage }] = await Promise.all([
        import('@/lib/import/render'),
        import('@/lib/resume-doc'),
        import('@/lib/tailor/keywords'),
      ])
      const res = await fetch(`/api/resumes/${id}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'That resume could not be loaded.')
      const doc = ResumeDocSchema.safeParse(data.doc)
      if (!doc.success) throw new Error('That resume could not be read. Open it in the editor and save it again.')
      const rendered = renderCheckedResume(doc.data)
      if (!rendered.ok) throw new Error(rendered.problems.join(' '))
      setMatch({ resumeId: id, coverage: keywordCoverage(rendered.parsed.resume, result.keywords) })
    } catch (err) {
      setError(errorText(err))
    } finally {
      setChecking(false)
    }
  }

  const statusOf = (keyword: ScoredKeyword): KeywordStatus | null =>
    match?.coverage.statuses.find((entry) => entry.keyword.term === keyword.term)?.status ?? null
  const required = result?.keywords.filter((k) => k.required) ?? []
  const niceToHave = result?.keywords.filter((k) => !k.required) ?? []

  return (
    <div className="space-y-8 anim-page-enter">
      <div>
        <button onClick={onBack} className={backLinkClass}>
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="mt-3 text-4xl sm:text-5xl font-black tracking-tight">
          <span className="nb-highlight">Keyword finder</span>
        </h1>
        <p className="mt-5 text-lg text-[var(--color-text-muted)] max-w-3xl">
          Paste a job description to see the keywords an applicant tracking system screens it for, scored from 1 to 10 and split
          into must-haves and nice-to-haves. Then check one of your resumes against them.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr] items-start">
        <section className={`${cardClass} p-6 space-y-4`}>
          <label className="block">
            <span className="flex items-center justify-between gap-2 text-sm font-bold mb-1.5">
              Job description
              <span className="text-xs font-semibold text-[var(--color-text-faint)] tabular-nums">
                {jobDescription.length.toLocaleString()} / 20,000
              </span>
            </span>
            <textarea
              rows={14}
              value={jobDescription}
              maxLength={20_000}
              onChange={(e) => setJobDescription(e.target.value)}
              disabled={busy}
              placeholder="Paste the full job post…"
              className={`${inputClass} resize-y leading-relaxed`}
            />
          </label>
          {error && <div className={errorBox}>{error}</div>}
          {aiOff && <p className="text-sm font-semibold text-[var(--color-warning)]">The AI isn&apos;t available right now. Please check back soon.</p>}
          <button onClick={find} disabled={busy || length < 80 || aiOff} className={`w-full ${primaryButton} py-3 text-base`}>
            <Search size={18} /> {busy ? 'Finding keywords…' : 'Find keywords'}
          </button>
          <p className="text-xs text-[var(--color-text-muted)]">
            {isOwner
              ? 'Runs on your own AI settings.'
              : `Free: it uses no tailoring, just one of your ${DAILY_AI_REQUESTS} AI requests a day. The job description isn't saved.`}
          </p>
        </section>

        <section className="space-y-6">
          {!result ? (
            <div className={`${cardClass} p-6 bg-[var(--color-sky-soft)]`}>
              <h2 className="text-xl font-black">What you get</h2>
              <ul className="mt-4 space-y-3">
                {[
                  'Must-have keywords to place first, in your summary and top bullets.',
                  'Nice-to-have keywords that strengthen the match.',
                  'A score for each, and where on your resume it belongs.',
                  'A match check against any of your saved resumes.',
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2.5">
                    <CheckCircle size={20} className="text-[var(--color-success)] shrink-0 mt-0.5" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <div className={`${cardClass} p-5 space-y-4`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-[var(--color-text-faint)]">The job</p>
                    <p className="text-xl font-black">
                      {result.jobTitle || 'Untitled role'}
                      {result.company ? <span className="text-[var(--color-text-muted)] font-bold"> · {result.company}</span> : null}
                    </p>
                  </div>
                  <span className="nb-chip bg-[var(--color-yellow)]">
                    {required.length} must-have · {niceToHave.length} nice-to-have
                  </span>
                </div>

                {resumes.length === 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t-[1.6px] border-[var(--color-ink)] pt-4">
                    <p className="text-sm text-[var(--color-text-muted)]">Import a resume to see how well it matches.</p>
                    <button onClick={onImport} className={secondaryButton}>
                      Import a resume
                    </button>
                  </div>
                ) : (
                  <div className="border-t-[1.6px] border-[var(--color-ink)] pt-4 space-y-3">
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="flex-1 min-w-[12rem]">
                        <span className="block text-sm font-bold mb-1.5">Check a resume against these keywords</span>
                        <select
                          value={resumeId}
                          onChange={(e) => {
                            setResumeId(e.target.value)
                            setMatch(null)
                          }}
                          className={inputClass}
                        >
                          {resumes.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button onClick={() => check(resumeId)} disabled={checking || !resumeId} className={secondaryButton}>
                        <Target size={16} /> {checking ? 'Checking…' : 'Check match'}
                      </button>
                    </div>
                    {match && resume && match.resumeId === resumeId && (
                      <MatchSummary
                        coverage={match.coverage}
                        onTailor={() => onTailor(resume.id, resume.title, jobDescription)}
                      />
                    )}
                  </div>
                )}
              </div>

              <KeywordGroup title="Must-have" keywords={required} statusOf={statusOf} />
              {niceToHave.length > 0 && <KeywordGroup title="Nice to have" keywords={niceToHave} statusOf={statusOf} />}

              <div className={`${cardClass} p-5 bg-[var(--color-yellow-soft)]`}>
                <p className="font-black">What to do next</p>
                <p className="mt-2 text-sm leading-relaxed">
                  Put the must-haves in your summary and your strongest bullets, using the job&apos;s own wording, and back each one with
                  something you actually did. Add a few nice-to-haves to your skills. Or let ResMod do it: tailor a resume to this job and
                  every must-have ends up in it.
                </p>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function MatchSummary({ coverage, onTailor }: { coverage: KeywordCoverage; onTailor: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-[10px] border-[1.6px] border-[var(--color-ink)] p-4 bg-[var(--color-surface-offset)]">
      <div className="flex items-center gap-4">
        <span className={`nb-badge w-20 h-20 text-2xl ${scoreFill(coverage.score)}`}>{coverage.score}%</span>
        <div>
          <p className="font-black">Keyword match</p>
          <p className="text-sm text-[var(--color-text-muted)]">
            {coverage.requiredPresent} of {coverage.requiredTotal} must-haves · {coverage.present} of {coverage.total} keywords in all
          </p>
        </div>
      </div>
      <button onClick={onTailor} className={primaryButton}>
        Tailor this resume to the job <ArrowRight size={16} />
      </button>
    </div>
  )
}

function KeywordGroup({
  title,
  keywords,
  statusOf,
}: {
  title: string
  keywords: ScoredKeyword[]
  statusOf: (keyword: ScoredKeyword) => KeywordStatus | null
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-black">{title}</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {keywords.map((keyword) => {
          const status = statusOf(keyword)
          const scoreTone =
            keyword.score >= 8 ? 'bg-[var(--color-accent)]' : keyword.score >= 5 ? 'bg-[var(--color-yellow)]' : 'bg-white'
          return (
            <li key={keyword.term} className="rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-surface)] p-3.5">
              <div className="flex items-start justify-between gap-2">
                <p className="font-extrabold leading-tight">{keyword.term}</p>
                <span className={`nb-badge shrink-0 px-2 py-0.5 text-xs ${scoreTone}`} title="How much the job leans on it">
                  {keyword.score}/10
                </span>
              </div>
              <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">{keyword.where}</p>
              {status && (
                <span className={`mt-2 nb-chip text-[#0a0a0a] ${STATUS[status].className}`}>
                  {status === 'missing' ? <Close size={12} /> : <CheckCircle size={12} />} {STATUS[status].label}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
