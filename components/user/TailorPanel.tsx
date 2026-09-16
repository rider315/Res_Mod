'use client'
import { useState } from 'react'
import DiffViewer from '@/components/DiffViewer'
import LatexPreview from '@/components/LatexPreview'
import AiAllowance from '@/components/user/AiAllowance'
import KeywordCoverage from '@/components/user/KeywordCoverage'
import UsageMeter, { UsageLine } from '@/components/user/UsageMeter'
import { readTailorStream, RunUpdate } from '@/components/user/tailor-stream'
import { ApiError } from '@/components/user/billing-client'
import { addCall, AiUsage, emptyUsage } from '@/lib/ai-usage'
import { RunStage } from '@/lib/run-optimization'
import { AISettings } from '@/lib/settings-storage'
import { getProvider } from '@/lib/providers'
import { BILLING_CODES, BillingStatus } from '@/lib/billing/types'
import { LEVELS, TAILOR_LEVELS, TailorLevel } from '@/lib/tailor/levels'
import { OptimizationResult, ParsedResume, ResumeChange } from '@/types/resume'
import {
  downloadBlob,
  downloadResumePdf,
  errorBox,
  inputClass,
  openInOverleaf,
  primaryButton,
  resumeFileBase,
  secondaryButton,
} from '@/components/user/shared'

/**
 * Tailoring one saved resume to a job description: pick a level, review each
 * change against a live keyword score, then download the tailored copy. The
 * saved resume itself never changes.
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
  /** The owner runs on their own AI settings; everyone else on ResMod AI. */
  isOwner: boolean
  settings: AISettings
  /** undefined while loading; null when it couldn't be loaded, and always for the owner. */
  billing: BillingStatus | null | undefined
  onOpenSettings: () => void
  onOpenBilling: () => void
  onBillingChanged: () => void
  onQuotaExhausted: () => void
  onOpenHistory: () => void
  onBack: () => void
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

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
  onBack,
}: TailorPanelProps) {
  const [step, setStep] = useState<Step>('form')
  const [jobDescription, setJobDescription] = useState(initialJobDescription ?? '')
  const [level, setLevel] = useState<TailorLevel>('hard')
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

    const generate = ({ systemInstruction, prompt, temperature }: { systemInstruction: string; prompt: string; temperature: number }) =>
      generatePuterResponse({
        systemInstruction,
        prompt,
        temperature,
        model,
        onUsage: (call) => setUsage((total) => addCall(total, call)),
      })
    const keywords = await extractJdKeywords({ jobDescription, generate })
    const tailored = await runOptimization({
      mode: 'optimize',
      level,
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
    // Regular accounts always run on ResMod AI, so only the owner sends AI settings.
    const ai = isOwner ? { provider: settings.provider, apiKey: settings.apiKeys[settings.provider], model } : {}
    const res = await fetch(`/api/resumes/${resumeId}/tailor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobDescription, level, instructions, ...ai }),
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
    try {
      const outcome = isOwner && provider.clientSide ? await tailorInBrowser() : await tailorOnServer()
      setResume(outcome.resume)
      setResult(outcome.result)
      setChanges(outcome.result.changes.map((change) => ({ ...change, approved: null })))
      setTookMs(Date.now() - began)
      setStep('review')
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
  }

  const setApproval = (id: string, approved: boolean) =>
    setChanges((list) => list.map((change) => (change.id === id ? { ...change, approved } : change)))
  const setAll = (approved: boolean) => setChanges((list) => list.map((change) => ({ ...change, approved })))

  const backLink = (
    <button
      onClick={onBack}
      disabled={busy}
      className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50 transition-colors"
    >
      ← Your resumes
    </button>
  )

  if (step === 'form' || step === 'running') {
    return (
      <div className="space-y-6 anim-page-enter">
        <div>
          {backLink}
          <h1 className="text-2xl font-bold text-[var(--color-text)] mt-2">Tailor to a job</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">{resumeTitle}</p>
        </div>

        <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-5 space-y-5">
          <label className="block">
            <span className="block text-sm font-semibold text-[var(--color-text)] mb-1">Job description</span>
            <span className="block text-xs text-[var(--color-text-muted)] mb-2">
              Paste the full posting. The AI picks out the keywords an ATS screens for.
            </span>
            <textarea
              rows={10}
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              disabled={busy}
              placeholder="Paste the job description…"
              className={`${inputClass} resize-y leading-relaxed`}
            />
          </label>

          <div>
            <span className="block text-sm font-semibold text-[var(--color-text)] mb-2">How much should change?</span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {TAILOR_LEVELS.map((id) => (
                <button
                  key={id}
                  onClick={() => setLevel(id)}
                  disabled={busy}
                  className={`text-left p-3 rounded-xl border transition-all ${
                    level === id
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary-highlight)] ring-1 ring-[var(--color-primary)]'
                      : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'
                  }`}
                >
                  <p className="text-sm font-semibold text-[var(--color-text)]">{LEVELS[id].label}</p>
                  <p className="text-[11px] text-[var(--color-text-muted)] leading-snug mt-0.5">{LEVELS[id].blurb}</p>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[var(--color-text-faint)] mt-2">
              At every level your employers, job titles, dates, degrees and contact details stay exactly as they are,
              and every required keyword from the job ends up in the resume.
            </p>
          </div>

          <label className="block">
            <span className="block text-sm font-semibold text-[var(--color-text)] mb-1">
              Anything that must not change <span className="font-normal text-[var(--color-text-muted)]">(optional)</span>
            </span>
            <textarea
              rows={3}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              disabled={busy}
              placeholder="For example: keep the bullet about mentoring exactly as it is"
              className={`${inputClass} resize-y leading-relaxed`}
            />
          </label>

          <AiAllowance
            kind="run"
            isOwner={isOwner}
            settings={settings}
            billing={billing}
            onOpenSettings={onOpenSettings}
            onOpenBilling={onOpenBilling}
            disabled={busy}
          />

          {step === 'running' && (
            <UsageMeter
              usage={usage}
              stage={progress.stage}
              label={progress.label}
              startedAt={startedAt}
              source={meterSource}
              runsLeft={!isOwner && billing ? Math.max(0, billing.runs.left - 1) : null}
            />
          )}

          {error && <div className={errorBox}>{error}</div>}

          <button
            onClick={tailor}
            disabled={busy || (!jdReady && !outOfTailorings) || needsKey || checkingRuns || aiOff}
            className={`w-full ${primaryButton}`}
          >
            {step === 'running'
              ? 'Tailoring… this usually takes a minute or two'
              : outOfTailorings
                ? 'No tailorings left: get Pro or a credit pack →'
                : 'Tailor resume →'}
          </button>
          {!jdReady && jobDescription.trim().length > 0 && (
            <p className="text-[11px] text-[var(--color-text-muted)] text-center">
              Paste the whole job description: at least 80 characters.
            </p>
          )}
        </div>
      </div>
    )
  }

  if ((step === 'review' || step === 'applying') && result) {
    return (
      <div className="space-y-5 anim-page-enter">
        <div>
          <button
            onClick={() => setStep('form')}
            disabled={busy}
            className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50 transition-colors"
          >
            ← Change the job or level
          </button>
          <h1 className="text-2xl font-bold text-[var(--color-text)] mt-2">Review the tailored changes</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            {LEVELS[level].label} tailoring of {resumeTitle}. Only the changes you approve go into the tailored copy;
            your saved resume stays as it is.
          </p>
          <div className="mt-2">
            <UsageLine usage={usage} elapsedMs={tookMs} />
          </div>
        </div>

        {result.summary && (
          <p className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4 text-sm text-[var(--color-text)]">
            {result.summary}
          </p>
        )}

        {result.keywordReport && resume && (
          <KeywordCoverage resume={resume} report={result.keywordReport} changes={changes} />
        )}

        {error && <div className={errorBox}>{error}</div>}

        {changes.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">The AI proposed no changes. Try a stronger level.</p>
        ) : (
          <DiffViewer
            changes={changes}
            onApprove={(id) => setApproval(id, true)}
            onReject={(id) => setApproval(id, false)}
            onApproveAll={() => setAll(true)}
            onRejectAll={() => setAll(false)}
          />
        )}

        <div className="sticky bottom-4 bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-lg p-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--color-text-muted)]">
            <span className="font-semibold text-[var(--color-text)]">{approvedCount}</span> of {changes.length} changes approved
          </p>
          <button onClick={apply} disabled={busy || approvedCount === 0} className={primaryButton}>
            {step === 'applying' ? 'Applying…' : `Apply ${approvedCount} change${approvedCount === 1 ? '' : 's'} →`}
          </button>
        </div>
      </div>
    )
  }

  if (step === 'done' && applied) {
    const skipped = [...applied.unmatched, ...applied.rejected.map((r) => r.original)]
    return (
      <div className="space-y-6 anim-page-enter">
        <div>
          {backLink}
          <h1 className="text-2xl font-bold text-[var(--color-text)] mt-2">Your tailored resume is ready</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            {applied.appliedCount} of {applied.requestedCount} approved changes applied to a copy of {resumeTitle}.
            Your saved resume is unchanged.
          </p>
        </div>

        {(skipped.length > 0 || applied.overlapping.length > 0) && (
          <div className="rounded-xl border border-[var(--color-warning)] bg-[var(--color-warning-highlight)] p-4 text-sm text-[var(--color-warning)] space-y-2">
            {skipped.length > 0 && (
              <p>
                {skipped.length} change{skipped.length === 1 ? '' : 's'} could not be applied: the text no longer matched
                a line, or the rewrite was not valid LaTeX.
              </p>
            )}
            {applied.overlapping.length > 0 && (
              <p>
                {applied.overlapping.length} change{applied.overlapping.length === 1 ? '' : 's'} targeted a line another
                change already rewrote.
              </p>
            )}
            {skipped.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer font-medium">Show the skipped lines</summary>
                <ul className="mt-2 space-y-1.5 list-disc pl-4 text-[var(--color-text-muted)]">
                  {skipped.map((line, i) => (
                    <li key={i} className="break-words">{line}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => downloadBlob(new Blob([applied.latex], { type: 'application/x-tex' }), `${resumeFileBase(exportName)}.tex`)}
            className={primaryButton}
          >
            Download .tex
          </button>
          <button onClick={downloadPdf} disabled={compiling} className={secondaryButton}>
            {compiling ? 'Building PDF…' : 'Download PDF'}
          </button>
          <button onClick={() => openInOverleaf(applied.latex)} className={secondaryButton}>
            Open in Overleaf
          </button>
        </div>
        <p className="text-[11px] text-[var(--color-text-faint)]">
          Download PDF sends the tailored resume to texlive.net to be typeset, and Open in Overleaf sends it to overleaf.com.
        </p>
        {applied.tailoringId && (
          <p className="text-xs text-[var(--color-text-muted)]">
            This copy is saved in your{' '}
            <button onClick={onOpenHistory} className="text-[var(--color-primary)] hover:underline">
              history
            </button>
            , so you can download it again later.
          </p>
        )}

        {error && <div className={errorBox}>{error}</div>}

        <LatexPreview latex={applied.latex} title="Tailored LaTeX" />

        <button onClick={startOver} className="text-sm font-medium text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] transition-colors">
          Tailor this resume for another job
        </button>
      </div>
    )
  }

  return null
}
