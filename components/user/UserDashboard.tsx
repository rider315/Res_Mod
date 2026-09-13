'use client'
import { useCallback, useEffect, useState } from 'react'
import { signOut } from 'next-auth/react'
import SettingsModal from '@/components/SettingsModal'
import ImportPanel from '@/components/user/ImportPanel'
import ResumeEditor from '@/components/user/ResumeEditor'
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
import { AISettings, DEFAULT_AI_SETTINGS, loadAISettings, saveAISettings } from '@/lib/settings-storage'
import { ResumeDoc, SourceFormat } from '@/lib/resume-doc'

/**
 * The dashboard for every account that isn't the owner: import a resume, check
 * it, keep it, and download it. Nothing owner-specific is loaded here.
 */

type View =
  | { kind: 'list' }
  | { kind: 'import' }
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

  const firstName = name.trim().split(/\s+/)[0]

  useEffect(() => {
    const theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', theme)
    setSettings(loadAISettings())
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

  useEffect(() => {
    refresh()
  }, [refresh])

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

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {view.kind === 'list' && (
          <div className="space-y-6 anim-page-enter">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold text-[var(--color-text)]">
                  {firstName ? `Welcome, ${firstName}` : 'Your resumes'}
                </h1>
                <p className="text-sm text-[var(--color-text-muted)] mt-1">
                  Import a resume once, check it, and keep it here. Tailoring it to a job description is coming next.
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
            settings={settings}
            onOpenSettings={() => setShowSettings(true)}
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
          />
        )}
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
    </div>
  )
}
