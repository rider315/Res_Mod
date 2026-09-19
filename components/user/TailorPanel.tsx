'use client'
import { useState } from 'react'
import DiffViewer from '@/components/DiffViewer'
import LatexPreview from '@/components/LatexPreview'
import { ArrowLeft, ArrowRight, CheckCircle, Download, Mail, Send, Sparkles } from '@/components/brand/Icons'
import type { OutreachContext } from '@/components/user/outreach/outreach-client'
import AiAllowance from '@/components/user/AiAllowance'
import CoverLetterPanel from '@/components/user/CoverLetterPanel'
import KeywordCoverage from '@/components/user/KeywordCoverage'
import UsageMeter, { UsageLine } from '@/components/user/UsageMeter'
import { readTailorStream, RunUpdate } from '@/components/user/tailor-stream'
import { reportUnlessOwner } from '@/lib/analytics'
import { ApiError } from '@/components/user/billing-client'
import { addCall, AiUsage, emptyUsage } from '@/lib/ai-usage'
import { GenerateFn, RunStage } from '@/lib/run-optimization'
import { AISettings } from '@/lib/settings-storage'
import { getProvider } from '@/lib/providers'
import { BILLING_CODES, BillingStatus } from '@/lib/billing/types'
import { LEVELS, TAILOR_LEVELS, TAILOR_TONES, TailorLevel, TailorTone, TONES } from '@/lib/tailor/levels'
import { OptimizationResult, ParsedResume, ResumeChange } from '@/types/resume'
import {
  backLinkClass,
  cardClass,
  downloadBlob,
  downloadResumePdf,
  errorBox,
  inputClass,
  openInOverleaf,
  primaryButton,
  resumeFileBase,
  secondaryButton,
  warningBox,
} from '@/components/user/shared'

/**
 * Tailoring one saved resume to a job description: pick a level and a tone,
 * review each change against a live keyword score (editing any you want to),
 * then download the tailored copy and write a matching cover letter. The saved
 * resume itself never changes.
 */

type Step = 'form' | 'running' | 'review' | 'applying' | 'done'

interface Applied {
  latex: string
  appliedCount: number
  requestedCount: number
  unmatched: string[]
  overlapping: string[]
  rejected: Array<{ original: string; reason: string }>
  /** The copy's id in the history; null when it couldn't be saved there. */
  tailoringId: string | null
}

interface TailorPanelProps {
  resumeId: string
  resumeTitle: string
  /** A job description already pasted on the dashboard. */
  initialJobDescription?: string
  /** The owner runs on their own AI settings; everyone else on Chills AI. */
  isOwner: boolean
  settings: AISettings
  /** undefined while loading; null when it couldn't be loaded, and always for the owner. */
  billing: BillingStatus | null | undefined
  onOpenSettings: () => void
  onOpenBilling: () => void
  onBillingChanged: () => void
  onQuotaExhausted: () => void
  onOpenHistory: () => void
  /** Opens Outreach for the tailored copy's job. */
  onEmailRecruiters?: (context: OutreachContext) => void
  onBack: () => void
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

const STEPS = ['Job and level', 'Tailoring', 'Review', 'Download'] as const

function Stepper({ step }: { step: Step }) {
  const at = step === 'form' ? 0 : step === 'running' ? 1 : step === 'review' || step === 'applying' ? 2 : 3
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-3" aria-label="Progress">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <span
            className={`nb-badge w-8 h-8 text-sm ${
              i < at
                ? 'bg-[var(--color-accent)]'
                : i === at
                  ? 'bg-[var(--color-yellow)]'
                  : 'bg-[var(--color-surface)] text-[var(--color-text-faint)] border-[var(--color-border-soft)] shadow-none'
            }`}
            aria-current={i === at ? 'step' : undefined}
          >
            {i < at ? <CheckCircle size={16} /> : i + 1}
          </span>
          {/* On phones only the current step is named, so the steps fit on one line. */}
          <span className={`text-sm font-bold ${i === at ? '' : 'sr-only sm:not-sr-only text-[var(--color-text-muted)]'}`}>{label}</span>
          {i < STEPS.length - 1 && <span className="hidden sm:block w-8 border-t-2 border-dotted border-[var(--color-text-faint)]" aria-hidden />}
        </li>
      ))}
    </ol>
  )
}

export default function TailorPanel({
  resumeId,
  resumeTitle,
  initialJobDescription,
  isOwner,
  settings,
  billing,
  onOpenSettings,
  onOpenBilling,
  onBillingChanged,
  onQuotaExhausted,
  onOpenHistory,
  onEmailRecruiters,
  onBack,
}: TailorPanelProps) {
  const [step, setStep] = useState<Step>('form')
  const [jobDescription, setJobDescription] = useState(initialJobDescription ?? '')
  const [level, setLevel] = useState<TailorLevel>('hard')
  const [tone, setTone] = useState<TailorTone>('balanced')
  const [instructions, setInstructions] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [resume, setResume] = useState<ParsedResume | null>(null)
  const [result, setResult] = useState<OptimizationResult | null>(null)
  const [changes, setChanges] = useState<ResumeChange[]>([])
  const [applied, setApplied] = useState<Applied | null>(null)
  const [compiling, setCompiling] = useState(false)
  // What the run is spending, updated as each model call reports back.
  const [usage, setUsage] = useState<AiUsage>(emptyUsage)
  const [progress, setProgress] = useState<{ stage: RunStage; label: string }>({ stage: 'jd', label: 'Starting' })
  const [startedAt, setStartedAt] = useState<number | undefined>(undefined)
  const [tookMs, setTookMs] = useState<number | undefined>(undefined)

  const provider = getProvider(settings.provider)
  const model = settings.models[settings.provider]
  const checkingRuns = !isOwner && billing === undefined
  const needsKey = isOwner && provider.needsKey && !settings.apiKeys[settings.provider]?.trim()
  const aiOff = !isOwner && Boolean(billing) && !billing?.platformAi
  // Nothing left to spend: the button explains where to get more instead of starting a run.
  const outOfTailorings = !isOwner && Boolean(billing?.platformAi) && billing?.runs.left === 0
  const jdReady = jobDescription.trim().length >= 80
  const busy = step === 'running' || step === 'applying'
  const approvedCount = changes.filter((c) => c.approved === true).length
  const company = result?.companyName && result.companyName !== 'Company' ? result.companyName : ''
  const exportName = `${resumeTitle} ${company}`.trim()
  const approvalList = changes.map(({ original, proposed, approved }) => ({ original, proposed, approved }))
  const meterSource = !isOwner ? 'platform' : provider.clientSide ? 'puter' : 'own'

  /** The owner's Puter setting: Puter only runs in the browser, so the whole run happens here. */
  async function tailorInBrowser(): Promise<{ result: OptimizationResult; resume: ParsedResume }> {
    const [{ generatePuterResponse }, { runOptimization }, { extractJdKeywords }, { standardProfile }, { renderCheckedResume }, { ResumeDocSchema }] =
      await Promise.all([
        import('@/lib/puter'),
        import('@/lib/run-optimization'),
        import('@/lib/tailor/keywords'),
        import('@/lib/profiles/standard'),
        import('@/lib/import/render'),
        import('@/lib/resume-doc'),
      ])

    const res = await fetch(`/api/resumes/${resumeId}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'That resume could not be loaded.')
    const doc = ResumeDocSchema.safeParse(data.doc)
    if (!doc.success) throw new Error('That resume could not be read. Open it in the editor and save it again.')
    const rendered = renderCheckedResume(doc.data)
    if (!rendered.ok) throw new Error(rendered.problems.join(' '))

    const generate: GenerateFn = ({ systemInstruction, prompt, temperature, cachePrefix }) =>
      generatePuterResponse({
        systemInstruction,
        prompt,
        temperature,
        cachePrefix,
        model,
        onUsage: (call) => setUsage((total) => addCall(total, call)),
      })
    const keywords = await extractJdKeywords({ jobDescription, generate })
    const tailored = await runOptimization({
      mode: 'optimize',
      level,
      tone,
      keywords,
      profile: standardProfile(level),
      resume: rendered.parsed.resume,
      jobDescription,
      hardInstructions: instructions,
      softInstructions: '',
      provider: settings.provider,
      model,
      generate,
      onProgress: setProgress,
    })
    return { result: tailored, resume: rendered.parsed.resume }
  }

  async function tailorOnServer(): Promise<{ result: OptimizationResult; resume: ParsedResume }> {
    // Regular accounts always run on Chills AI, so only the owner sends AI settings.
    const ai = isOwner ? { provider: settings.provider, apiKey: settings.apiKeys[settings.provider], model } : {}
    const res = await fetch(`/api/resumes/${resumeId}/tailor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobDescription, level, tone, instructions, ...ai }),
    })
    // The run reports each pass and what it has spent as it goes.
    const onUpdate = (update: RunUpdate) => {
      setProgress({ stage: update.stage, label: update.label })
      setUsage(update.usage)
    }
    const outcome = await readTailorStream(res, onUpdate)
    return { result: outcome.result, resume: outcome.resume }
  }

  async function tailor() {
    if (outOfTailorings) {
      onQuotaExhausted()
      return
    }
    setError(null)
    setStep('running')
    setUsage(emptyUsage())
    setProgress({ stage: 'jd', label: 'Reading the job description' })
    const began = Date.now()
    setStartedAt(began)
    setTookMs(undefined)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    try {
      const outcome = isOwner && provider.clientSide ? await tailorInBrowser() : await tailorOnServer()
      setResume(outcome.resume)
      setResult(outcome.result)
      setChanges(outcome.result.changes.map((change) => ({ ...change, approved: null })))
      setTookMs(Date.now() - began)
      setStep('review')
      // Set this conversion to count "One" per click in Google Ads: someone who
      // tailors three resumes had one click, not three.
      reportUnlessOwner('tailoring', isOwner)
    } catch (err) {
      setError(errorText(err))
      setStep('form')
      if (err instanceof ApiError && err.code === BILLING_CODES.quotaExhausted) onQuotaExhausted()
    } finally {
      if (!isOwner) onBillingChanged()
    }
  }

  async function apply() {
    setError(null)
    setStep('applying')
    try {
      const res = await fetch(`/api/resumes/${resumeId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changes: approvalList,
          // Kept with the tailored copy in the history.
          history: {
            level,
            jobDescription,
            jobTitle: result?.keywordReport?.jobTitle ?? '',
            company,
            keywords: result?.keywordReport?.keywords,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'The changes could not be applied.')
      setApplied(data)
      setStep('done')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(errorText(err))
      setStep('review')
    }
  }

  async function downloadPdf() {
    setCompiling(true)
    setError(null)
    try {
      await downloadResumePdf(resumeId, exportName, approvalList)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setCompiling(false)
    }
  }

  function startOver() {
    setStep('form')
    setResult(null)
    setResume(null)
    setChanges([])
    setApplied(null)
    setJobDescription('')
    setError(null)
    window.scrollTo({ top: 0 })
  }

  const setApproval = (id: string, approved: boolean) =>
    setChanges((list) => list.map((change) => (change.id === id ? { ...change, approved } : change)))
  const setAll = (approved: boolean) => setChanges((list) => list.map((change) => ({ ...change, approved })))
  // Editing a suggestion keeps it: that is almost always why it was edited.
  const editChange = (id: string, proposed: string) =>
    setChanges((list) => list.map((change) => (change.id === id ? { ...change, proposed, approved: true, edited: true } : change)))

  const header = (title: React.ReactNode, subtitle: React.ReactNode, back: React.ReactNode) => (
    <div className="space-y-5">
      {back}
      <Stepper step={step} />
      <div>
        <h1 className="text-4xl sm:text-5xl font-black tracking-tight">{title}</h1>
        <p className="mt-3 text-[var(--color-text-muted)] max-w-3xl">{subtitle}</p>
      </div>
    </div>
  )

  const backToList = (
    <button onClick={onBack} disabled={busy} className={backLinkClass}>
      <ArrowLeft size={16} /> Your resumes
    </button>
  )

  if (step === 'form' || step === 'running') {
    return (
      <div className="space-y-8 anim-page-enter">
        {header(
          <>
            Tailor to a <span className="nb-highlight">job</span>
          </>,
          <>
            Tailoring <strong className="text-[var(--color-text)]">{resumeTitle}</strong>. Your saved resume never changes: you get a
            tailored copy.
          </>,
          backToList
        )}

        <div className="grid gap-8 lg:grid-cols-[1.35fr_1fr] items-start">
          <div className={`${cardClass} p-6 space-y-6`}>
            <label className="block">
              <span className="block text-lg font-black">Job description</span>
              <span className="block text-sm text-[var(--color-text-muted)] mb-2">
                Paste the full posting. Chills picks out the keywords an ATS screens for.
              </span>
              <textarea
                rows={11}
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                disabled={busy}
                placeholder="Paste the job description…"
                className={`${inputClass} resize-y leading-relaxed`}
              />
              {!jdReady && jobDescription.trim().length > 0 && (
                <span className="block mt-1.5 text-xs font-semibold text-[var(--color-text-muted)]">
                  Paste the whole job description: at least 80 characters.
                </span>
              )}
            </label>

            <div>
              <span className="block text-lg font-black mb-3">How much should change?</span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {TAILOR_LEVELS.map((id) => (
                  <button
                    key={id}
                    onClick={() => setLevel(id)}
                    disabled={busy}
                    aria-pressed={level === id}
                    className={`text-left p-4 rounded-[10px] border-[1.6px] border-[var(--color-ink)] transition-all ${
                      level === id
                        ? 'bg-[var(--color-accent)] text-[#0a0a0a] shadow-[4px_4px_0_0_var(--color-ink)] -translate-x-0.5 -translate-y-0.5'
                        : 'bg-[var(--color-surface)] hover:bg-[var(--color-surface-offset)]'
                    }`}
                  >
                    <span className="block text-base font-black">{LEVELS[id].label}</span>
                    <span className="block text-xs leading-snug mt-1 opacity-80">{LEVELS[id].blurb}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="block text-lg font-black mb-3">Tone</span>
              <div className="flex flex-wrap gap-2">
                {TAILOR_TONES.map((id) => (
                  <button
                    key={id}
                    onClick={() => setTone(id)}
                    disabled={busy}
                    aria-pressed={tone === id}
                    title={TONES[id].hint}
                    className={`rounded-[8px] border-[1.6px] border-[var(--color-ink)] px-3 py-2 text-left transition-all ${
                      tone === id
                        ? 'bg-[var(--color-yellow)] text-[#0a0a0a] shadow-[3px_3px_0_0_var(--color-ink)]'
                        : 'bg-[var(--color-surface)] hover:bg-[var(--color-surface-offset)]'
                    }`}
                  >
                    <span className="block text-sm font-extrabold">{TONES[id].label}</span>
                    <span className="block text-[11px] opacity-80">{TONES[id].hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="block text-lg font-black">
                Anything that must not change <span className="text-sm font-semibold text-[var(--color-text-muted)]">(optional)</span>
              </span>
              <textarea
                rows={3}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                disabled={busy}
                placeholder="For example: keep the bullet about mentoring exactly as it is"
                className={`${inputClass} mt-2 resize-y leading-relaxed`}
              />
            </label>

            <p className="text-xs text-[var(--color-text-muted)]">
              At every level your employers, job titles, dates, degrees and contact details stay exactly as they are, and every required
              keyword from the job ends up in the resume.
            </p>
          </div>

          <div className="space-y-5 lg:sticky lg:top-24">
            {step === 'running' ? (
              <UsageMeter
                usage={usage}
                stage={progress.stage}
                label={progress.label}
                startedAt={startedAt}
                source={meterSource}
                runsLeft={!isOwner && billing ? Math.max(0, billing.runs.left - 1) : null}
              />
            ) : (
              <div className={`${cardClass} p-6 space-y-4 bg-[var(--color-sky-soft)]`}>
                <p className="text-lg font-black flex items-center gap-2">
                  <Sparkles size={20} /> Ready when you are
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex gap-2">
                    <CheckCircle size={18} className="text-[var(--color-success)] shrink-0" /> {LEVELS[level].label} tailoring, in a{' '}
                    {TONES[tone].label.toLowerCase()} tone
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle size={18} className="text-[var(--color-success)] shrink-0" /> You review every change before anything is applied
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle size={18} className="text-[var(--color-success)] shrink-0" /> A matching cover letter when you&apos;re done
                  </li>
                </ul>
              </div>
            )}

            <div className={`${cardClass} p-5 space-y-4`}>
              <AiAllowance
                kind="run"
                isOwner={isOwner}
                settings={settings}
                billing={billing}
                onOpenSettings={onOpenSettings}
                onOpenBilling={onOpenBilling}
                disabled={busy}
              />
              {error && <div className={errorBox}>{error}</div>}
              <button
                onClick={tailor}
                disabled={busy || (!jdReady && !outOfTailorings) || needsKey || checkingRuns || aiOff}
                className={`w-full ${primaryButton} py-3.5 text-base`}
              >
                {step === 'running' ? (
                  'Tailoring… usually a minute or two'
                ) : outOfTailorings ? (
                  'No tailorings left: get Pro or a credit pack'
                ) : (
                  <>
                    Tailor my resume <ArrowRight size={18} />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if ((step === 'review' || step === 'applying') && result) {
    return (
      <div className="space-y-8 anim-page-enter pb-24">
        {header(
          'Review the changes',
          <>
            {LEVELS[level].label} tailoring of <strong className="text-[var(--color-text)]">{resumeTitle}</strong>, in a{' '}
            {TONES[tone].label.toLowerCase()} tone. Approve, reject or edit each change; only approved ones go into the tailored copy.
          </>,
          <button onClick={() => setStep('form')} disabled={busy} className={backLinkClass}>
            <ArrowLeft size={16} /> Change the job, level or tone
          </button>
        )}
        <UsageLine usage={usage} elapsedMs={tookMs} />

        {result.summary && (
          <div className={`${cardClass} p-5 bg-[var(--color-yellow-soft)] flex gap-3`}>
            <Sparkles size={20} className="shrink-0 mt-0.5" />
            <p className="text-sm font-medium">{result.summary}</p>
          </div>
        )}

        {result.keywordReport && resume && <KeywordCoverage resume={resume} report={result.keywordReport} changes={changes} />}

        {error && <div className={errorBox}>{error}</div>}

        {changes.length === 0 ? (
          <p className="text-sm font-semibold text-[var(--color-text-muted)]">The AI proposed no changes. Try a stronger level.</p>
        ) : (
          <DiffViewer
            changes={changes}
            plainText
            onApprove={(id) => setApproval(id, true)}
            onReject={(id) => setApproval(id, false)}
            onEdit={editChange}
            onApproveAll={() => setAll(true)}
            onRejectAll={() => setAll(false)}
          />
        )}

        <div className="sticky bottom-4 z-10 nb-card rounded-[10px] p-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            <span className="text-lg font-black tabular-nums">{approvedCount}</span>{' '}
            <span className="text-[var(--color-text-muted)]">of {changes.length} changes approved</span>
          </p>
          <button onClick={apply} disabled={busy || approvedCount === 0} className={primaryButton}>
            {step === 'applying' ? (
              'Applying…'
            ) : (
              <>
                Apply {approvedCount} change{approvedCount === 1 ? '' : 's'} <ArrowRight size={16} />
              </>
            )}
          </button>
        </div>
      </div>
    )
  }

  if (step === 'done' && applied) {
    const skipped = [...applied.unmatched, ...applied.rejected.map((r) => r.original)]
    return (
      <div className="space-y-8 anim-page-enter">
        {header(
          <>
            Your tailored resume is <span className="nb-highlight">ready</span>
          </>,
          <>
            {applied.appliedCount} of {applied.requestedCount} approved changes applied to a copy of{' '}
            <strong className="text-[var(--color-text)]">{resumeTitle}</strong>. Your saved resume is unchanged.
          </>,
          backToList
        )}

        {(skipped.length > 0 || applied.overlapping.length > 0) && (
          <div className={`${warningBox} space-y-2`}>
            {skipped.length > 0 && (
              <p>
                {skipped.length} change{skipped.length === 1 ? '' : 's'} could not be applied: the text no longer matched a line, or the
                rewrite was not valid.
              </p>
            )}
            {applied.overlapping.length > 0 && (
              <p>
                {applied.overlapping.length} change{applied.overlapping.length === 1 ? '' : 's'} targeted a line another change already
                rewrote.
              </p>
            )}
            {skipped.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer font-bold">Show the skipped lines</summary>
                <ul className="mt-2 space-y-1.5 list-disc pl-4 text-[var(--color-text-muted)]">
                  {skipped.map((line, i) => (
                    <li key={i} className="break-words">
                      {line}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {/* The letter gets the wider column: it is edited in place. */}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start">
          <section className={`${cardClass} p-6 space-y-5`}>
            <div className="flex items-center gap-3">
              <span className="nb-badge w-11 h-11 bg-[var(--color-accent)]">
                <Download size={22} />
              </span>
              <div>
                <h2 className="text-xl sm:text-2xl font-black leading-tight">Download your resume</h2>
                <p className="text-sm text-[var(--color-text-muted)]">As a PDF, as LaTeX, or open it in Overleaf.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button onClick={downloadPdf} disabled={compiling} className={primaryButton}>
                <Download size={16} /> {compiling ? 'Building PDF…' : 'Download PDF'}
              </button>
              <button
                onClick={() => downloadBlob(new Blob([applied.latex], { type: 'application/x-tex' }), `${resumeFileBase(exportName)}.tex`)}
                className={secondaryButton}
              >
                .tex
              </button>
              <button onClick={() => openInOverleaf(applied.latex)} className={secondaryButton}>
                Open in Overleaf
              </button>
            </div>
            <p className="text-[11px] text-[var(--color-text-faint)]">
              Download PDF sends the tailored resume to texlive.net to be typeset, and Open in Overleaf sends it to overleaf.com.
            </p>
            {applied.tailoringId && (
              <p className="text-sm text-[var(--color-text-muted)]">
                This copy is saved in your{' '}
                <button onClick={onOpenHistory} className="font-bold underline underline-offset-4 text-[var(--color-text)]">
                  history
                </button>
                , so you can download it again later.
              </p>
            )}
            {error && <div className={errorBox}>{error}</div>}
          </section>

          <section className={`${cardClass} p-6 space-y-5`}>
            <div className="flex items-center gap-3">
              <span className="nb-badge w-11 h-11 bg-[var(--color-yellow)]">
                <Mail size={22} />
              </span>
              <div>
                <h2 className="text-xl sm:text-2xl font-black leading-tight">Write a cover letter</h2>
                <p className="text-sm text-[var(--color-text-muted)]">Matched to this job and your tailored resume.</p>
              </div>
            </div>
            {applied.tailoringId ? (
              <CoverLetterPanel
                tailoringId={applied.tailoringId}
                name={resumeTitle}
                isOwner={isOwner}
                settings={settings}
              />
            ) : (
              <p className="text-sm text-[var(--color-text-muted)]">
                This copy couldn&apos;t be saved to your history, so a cover letter can&apos;t be written for it. Try tailoring again.
              </p>
            )}
          </section>
        </div>

        {applied.tailoringId && onEmailRecruiters && (
          <section className="nb-card rounded-[10px] p-6 bg-[var(--color-sky-soft)] flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="nb-badge w-11 h-11 shrink-0 bg-[var(--color-periwinkle)] text-white">
                <Send size={20} />
              </span>
              <div>
                <h2 className="text-xl sm:text-2xl font-black leading-tight">Email a recruiter about this job</h2>
                <p className="text-sm text-[var(--color-text-muted)] max-w-xl">
                  Chills writes a short email from this tailored resume and the job post, sends it from your own mailbox with
                  this PDF attached, and keeps track of the reply.
                </p>
              </div>
            </div>
            <button
              onClick={() =>
                onEmailRecruiters({
                  tailoringId: applied.tailoringId as string,
                  jobTitle: result?.keywordReport?.jobTitle ?? '',
                  company,
                })
              }
              className={primaryButton}
            >
              Email recruiters <ArrowRight size={16} />
            </button>
          </section>
        )}

        <LatexPreview latex={applied.latex} title="Tailored LaTeX" />

        <button onClick={startOver} className="nb-btn nb-btn-yellow px-5 py-3 text-sm">
          Tailor this resume for another job <ArrowRight size={16} />
        </button>
      </div>
    )
  }

  return null
}
