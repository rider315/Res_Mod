'use client'
import { useCallback, useEffect, useState } from 'react'
import { signOut } from 'next-auth/react'
import OwnerNav from '@/components/OwnerNav'
import SettingsModal from '@/components/SettingsModal'
import AccountPanel from '@/components/user/AccountPanel'
import BillingPanel from '@/components/user/BillingPanel'
import HistoryPanel from '@/components/user/HistoryPanel'
import ImportPanel from '@/components/user/ImportPanel'
import QuotaDialog from '@/components/user/QuotaDialog'
import ResumeEditor from '@/components/user/ResumeEditor'
import TailorPanel from '@/components/user/TailorPanel'
import { fetchBilling, tailorings } from '@/components/user/billing-client'
import {
  dangerButton,
  downloadBlob,
  downloadResumePdf,
  errorBox,
  inputClass,
  primaryButton,
  resumeFileBase,
  ResumeSummary,
  secondaryButton,
} from '@/components/user/shared'
import { AISettings, DEFAULT_AI_SETTINGS, loadAISettings, saveAISettings } from '@/lib/settings-storage'
import { formatPrice } from '@/lib/billing/plans'
import type { BillingStatus } from '@/lib/billing/types'
import { ResumeDoc, SourceFormat } from '@/lib/resume-doc'

/**
 * The workspace for importing, keeping and tailoring resumes: every account that
 * isn't the owner lands here, and the owner can open it from the profile
 * dashboard.
 *
 * Regular accounts always run on ResMod AI, the model the owner picks in AI
 * settings, and have no AI settings of their own. Each gets a few free
 * tailorings once, then Pro or a credit pack, which can be bought at any time.
 * The owner runs on their own AI settings here and is never counted.
 */

type View =
  | { kind: 'list' }
  | { kind: 'import' }
  | { kind: 'tailor'; resumeId: string; title: string; jobDescription?: string }
  | {
      kind: 'edit'
      resumeId: string | null
      sourceFormat: SourceFormat
      doc: ResumeDoc
      title: string
      latex: string | null
    }

/**
 * Screens that open over the current view. The view stays mounted underneath,
 * so a pasted job description survives a trip to buy runs or look something up.
 */
type Overlay = 'billing' | 'history' | 'account' | null

const FORMAT_LABEL: Record<string, string> = { pdf: 'PDF', docx: 'Word', latex: 'LaTeX', text: 'text' }
const headerButton = 'text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors'

const STEPS: Array<[string, string]> = [
  ['Import your resume', 'A PDF, Word, LaTeX or text file becomes a clean LaTeX resume you can check and edit.'],
  ['Paste a job description', 'Choose Soft, Hard or Hardest, and the AI tailors your resume to that job.'],
  ['Review and download', 'Approve each change, then download a PDF or .tex, or open it in Overleaf.'],
]

interface LoadedResume {
  resume: ResumeSummary
  doc: ResumeDoc
  latex: string
}

interface UserDashboardProps {
  name: string
  email: string
  /** The owner, visiting this workspace from the profile dashboard. */
  isOwner?: boolean
}

export default function UserDashboard({ name, email, isOwner = false }: UserDashboardProps) {
  const [view, setView] = useState<View>({ kind: 'list' })
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [resumes, setResumes] = useState<ResumeSummary[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [settings, setSettings] = useState<AISettings>(DEFAULT_AI_SETTINGS)
  const [showSettings, setShowSettings] = useState(false)
  /** undefined while loading; null when it couldn't be loaded, or for the owner, who has no limits. */
  const [billing, setBilling] = useState<BillingStatus | null | undefined>(undefined)
  const [quotaDialog, setQuotaDialog] = useState<'run' | 'import' | null>(null)

  const firstName = name.trim().split(/\s+/)[0]

  useEffect(() => {
    const theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', theme)
    // Only the owner has AI settings; everyone else runs on ResMod AI.
    if (isOwner) setSettings(loadAISettings())
  }, [isOwner])

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/resumes')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Your resumes could not be loaded.')
      setResumes(data.resumes)
      setListError(null)
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err))
      setResumes((current) => current ?? [])
    }
  }, [])

  const refreshBilling = useCallback(async () => {
    try {
      const status = await fetchBilling()
      setBilling(status.role === 'user' ? status : null)
    } catch {
      setBilling((current) => current ?? null)
    }
  }, [])

  useEffect(() => {
    refresh()
    refreshBilling()
  }, [refresh, refreshBilling])

  function openOverlay(next: Overlay) {
    setQuotaDialog(null)
    setOverlay(next)
    window.scrollTo({ top: 0 })
  }

  const aiProps = {
    isOwner,
    settings,
    billing,
    onOpenSettings: () => setShowSettings(true),
    onOpenBilling: () => openOverlay('billing'),
    onBillingChanged: refreshBilling,
  }

  async function withResume(id: string, action: (loaded: LoadedResume) => void) {
    setBusyId(id)
    setListError(null)
    try {
      const res = await fetch(`/api/resumes/${id}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'That resume could not be loaded.')
      action(data)
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  const openResume = (id: string) =>
    withResume(id, ({ resume, doc, latex }) =>
      setView({ kind: 'edit', resumeId: resume.id, sourceFormat: resume.sourceFormat as SourceFormat, doc, title: resume.title, latex })
    )

  const downloadTex = (id: string) =>
    withResume(id, ({ doc, latex }) =>
      downloadBlob(new Blob([latex], { type: 'application/x-tex' }), `${resumeFileBase(doc.name)}.tex`)
    )

  async function downloadPdf(summary: ResumeSummary) {
    setBusyId(summary.id)
    setListError(null)
    try {
      await downloadResumePdf(summary.id, summary.title)
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  async function remove(summary: ResumeSummary) {
    if (!window.confirm(`Delete "${summary.title}"? This cannot be undone.`)) return
    setBusyId(summary.id)
    setListError(null)
    try {
      const res = await fetch(`/api/resumes/${summary.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'That resume could not be deleted.')
      }
      setResumes((list) => (list ?? []).filter((resume) => resume.id !== summary.id))
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <header className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-3 flex items-center justify-between gap-4">
        <button onClick={() => setOverlay(null)} className="font-semibold text-[var(--color-text)] text-base">
          ResMod
        </button>
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
          {isOwner ? (
            <OwnerNav inUserWorkspace />
          ) : (
            <>
              {billing?.platformAi && (
                <button onClick={() => openOverlay('billing')} className={headerButton}>
                  <span className="font-semibold text-[var(--color-text)] tabular-nums">{billing.runs.left}</span>{' '}
                  {billing.runs.left === 1 ? 'tailoring' : 'tailorings'} left
                </button>
              )}
              <button onClick={() => openOverlay('billing')} className={headerButton}>
                Plans
              </button>
            </>
          )}
          <button onClick={() => openOverlay('history')} className={headerButton}>
            History
          </button>
          {isOwner && (
            <button onClick={() => setShowSettings(true)} className={headerButton}>
              AI settings
            </button>
          )}
          {!isOwner && (
            <button onClick={() => openOverlay('account')} title={email || name} className={headerButton}>
              Account
            </button>
          )}
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <div hidden={overlay !== null} className="space-y-6">
          {view.kind === 'list' && (
            <div className="space-y-6 anim-page-enter">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-bold text-[var(--color-text)]">
                    {firstName ? `Welcome, ${firstName}` : 'Your resumes'}
                  </h1>
                  <p className="text-sm text-[var(--color-text-muted)] mt-1">
                    Import a resume once, then tailor it to any job description.
                  </p>
                </div>
                {resumes && resumes.length > 0 && (
                  <button onClick={() => setView({ kind: 'import' })} className={secondaryButton}>
                    + Import another resume
                  </button>
                )}
              </div>

              {!isOwner && billing?.platformAi && (
                <PlanStrip billing={billing} onOpenBilling={() => openOverlay('billing')} />
              )}

              {listError && <div className={errorBox}>{listError}</div>}

              {resumes === null ? (
                <p className="text-sm text-[var(--color-text-muted)]">Loading your resumes…</p>
              ) : resumes.length === 0 ? (
                <div className="bg-[var(--color-surface)] rounded-2xl border border-dashed border-[var(--color-border)] p-8 space-y-5">
                  <div className="text-center space-y-1">
                    <p className="text-base font-semibold text-[var(--color-text)]">Tailor your resume in three steps</p>
                    <p className="text-sm text-[var(--color-text-muted)]">Start by importing the resume you already have.</p>
                  </div>
                  <ol className="max-w-md mx-auto space-y-3">
                    {STEPS.map(([title, detail], i) => (
                      <li key={title} className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-[var(--color-primary-highlight)] text-[var(--color-primary)] text-xs font-bold flex items-center justify-center flex-shrink-0">
                          {i + 1}
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-[var(--color-text)]">{title}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">{detail}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <div className="text-center">
                    <button onClick={() => setView({ kind: 'import' })} className={primaryButton}>
                      Import your resume →
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <TailorStart
                    resumes={resumes}
                    disabled={busyId !== null}
                    onStart={(resume, jobDescription) =>
                      setView({ kind: 'tailor', resumeId: resume.id, title: resume.title, jobDescription })
                    }
                  />

                  <div className="space-y-3">
                    <h2 className="text-sm font-semibold text-[var(--color-text)]">Your resumes</h2>
                    <ul className="space-y-3">
                      {resumes.map((resume) => (
                        <li
                          key={resume.id}
                          className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-4 flex flex-wrap items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[var(--color-text)] truncate">{resume.title}</p>
                            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                              Imported from {FORMAT_LABEL[resume.sourceFormat] ?? resume.sourceFormat} · updated{' '}
                              {new Date(resume.updatedAt).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => setView({ kind: 'tailor', resumeId: resume.id, title: resume.title })}
                              disabled={busyId !== null}
                              className={primaryButton}
                            >
                              Tailor
                            </button>
                            <button onClick={() => openResume(resume.id)} disabled={busyId !== null} className={secondaryButton}>
                              Edit
                            </button>
                            <button onClick={() => downloadTex(resume.id)} disabled={busyId !== null} className={secondaryButton}>
                              .tex
                            </button>
                            <button onClick={() => downloadPdf(resume)} disabled={busyId !== null} className={secondaryButton}>
                              {busyId === resume.id ? 'Working…' : 'PDF'}
                            </button>
                            <button onClick={() => remove(resume)} disabled={busyId !== null} className={dangerButton}>
                              Delete
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </div>
          )}

          {view.kind === 'import' && (
            <ImportPanel
              {...aiProps}
              onQuotaExhausted={() => setQuotaDialog('import')}
              onImported={(doc, sourceFormat) =>
                setView({ kind: 'edit', resumeId: null, sourceFormat, doc, title: doc.name, latex: null })
              }
              onCancel={() => setView({ kind: 'list' })}
            />
          )}

          {view.kind === 'edit' && (
            <ResumeEditor
              key={view.resumeId ?? 'new'}
              resumeId={view.resumeId}
              sourceFormat={view.sourceFormat}
              initialDoc={view.doc}
              initialTitle={view.title}
              initialLatex={view.latex}
              onSaved={() => refresh()}
              onBack={() => {
                setView({ kind: 'list' })
                refresh()
              }}
              onTailor={(resumeId, title) => setView({ kind: 'tailor', resumeId, title })}
            />
          )}

          {view.kind === 'tailor' && (
            <TailorPanel
              key={view.resumeId}
              resumeId={view.resumeId}
              resumeTitle={view.title}
              initialJobDescription={view.jobDescription}
              {...aiProps}
              onQuotaExhausted={() => setQuotaDialog('run')}
              onOpenHistory={() => openOverlay('history')}
              onBack={() => setView({ kind: 'list' })}
            />
          )}
        </div>

        {overlay === 'billing' && <BillingPanel billing={billing} onBillingChange={setBilling} onBack={() => setOverlay(null)} />}
        {overlay === 'history' && <HistoryPanel onBack={() => setOverlay(null)} />}
        {overlay === 'account' && !isOwner && (
          <AccountPanel email={email} onBack={() => setOverlay(null)} onOpenHistory={() => openOverlay('history')} />
        )}
      </main>

      {showSettings && isOwner && (
        <SettingsModal
          settings={settings}
          serverKeys={isOwner}
          platformAdmin={isOwner}
          onSave={(next) => {
            saveAISettings(next)
            setSettings(next)
            setShowSettings(false)
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {quotaDialog && (
        <QuotaDialog
          kind={quotaDialog}
          billing={billing}
          onOpenBilling={() => openOverlay('billing')}
          onClose={() => setQuotaDialog(null)}
        />
      )}
    </div>
  )
}

/**
 * Where the account stands, and that Pro can be had at any time: before the free
 * tailorings run out as much as after.
 */
function PlanStrip({ billing, onOpenBilling }: { billing: BillingStatus; onOpenBilling: () => void }) {
  const { runs, subscription, pro } = billing
  if (subscription?.entitled) return null

  const freeLeft = Math.max(0, runs.free.limit - runs.free.used)
  const offer = `Pro gives you ${pro.runsPerCycle} tailorings a month for ${formatPrice(pro.pricePaise)}.`
  const [text, warn] =
    runs.left === 0
      ? [`You've used your ${runs.free.limit} free tailorings. Get Pro or a credit pack to keep tailoring.`, true]
      : freeLeft > 0
        ? [`${freeLeft} of your ${runs.free.limit} free tailorings left. ${offer} You can get it any time.`, false]
        : [`You have ${tailorings(runs.left)} left from credits. ${offer}`, false]

  return (
    <div
      className={`rounded-2xl border p-4 flex flex-wrap items-center justify-between gap-3 ${
        warn
          ? 'border-[var(--color-warning)] bg-[var(--color-warning-highlight)]'
          : 'border-[var(--color-border)] bg-[var(--color-surface)]'
      }`}
    >
      <p className={`text-sm ${warn ? 'text-[var(--color-warning)] font-medium' : 'text-[var(--color-text-muted)]'}`}>{text}</p>
      <button onClick={onOpenBilling} className={warn ? primaryButton : secondaryButton}>
        See plans
      </button>
    </div>
  )
}

/** The job description box on the dashboard itself: pick a resume, paste the job, go on to choose the level. */
function TailorStart({
  resumes,
  disabled,
  onStart,
}: {
  resumes: ResumeSummary[]
  disabled: boolean
  onStart: (resume: ResumeSummary, jobDescription: string) => void
}) {
  const [resumeId, setResumeId] = useState(resumes[0].id)
  const [jobDescription, setJobDescription] = useState('')
  const resume = resumes.find((entry) => entry.id === resumeId) ?? resumes[0]
  const length = jobDescription.trim().length

  return (
    <section className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-primary)] p-5 space-y-3">
      <div>
        <h2 className="text-base font-semibold text-[var(--color-text)]">Tailor a resume to a job</h2>
        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
          Paste the job description. Next you choose how much should change, and nothing is applied until you approve it.
        </p>
      </div>
      {resumes.length > 1 && (
        <label className="block">
          <span className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Resume</span>
          <select value={resume.id} onChange={(e) => setResumeId(e.target.value)} disabled={disabled} className={inputClass}>
            {resumes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <textarea
        rows={5}
        value={jobDescription}
        onChange={(e) => setJobDescription(e.target.value)}
        disabled={disabled}
        placeholder="Paste the job description…"
        aria-label="Job description"
        className={`${inputClass} resize-y leading-relaxed`}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-[var(--color-text-muted)]">
          {length > 0 && length < 80
            ? 'Paste the whole job description: at least 80 characters.'
            : resumes.length === 1
              ? `Tailors ${resume.title}.`
              : ''}
        </p>
        <button onClick={() => onStart(resume, jobDescription)} disabled={disabled || length < 80} className={primaryButton}>
          Next: choose how much to change →
        </button>
      </div>
    </section>
  )
}
