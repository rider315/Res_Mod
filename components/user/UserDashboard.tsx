'use client'
import { useCallback, useEffect, useState } from 'react'
import { signOut } from 'next-auth/react'
import { useConfirm } from '@/components/ConfirmProvider'
import { reportConversion } from '@/lib/analytics'
import OwnerNav from '@/components/OwnerNav'
import SettingsModal from '@/components/SettingsModal'
import { LogoMark } from '@/components/brand/Logo'
import {
  ArrowRight,
  Download,
  FileText,
  History as HistoryIcon,
  Mail,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash,
  User,
} from '@/components/brand/Icons'
import AccountPanel from '@/components/user/AccountPanel'
import BillingPanel from '@/components/user/BillingPanel'
import HistoryPanel from '@/components/user/HistoryPanel'
import ImportPanel from '@/components/user/ImportPanel'
import KeywordFinderPanel from '@/components/user/KeywordFinderPanel'
import OutreachCard from '@/components/user/outreach/OutreachCard'
import OutreachPanel from '@/components/user/outreach/OutreachPanel'
import ApplyPanel from '@/components/user/ApplyPanel'
import type { OutreachContext } from '@/components/user/outreach/outreach-client'
import QuotaDialog from '@/components/user/QuotaDialog'
import ResumeEditor from '@/components/user/ResumeEditor'
import TailorPanel from '@/components/user/TailorPanel'
import { fetchBilling, tailorings } from '@/components/user/billing-client'
import {
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
 * Regular accounts always run on Chills AI, the model the owner picks in AI
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
 * so a pasted job description survives a trip to buy tailorings or look something up.
 */
type Overlay = 'billing' | 'history' | 'account' | 'keywords' | 'outreach' | 'apply' | null

const FORMAT_LABEL: Record<string, string> = { pdf: 'PDF', docx: 'Word', latex: 'LaTeX', text: 'text' }

const STEPS: Array<[string, string]> = [
  ['Import your resume', 'A PDF, Word, LaTeX or text file becomes a clean resume you can check and edit.'],
  ['Paste a job description', 'Choose Soft, Hard or Hardest, and a tone, and Chills tailors your resume to the job.'],
  ['Apply and reach out', 'Keep, edit or skip each change, then download the PDF or email it to recruiters, with replies tracked.'],
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
  /** Start on the keyword finder, as the public keyword finder page links here. */
  openKeywordFinder?: boolean
  /** The account was created by this visit: the one time a signup is worth reporting. */
  justSignedUp?: boolean
}

export default function UserDashboard({ name, email, isOwner = false, openKeywordFinder = false, justSignedUp = false }: UserDashboardProps) {
  const confirm = useConfirm()
  const [view, setView] = useState<View>({ kind: 'list' })
  const [overlay, setOverlay] = useState<Overlay>(openKeywordFinder ? 'keywords' : null)
  const [resumes, setResumes] = useState<ResumeSummary[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [settings, setSettings] = useState<AISettings>(DEFAULT_AI_SETTINGS)
  const [showSettings, setShowSettings] = useState(false)
  const [focusPlatformAi, setFocusPlatformAi] = useState(false)
  /** undefined while loading; null when it couldn't be loaded, or for the owner, who has no limits. */
  const [billing, setBilling] = useState<BillingStatus | null | undefined>(undefined)
  const [quotaDialog, setQuotaDialog] = useState<'run' | 'import' | null>(null)
  /** What Outreach was opened for: a tailored copy's job, or any job. */
  const [outreachContext, setOutreachContext] = useState<OutreachContext | null>(null)

  const firstName = name.trim().split(/\s+/)[0]

  // The account was just created, so the ad that brought them worked. The owner
  // is never counted: they arrive here from their own dashboard, not from an ad.
  useEffect(() => {
    if (justSignedUp && !isOwner) reportConversion('signup')
  }, [justSignedUp, isOwner])

  useEffect(() => {
    // The workspace has one look, whatever the device's theme.
    document.documentElement.setAttribute('data-theme', 'light')
    // Only the owner has AI settings; everyone else runs on Chills AI.
    if (isOwner) setSettings(loadAISettings())
  }, [isOwner])

  useEffect(() => {
    if (!openKeywordFinder) return
    // The link has done its job: reloading shouldn't reopen the finder once it's closed.
    const url = new URL(window.location.href)
    url.searchParams.delete('open')
    window.history.replaceState(null, '', url)
  }, [openKeywordFinder])

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

  function openOutreach(context: OutreachContext | null) {
    setOutreachContext(context)
    openOverlay('outreach')
  }

  function goHome() {
    setOverlay(null)
    setView({ kind: 'list' })
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
    const ok = await confirm({
      title: `Delete “${summary.title}”?`,
      body: 'The resume and every tailored copy made from it go too.',
      confirmLabel: 'Delete the resume',
      danger: true,
    })
    if (!ok) return
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

  const startTailoring = (resumeId: string, title: string, jobDescription?: string) => {
    setOverlay(null)
    setView({ kind: 'tailor', resumeId, title, jobDescription })
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      {/* Below lg the links get a row of their own, and on phones the header scrolls away. */}
      <header className="sm:sticky sm:top-0 z-20 bg-[var(--color-surface)] border-b-[1.6px] border-[var(--color-ink)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 min-h-[64px] py-2 flex flex-wrap items-center gap-x-1.5 gap-y-2">
          <button onClick={goHome} className="mr-auto inline-flex items-center gap-2.5" aria-label="Your resumes">
            <LogoMark size={36} />
            <span className="hidden sm:inline text-xl font-black tracking-tight">Chills</span>
          </button>
          {!isOwner && billing?.platformAi && (
            <button
              onClick={() => openOverlay('billing')}
              className="nb-chip py-1.5 px-3 bg-[var(--color-accent)] text-[#0a0a0a] hover:shadow-[3px_3px_0_0_var(--color-ink)] transition-shadow"
            >
              <span className="tabular-nums">{billing.runs.left}</span> {billing.runs.left === 1 ? 'tailoring' : 'tailorings'} left
            </button>
          )}
          <nav className="order-last w-full lg:order-none lg:w-auto flex flex-wrap items-center gap-1 lg:gap-1.5">
            {isOwner && (
              <OwnerNav
                inUserWorkspace
                onOpenAiSettings={() => {
                  setFocusPlatformAi(true)
                  setShowSettings(true)
                }}
              />
            )}
            <NavButton active={overlay === 'apply'} onClick={() => openOverlay('apply')} icon={<Sparkles size={16} />}>
              Apply
            </NavButton>
            <NavButton active={overlay === 'keywords'} onClick={() => openOverlay('keywords')} icon={<Search size={16} />}>
              Keywords
            </NavButton>
            <NavButton active={overlay === 'outreach'} onClick={() => openOutreach(null)} icon={<Mail size={16} />}>
              Outreach
            </NavButton>
            <NavButton active={overlay === 'history'} onClick={() => openOverlay('history')} icon={<HistoryIcon size={16} />}>
              History
            </NavButton>
            {!isOwner && (
              <NavButton active={overlay === 'billing'} onClick={() => openOverlay('billing')} icon={<Sparkles size={16} />}>
                Plans
              </NavButton>
            )}
            {isOwner && (
              <NavButton active={showSettings} onClick={() => setShowSettings(true)}>
                AI settings
              </NavButton>
            )}
            {!isOwner && (
              <NavButton active={overlay === 'account'} onClick={() => openOverlay('account')} icon={<User size={16} />} title={email || name}>
                Account
              </NavButton>
            )}
          </nav>
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="px-2 py-1.5 text-sm font-bold text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <div hidden={overlay !== null}>
          {view.kind === 'list' && (
            <div className="space-y-8 anim-page-enter">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h1 className="text-4xl sm:text-5xl font-black tracking-tight">
                    {firstName ? (
                      <>
                        Welcome, <span className="nb-highlight">{firstName}</span>
                      </>
                    ) : (
                      'Your resumes'
                    )}
                  </h1>
                  <p className="mt-4 text-lg text-[var(--color-text-muted)]">
                    Import a resume once, then tailor it to any job description.
                  </p>
                </div>
                {resumes && resumes.length > 0 && (
                  <button onClick={() => setView({ kind: 'import' })} className={secondaryButton}>
                    <Plus size={16} /> Import a resume
                  </button>
                )}
              </div>

              {!isOwner && billing?.platformAi && <PlanStrip billing={billing} onOpenBilling={() => openOverlay('billing')} />}

              {listError && <div className={errorBox}>{listError}</div>}

              {resumes === null ? (
                <p className="text-sm font-semibold text-[var(--color-text-muted)]">Loading your resumes…</p>
              ) : resumes.length === 0 ? (
                <GettingStarted onImport={() => setView({ kind: 'import' })} />
              ) : (
                <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] items-start">
                  <TailorStart
                    resumes={resumes}
                    disabled={busyId !== null}
                    onStart={(resume, jobDescription) => startTailoring(resume.id, resume.title, jobDescription)}
                    onFindKeywords={() => openOverlay('keywords')}
                  />

                  <section className="space-y-4">
                    <h2 className="text-xl font-black">Your resumes</h2>
                    <ul className="space-y-4">
                      {resumes.map((resume) => (
                        <li key={resume.id} className="nb-card rounded-[10px] p-4 space-y-3">
                          <div className="flex items-start gap-3 min-w-0">
                            <span className="nb-badge w-10 h-10 shrink-0 bg-[var(--color-yellow)]">
                              <FileText size={20} />
                            </span>
                            <div className="min-w-0">
                              <p className="font-extrabold truncate">{resume.title}</p>
                              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                                From {FORMAT_LABEL[resume.sourceFormat] ?? resume.sourceFormat} · updated{' '}
                                {new Date(resume.updatedAt).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => startTailoring(resume.id, resume.title)}
                              disabled={busyId !== null}
                              className="nb-btn nb-btn-sm nb-btn-primary py-2 px-3.5 text-sm"
                            >
                              Tailor <ArrowRight size={15} />
                            </button>
                            <button onClick={() => openResume(resume.id)} disabled={busyId !== null} className={secondaryButton}>
                              <Pencil size={15} /> Edit
                            </button>
                            <button onClick={() => downloadPdf(resume)} disabled={busyId !== null} className={secondaryButton}>
                              <Download size={15} /> {busyId === resume.id ? 'Working…' : 'PDF'}
                            </button>
                            <button onClick={() => downloadTex(resume.id)} disabled={busyId !== null} className={secondaryButton}>
                              .tex
                            </button>
                            <button
                              onClick={() => remove(resume)}
                              disabled={busyId !== null}
                              className="nb-btn nb-btn-sm nb-btn-danger py-2 px-2.5"
                              aria-label={`Delete ${resume.title}`}
                              title="Delete"
                            >
                              <Trash size={15} />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <OutreachCard refreshKey={overlay} onOpen={() => openOutreach(null)} />
                  </section>
                </div>
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
              onTailor={(resumeId, title) => startTailoring(resumeId, title)}
            />
          )}

          {view.kind === 'tailor' && (
            <TailorPanel
              key={`${view.resumeId}:${view.jobDescription ?? ''}`}
              resumeId={view.resumeId}
              resumeTitle={view.title}
              initialJobDescription={view.jobDescription}
              {...aiProps}
              onQuotaExhausted={() => setQuotaDialog('run')}
              onOpenHistory={() => openOverlay('history')}
              onEmailRecruiters={openOutreach}
              onBack={goHome}
            />
          )}
        </div>

        {overlay === 'billing' && <BillingPanel billing={billing} onBillingChange={setBilling} onBack={() => setOverlay(null)} />}
        {overlay === 'history' && <HistoryPanel {...aiProps} onEmailRecruiters={openOutreach} onBack={() => setOverlay(null)} />}
        {overlay === 'outreach' && (
          <OutreachPanel
            resumes={resumes}
            isOwner={isOwner}
            settings={settings}
            billing={billing}
            context={outreachContext}
            onClearContext={() => setOutreachContext(null)}
            onBillingChanged={refreshBilling}
            onOpenBilling={() => openOverlay('billing')}
            onImportResume={() => {
              setOverlay(null)
              setView({ kind: 'import' })
            }}
            onBack={() => setOverlay(null)}
          />
        )}
        {overlay === 'apply' && (
          <ApplyPanel
            resumes={resumes}
            settings={settings}
            isOwner={isOwner}
            onOpenOutreach={openOutreach}
            onOpenBilling={() => openOverlay('billing')}
            onImportResume={() => {
              setOverlay(null)
              setView({ kind: 'import' })
            }}
            onBack={() => setOverlay(null)}
          />
        )}
        {overlay === 'keywords' && (
          <KeywordFinderPanel
            {...aiProps}
            resumes={resumes ?? []}
            onTailor={startTailoring}
            onImport={() => {
              setOverlay(null)
              setView({ kind: 'import' })
            }}
            onBack={() => setOverlay(null)}
          />
        )}
        {overlay === 'account' && !isOwner && (
          <AccountPanel email={email} onBack={() => setOverlay(null)} onOpenHistory={() => openOverlay('history')} />
        )}
      </main>

      {showSettings && isOwner && (
        <SettingsModal
          settings={settings}
          serverKeys={isOwner}
          platformAdmin={isOwner}
          focusPlatformAi={focusPlatformAi}
          onSave={(next) => {
            saveAISettings(next)
            setSettings(next)
            setShowSettings(false)
            setFocusPlatformAi(false)
          }}
          onClose={() => {
            setShowSettings(false)
            setFocusPlatformAi(false)
          }}
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

function NavButton({
  active,
  onClick,
  icon,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  icon?: React.ReactNode
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-sm font-bold rounded-[8px] border-[1.6px] transition-all ${
        active
          ? 'border-[var(--color-ink)] bg-[var(--color-yellow)] text-[#0a0a0a] shadow-[3px_3px_0_0_var(--color-ink)]'
          : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-ink)]'
      }`}
    >
      {icon && <span className="hidden sm:inline-flex">{icon}</span>}
      {children}
    </button>
  )
}

/** The first thing a new account sees: the three steps, and the button for the first one. */
function GettingStarted({ onImport }: { onImport: () => void }) {
  return (
    <div className="nb-card rounded-[10px] p-6 sm:p-10">
      <div className="text-center">
        <h2 className="text-2xl sm:text-3xl font-black">Tailor your resume in three steps</h2>
        <p className="mt-2 text-[var(--color-text-muted)]">Start by importing the resume you already have.</p>
      </div>
      <ol className="mt-8 grid gap-5 md:grid-cols-3">
        {STEPS.map(([title, detail], i) => (
          <li key={title} className="rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-sky-soft)] p-5">
            <div className="flex items-center gap-2">
              <span className="nb-badge w-9 h-9 bg-[var(--color-accent)]">{i + 1}.</span>
              <span className="nb-badge h-9 px-3 bg-[var(--color-yellow)] text-sm">{title}</span>
            </div>
            <p className="mt-4 text-sm text-[var(--color-text-muted)] leading-relaxed">{detail}</p>
          </li>
        ))}
      </ol>
      <div className="mt-8 text-center">
        <button onClick={onImport} className="nb-btn nb-btn-primary px-7 py-3.5 text-base">
          Import your resume <ArrowRight size={18} />
        </button>
      </div>
    </div>
  )
}

/**
 * Where the account stands, and that Pro can be had at any time: before the free
 * tailorings run out as much as after.
 */
function PlanStrip({ billing, onOpenBilling }: { billing: BillingStatus; onOpenBilling: () => void }) {
  const { runs, subscription } = billing
  if (subscription?.entitled) return null

  const pro = billing.tiers.pro
  const freeLeft = Math.max(0, runs.free.limit - runs.free.used)
  const offer = `${pro.label} gives you ${pro.runsPerCycle} tailorings a month for ${formatPrice(pro.pricePaise)}.`
  const [text, warn] =
    runs.left === 0
      ? [`You've used your ${runs.free.limit} free tailorings. Get ${pro.label} or a credit pack to keep tailoring.`, true]
      : freeLeft > 0
        ? [`${freeLeft} of your ${runs.free.limit} free tailorings left. ${offer} You can get it any time.`, false]
        : [`You have ${tailorings(runs.left)} left from credits. ${offer}`, false]

  return (
    <div
      className={`nb-card rounded-[10px] p-4 flex flex-wrap items-center justify-between gap-3 ${
        warn ? 'bg-[var(--color-error-highlight)]' : 'bg-[var(--color-yellow-soft)]'
      }`}
    >
      <p className="flex items-center gap-2.5 text-sm font-semibold">
        <span className="nb-badge w-8 h-8 shrink-0 bg-[var(--color-yellow)]">
          <Sparkles size={16} />
        </span>
        {text}
      </p>
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
  onFindKeywords,
}: {
  resumes: ResumeSummary[]
  disabled: boolean
  onStart: (resume: ResumeSummary, jobDescription: string) => void
  onFindKeywords: () => void
}) {
  const [resumeId, setResumeId] = useState(resumes[0].id)
  const [jobDescription, setJobDescription] = useState('')
  const resume = resumes.find((entry) => entry.id === resumeId) ?? resumes[0]
  const length = jobDescription.trim().length

  return (
    <section className="nb-card rounded-[10px] p-5 sm:p-6 space-y-4 bg-[var(--color-surface)]">
      <div className="flex items-start gap-3">
        <span className="nb-badge w-11 h-11 shrink-0 bg-[var(--color-accent)]">
          <Sparkles size={22} />
        </span>
        <div>
          <h2 className="text-xl sm:text-2xl font-black leading-tight">Tailor a resume to a job</h2>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Paste the job description. Next you choose how much should change, and nothing is applied until you approve it.
          </p>
        </div>
      </div>
      {resumes.length > 1 && (
        <label className="block">
          <span className="block text-sm font-bold mb-1.5">Resume</span>
          <select value={resume.id} onChange={(e) => setResumeId(e.target.value)} disabled={disabled} className={inputClass}>
            {resumes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        <span className="block text-sm font-bold mb-1.5">Job description</span>
        <textarea
          rows={9}
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          disabled={disabled}
          placeholder="Paste the full job post…"
          className={`${inputClass} resize-y leading-relaxed`}
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={onFindKeywords} className="text-sm font-bold underline underline-offset-4 decoration-2 hover:text-[var(--color-primary)]">
          Just want the keywords? Try the keyword finder
        </button>
        <button onClick={() => onStart(resume, jobDescription)} disabled={disabled || length < 80} className={primaryButton}>
          Next: choose how much to change <ArrowRight size={16} />
        </button>
      </div>
      {length > 0 && length < 80 && (
        <p className="text-xs font-semibold text-[var(--color-text-muted)]">Paste the whole job description: at least 80 characters.</p>
      )}
      {length === 0 && resumes.length === 1 && (
        <p className="text-xs text-[var(--color-text-muted)]">Tailors {resume.title}.</p>
      )}
    </section>
  )
}
