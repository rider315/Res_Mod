'use client'
import { useCallback, useEffect, useState } from 'react'
import { signOut } from 'next-auth/react'
import SettingsModal from '@/components/SettingsModal'
import BillingPanel from '@/components/user/BillingPanel'
import ImportPanel from '@/components/user/ImportPanel'
import QuotaDialog from '@/components/user/QuotaDialog'
import ResumeEditor from '@/components/user/ResumeEditor'
import TailorPanel from '@/components/user/TailorPanel'
import { fetchBilling } from '@/components/user/billing-client'
import {
  dangerButton,
  downloadBlob,
  downloadResumePdf,
  errorBox,
  primaryButton,
  resumeFileBase,
  ResumeSummary,
  secondaryButton,
} from '@/components/user/shared'
import {
  AISettings,
  AiSource,
  DEFAULT_AI_SETTINGS,
  loadAISettings,
  loadAiSource,
  saveAISettings,
  saveAiSource,
} from '@/lib/settings-storage'
import type { BillingStatus } from '@/lib/billing/types'
import { ResumeDoc, SourceFormat } from '@/lib/resume-doc'

/**
 * The dashboard for every account that isn't the owner: import a resume, check
 * it, keep it, tailor it and download it, on ResMod AI's included runs or the
 * account's own AI. Nothing owner-specific is loaded here.
 */

type View =
  | { kind: 'list' }
  | { kind: 'import' }
  | { kind: 'tailor'; resumeId: string; title: string }
  | {
      kind: 'edit'
      resumeId: string | null
      sourceFormat: SourceFormat
      doc: ResumeDoc
      title: string
      latex: string | null
    }

const FORMAT_LABEL: Record<string, string> = { pdf: 'PDF', docx: 'Word', latex: 'LaTeX', text: 'text' }

interface LoadedResume {
  resume: ResumeSummary
  doc: ResumeDoc
  latex: string
}

export default function UserDashboard({ name }: { name: string }) {
  const [view, setView] = useState<View>({ kind: 'list' })
  const [resumes, setResumes] = useState<ResumeSummary[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [settings, setSettings] = useState<AISettings>(DEFAULT_AI_SETTINGS)
  const [showSettings, setShowSettings] = useState(false)
  /** undefined while loading; null when it couldn't be loaded. */
  const [billing, setBilling] = useState<BillingStatus | null | undefined>(undefined)
  // Billing opens over the current view, which stays mounted underneath, so a
  // pasted job description survives a trip to buy more runs.
  const [showBilling, setShowBilling] = useState(false)
  const [aiSource, setAiSource] = useState<AiSource>('platform')
  const [quotaDialog, setQuotaDialog] = useState<'run' | 'import' | null>(null)

  const firstName = name.trim().split(/\s+/)[0]

  useEffect(() => {
    const theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', theme)
    setSettings(loadAISettings())
    setAiSource(loadAiSource() ?? 'platform')
  }, [])

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

  function changeAiSource(source: AiSource) {
    setAiSource(source)
    saveAiSource(source)
  }

  function openBilling() {
    setQuotaDialog(null)
    setShowBilling(true)
  }

  const aiProps = {
    settings,
    aiSource,
    onAiSourceChange: changeAiSource,
    billing,
    onOpenSettings: () => setShowSettings(true),
    onOpenBilling: openBilling,
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
        <span className="font-semibold text-[var(--color-text)] text-base">ResMod</span>
        <div className="flex items-center gap-4">
          {billing?.platformAi && (
            <button
              onClick={openBilling}
              className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              <span className="font-semibold text-[var(--color-text)] tabular-nums">{billing.runs.left}</span>{' '}
              {billing.runs.left === 1 ? 'run' : 'runs'} left
            </button>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            AI settings
          </button>
          {name && <span className="text-sm text-[var(--color-text-muted)] hidden sm:inline truncate max-w-[160px]">{name}</span>}
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <div hidden={showBilling} className="space-y-6">
          {view.kind === 'list' && (
            <div className="space-y-6 anim-page-enter">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-bold text-[var(--color-text)]">
                    {firstName ? `Welcome, ${firstName}` : 'Your resumes'}
                  </h1>
                  <p className="text-sm text-[var(--color-text-muted)] mt-1">
                    Import a resume once and check it, then tailor it to any job description.
                  </p>
                </div>
                {resumes && resumes.length > 0 && (
                  <button onClick={() => setView({ kind: 'import' })} className={primaryButton}>
                    + Import a resume
                  </button>
                )}
              </div>

              {listError && <div className={errorBox}>{listError}</div>}

              {resumes === null ? (
                <p className="text-sm text-[var(--color-text-muted)]">Loading your resumes…</p>
              ) : resumes.length === 0 ? (
                <div className="bg-[var(--color-surface)] rounded-2xl border border-dashed border-[var(--color-border)] p-10 text-center space-y-3">
                  <p className="text-base font-semibold text-[var(--color-text)]">No resumes yet</p>
                  <p className="text-sm text-[var(--color-text-muted)] max-w-md mx-auto">
                    Upload your resume as a PDF, Word, LaTeX or text file. It becomes a clean, ATS-friendly LaTeX
                    resume you can edit and download.
                  </p>
                  <button onClick={() => setView({ kind: 'import' })} className={primaryButton}>
                    Import your first resume
                  </button>
                </div>
              ) : (
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
              {...aiProps}
              onQuotaExhausted={() => setQuotaDialog('run')}
              onBack={() => setView({ kind: 'list' })}
            />
          )}
        </div>

        {showBilling && <BillingPanel billing={billing} onBillingChange={setBilling} onBack={() => setShowBilling(false)} />}
      </main>

      {showSettings && (
        <SettingsModal
          settings={settings}
          serverKeys={false}
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
          onOpenBilling={openBilling}
          onUseOwnAi={() => {
            setQuotaDialog(null)
            changeAiSource('own')
            setShowSettings(true)
          }}
          onClose={() => setQuotaDialog(null)}
        />
      )}
    </div>
  )
}
