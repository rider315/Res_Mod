'use client'
import { useState, useCallback, useEffect } from 'react'
import { useSession, signOut } from 'next-auth/react'
import DiffViewer from './DiffViewer'
import StepIndicator from './StepIndicator'
import { AppState } from '@/types/resume'

const INITIAL_STATE: AppState = {
  step: 'input',
  resumeUrl: '',
  copiedDocId: null,
  copiedDocUrl: null,
  parsedResume: null,
  jobDescription: '',
  hardInstructions: '',
  softInstructions: '',
  optimizationResult: null,
  error: null,
}

function Spinner() {
  return (
    <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function AnimatedPhaseText({ phases }: { phases: string[] }) {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % phases.length), 2200)
    return () => clearInterval(t)
  }, [phases.length])
  return <p key={idx} className="text-sm text-[var(--color-text-muted)] anim-fade-in">{phases[idx]}</p>
}

function ParsingAnimation() {
  return (
    <div className="anim-page-enter flex flex-col items-center justify-center py-20 space-y-8">
      <div className="relative anim-float">
        <svg width="80" height="100" viewBox="0 0 80 100" fill="none">
          <rect x="4" y="4" width="72" height="92" rx="8" stroke="var(--color-primary)" strokeWidth="2" fill="var(--color-surface)" />
          <rect x="16" y="20" width="48" height="4" rx="2" fill="var(--color-primary-highlight)" />
          <rect x="16" y="32" width="40" height="4" rx="2" fill="var(--color-primary-highlight)" />
          <rect x="16" y="44" width="44" height="4" rx="2" fill="var(--color-primary-highlight)" />
          <rect x="16" y="56" width="36" height="4" rx="2" fill="var(--color-primary-highlight)" />
          <rect x="16" y="68" width="48" height="4" rx="2" fill="var(--color-primary-highlight)" />
        </svg>
        <div className="anim-scan-line" />
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold text-[var(--color-text)]">Preparing your resume</h2>
        <AnimatedPhaseText phases={['Copying document to workspace…', 'Scanning resume structure…', 'Extracting sections & content…', 'Almost ready…']} />
      </div>
      <div className="w-48 h-1.5 rounded-full bg-[var(--color-border)] overflow-hidden">
        <div className="h-full rounded-full anim-shimmer" style={{ width: '100%' }} />
      </div>
    </div>
  )
}

function AnalyzingAnimation() {
  return (
    <div className="anim-page-enter flex flex-col items-center justify-center py-20 space-y-8">
      <div className="flex items-center gap-6">
        <div className="relative anim-float" style={{ animationDelay: '0s' }}>
          <svg width="56" height="70" viewBox="0 0 56 70" fill="none">
            <rect x="2" y="2" width="52" height="66" rx="6" stroke="var(--color-primary)" strokeWidth="2" fill="var(--color-surface)" />
            <rect x="10" y="14" width="36" height="3" rx="1.5" fill="var(--color-primary-highlight)" />
            <rect x="10" y="22" width="28" height="3" rx="1.5" fill="var(--color-primary-highlight)" />
            <rect x="10" y="30" width="32" height="3" rx="1.5" fill="var(--color-primary-highlight)" />
          </svg>
          <p className="text-xs text-center text-[var(--color-text-muted)] mt-2 font-medium">Resume</p>
        </div>
        <div className="flex flex-col gap-1.5">
          {[0, 0.3, 0.6].map((d) => (
            <div key={d} className="w-2 h-2 rounded-full bg-[var(--color-primary)] anim-flow-dot" style={{ animationDelay: `${d}s` }} />
          ))}
        </div>
        <div className="relative anim-float" style={{ animationDelay: '0.5s' }}>
          <svg width="56" height="70" viewBox="0 0 56 70" fill="none">
            <rect x="2" y="2" width="52" height="66" rx="6" stroke="var(--color-gold)" strokeWidth="2" fill="var(--color-surface)" />
            <rect x="10" y="14" width="36" height="3" rx="1.5" fill="var(--color-gold-highlight)" />
            <rect x="10" y="22" width="30" height="3" rx="1.5" fill="var(--color-gold-highlight)" />
            <rect x="10" y="30" width="34" height="3" rx="1.5" fill="var(--color-gold-highlight)" />
          </svg>
          <p className="text-xs text-center text-[var(--color-text-muted)] mt-2 font-medium">Job Description</p>
        </div>
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold text-[var(--color-text)]">Analyzing with Gemini Pro</h2>
        <AnimatedPhaseText phases={['Reading job requirements…', 'Matching keywords to resume…', 'Generating section optimizations…', 'Refining suggestions…']} />
      </div>
      <div className="w-48 h-1.5 rounded-full bg-[var(--color-border)] overflow-hidden">
        <div className="h-full rounded-full anim-shimmer" style={{ width: '100%' }} />
      </div>
    </div>
  )
}

function MergeAnimation({ count }: { count: number }) {
  return (
    <div className="anim-page-enter flex flex-col items-center justify-center py-20 space-y-8">
      <div className="flex items-center gap-0">
        <div className="anim-merge-l">
          <svg width="48" height="60" viewBox="0 0 48 60" fill="none">
            <rect x="2" y="2" width="44" height="56" rx="5" stroke="var(--color-primary)" strokeWidth="2" fill="var(--color-surface)" />
            <rect x="10" y="12" width="28" height="3" rx="1.5" fill="var(--color-primary-highlight)" />
            <rect x="10" y="20" width="22" height="3" rx="1.5" fill="var(--color-primary-highlight)" />
          </svg>
        </div>
        <div className="anim-merge-r">
          <svg width="48" height="60" viewBox="0 0 48 60" fill="none">
            <rect x="2" y="2" width="44" height="56" rx="5" stroke="var(--color-success)" strokeWidth="2" fill="var(--color-surface)" />
            <rect x="10" y="12" width="28" height="3" rx="1.5" fill="var(--color-success-highlight)" />
            <rect x="10" y="20" width="22" height="3" rx="1.5" fill="var(--color-success-highlight)" />
          </svg>
        </div>
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold text-[var(--color-text)]">Merging changes</h2>
        <p className="text-sm text-[var(--color-text-muted)]">Applying {count} approved change{count !== 1 ? 's' : ''} to your document…</p>
      </div>
      <div className="w-48 h-1.5 rounded-full bg-[var(--color-border)] overflow-hidden">
        <div className="h-full rounded-full anim-shimmer" style={{ width: '100%' }} />
      </div>
    </div>
  )
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-3 bg-[var(--color-error-highlight)] border border-[var(--color-error)] rounded-xl p-4 text-sm text-[var(--color-error)]">
      <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
      </svg>
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss} className="opacity-60 hover:opacity-100">✕</button>
    </div>
  )
}

export default function Dashboard() {
  const { data: session } = useSession()
  const [state, setState] = useState<AppState>(INITIAL_STATE)
  const [loading, setLoading] = useState(false)
  // ✅ FIXED — always start with 'light' on server, detect on client via useEffect
const [themeMode, setThemeMode] = useState<'light' | 'dark'>('light')

useEffect(() => {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const theme = prefersDark ? 'dark' : 'light'
  setThemeMode(theme)
  document.documentElement.setAttribute('data-theme', theme)
}, [])

  function toggleTheme() {
    const next = themeMode === 'dark' ? 'light' : 'dark'
    setThemeMode(next)
    document.documentElement.setAttribute('data-theme', next)
  }

  function setError(error: string | null) {
    setState((s) => ({ ...s, error }))
  }

  async function handleLoadResume() {
    if (!state.resumeUrl.trim()) return
    setLoading(true)
    setError(null)
    setState((s) => ({ ...s, step: 'parsing' }))
    try {
      const copyRes = await fetch('/api/docs/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: state.resumeUrl }),
      })
      const copyData = await copyRes.json()
      if (!copyRes.ok) throw new Error(copyData.error)

      const parseRes = await fetch('/api/docs/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: copyData.copiedId }),
      })
      const parseData = await parseRes.json()
      if (!parseRes.ok) throw new Error(parseData.error)

      setState((s) => ({
        ...s,
        step: 'instructions',
        copiedDocId: copyData.copiedId,
        copiedDocUrl: copyData.copiedDocUrl,
        parsedResume: parseData.resume,
        error: null,
      }))
    } catch (err: any) {
      setState((s) => ({ ...s, step: 'input', error: err.message }))
    } finally {
      setLoading(false)
    }
  }

  async function handleOptimize() {
    if (!state.parsedResume || !state.jobDescription.trim()) return
    setLoading(true)
    setError(null)
    setState((s) => ({ ...s, step: 'optimizing' }))
    try {
      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resume: state.parsedResume,
          jobDescription: state.jobDescription,
          hardInstructions: state.hardInstructions,
          softInstructions: state.softInstructions,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setState((s) => ({ ...s, step: 'review', optimizationResult: data.result, error: null }))
    } catch (err: any) {
      setState((s) => ({ ...s, step: 'instructions', error: err.message }))
    } finally {
      setLoading(false)
    }
  }

  async function handleApplyChanges() {
    if (!state.copiedDocId || !state.optimizationResult) return
    setLoading(true)
    setError(null)
    setState((s) => ({ ...s, step: 'applying' }))
    try {
      const res = await fetch('/api/docs/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: state.copiedDocId,
          changes: state.optimizationResult.changes,
          companyName: state.optimizationResult.companyName,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setState((s) => ({ ...s, step: 'done', error: null }))
    } catch (err: any) {
      setState((s) => ({ ...s, step: 'review', error: err.message }))
    } finally {
      setLoading(false)
    }
  }

  function handleExportPdf() {
    if (!state.copiedDocId) return
    const a = document.createElement('a')
    a.href = `/api/docs/export?documentId=${state.copiedDocId}`
    a.download = 'optimized-resume.pdf'
    a.click()
  }

  const handleApprove = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      optimizationResult: s.optimizationResult
        ? { ...s.optimizationResult, changes: s.optimizationResult.changes.map((c) => c.id === id ? { ...c, approved: true } : c) }
        : null,
    }))
  }, [])

  const handleReject = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      optimizationResult: s.optimizationResult
        ? { ...s.optimizationResult, changes: s.optimizationResult.changes.map((c) => c.id === id ? { ...c, approved: false } : c) }
        : null,
    }))
  }, [])

  const handleApproveAll = useCallback(() => {
    setState((s) => ({
      ...s,
      optimizationResult: s.optimizationResult
        ? { ...s.optimizationResult, changes: s.optimizationResult.changes.map((c) => ({ ...c, approved: true })) }
        : null,
    }))
  }, [])

  const handleRejectAll = useCallback(() => {
    setState((s) => ({
      ...s,
      optimizationResult: s.optimizationResult
        ? { ...s.optimizationResult, changes: s.optimizationResult.changes.map((c) => ({ ...c, approved: false })) }
        : null,
    }))
  }, [])

  const approvedCount = state.optimizationResult?.changes.filter((c) => c.approved === true).length ?? 0

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <header className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <svg width="28" height="28" viewBox="0 0 52 52" fill="none" aria-label="ResMod">
            <rect x="1" y="1" width="50" height="50" rx="13" fill="var(--color-primary)" />
            <rect x="13" y="10" width="22" height="30" rx="3" fill="white" opacity="0.95" />
            <path d="M29 10 L35 16 L29 16 Z" fill="var(--color-primary)" opacity="0.3" />
            <rect x="17" y="19" width="14" height="2" rx="1" fill="var(--color-primary)" opacity="0.5" />
            <rect x="17" y="24" width="11" height="2" rx="1" fill="var(--color-primary)" opacity="0.35" />
            <rect x="17" y="29" width="14" height="2" rx="1" fill="var(--color-primary)" opacity="0.5" />
            <rect x="17" y="34" width="8" height="2" rx="1" fill="var(--color-primary)" opacity="0.35" />
            <g transform="translate(30, 28) rotate(-45)">
              <rect x="0" y="0" width="4" height="14" rx="1" fill="white" />
              <polygon points="0,14 4,14 2,18" fill="white" />
            </g>
          </svg>
          <span className="font-semibold text-[var(--color-text)] text-base">ResMod</span>
        </div>
        <StepIndicator currentStep={state.step} />
        <div className="flex items-center gap-3">
          <button onClick={toggleTheme} className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-offset)] transition-all" aria-label="Toggle theme">
            {themeMode === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          {session?.user?.image ? (
            <img src={session.user.image} alt={session.user.name ?? ''} width="28" height="28" className="rounded-full" />
          ) : session?.user?.name ? (
            <div className="w-7 h-7 rounded-full bg-[var(--color-primary)] text-white text-xs font-semibold flex items-center justify-center flex-shrink-0">
              {session.user.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
            </div>
          ) : null}
          <span className="text-sm text-[var(--color-text-muted)] hidden sm:inline truncate max-w-[120px]">{session?.user?.name}</span>
          <button onClick={() => signOut({ callbackUrl: '/' })} className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-colors">
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {state.error && <ErrorBanner message={state.error} onDismiss={() => setError(null)} />}

        {state.step === 'parsing' && <ParsingAnimation />}

        {state.step === 'input' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">Optimize your resume</h1>
              <p className="text-sm text-[var(--color-text-muted)]">Paste your Google Docs resume link. A copy is created — your original is never modified.</p>
            </div>
            <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-6 space-y-4">
              <label className="block">
                <span className="text-sm font-semibold text-[var(--color-text)] mb-2 block">Google Docs Resume URL</span>
                <input type="url" placeholder="https://docs.google.com/document/d/..." value={state.resumeUrl} onChange={(e) => setState((s) => ({ ...s, resumeUrl: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && handleLoadResume()}
                  className="w-full px-4 py-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-all" />
              </label>
              <button onClick={handleLoadResume} disabled={loading || !state.resumeUrl.trim()}
                className="w-full py-3 px-6 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-sm hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
                Load Resume →
              </button>
            </div>
            <div className="rounded-xl bg-[var(--color-primary-highlight)] border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)] flex gap-3">
              <svg className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--color-primary)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
              All edits go to the copy only. Make sure your document is accessible by your Google account.
            </div>
          </div>
        )}

        {state.step === 'optimizing' && <AnalyzingAnimation />}

        {state.step === 'instructions' && state.parsedResume && (
          <div className="space-y-6 anim-page-enter">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">Define your optimization goals</h1>
                <p className="text-sm text-[var(--color-text-muted)]">
                  Loaded: <span className="font-medium text-[var(--color-text)]">{state.parsedResume.title}</span> — {state.parsedResume.sections.length} sections detected
                </p>
              </div>
              <a href={state.copiedDocUrl ?? '#'} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--color-primary)] hover:underline">Open copy ↗</a>
            </div>
            <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4">
              <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-3">Detected Sections</p>
              <div className="flex flex-wrap gap-2">
                {state.parsedResume.sections.map((s) => (
                  <span key={s.id} className="text-xs px-2.5 py-1 rounded-full bg-[var(--color-primary-highlight)] text-[var(--color-primary)] font-medium">{s.title}</span>
                ))}
              </div>
            </div>
            <div className="space-y-4">
              <label className="block">
                <span className="text-sm font-semibold text-[var(--color-text)] mb-1.5 block">Job Description *</span>
                <span className="text-xs text-[var(--color-text-muted)] block mb-2">Paste the full job posting. Gemini will extract keywords automatically.</span>
                <textarea rows={6} placeholder="We are looking for a Senior Software Engineer with React, Node.js, AWS..." value={state.jobDescription} onChange={(e) => setState((s) => ({ ...s, jobDescription: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] resize-y transition-all" />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-sm font-semibold text-[var(--color-text)] mb-1.5 block">Hard Instructions</span>
                  <span className="text-xs text-[var(--color-text-muted)] block mb-2">Rules Gemini must never break.</span>
                  <textarea rows={4} placeholder={"Do not modify the Google role\nDo not remove Education section\nDo not add fake experience"} value={state.hardInstructions} onChange={(e) => setState((s) => ({ ...s, hardInstructions: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] resize-y transition-all" />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-[var(--color-text)] mb-1.5 block">Soft Instructions</span>
                  <span className="text-xs text-[var(--color-text-muted)] block mb-2">Optimization preferences.</span>
                  <textarea rows={4} placeholder={"Use action verbs (Built, Led, Designed)\nAdd measurable impact\nAlign with React & TypeScript keywords"} value={state.softInstructions} onChange={(e) => setState((s) => ({ ...s, softInstructions: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] resize-y transition-all" />
                </label>
              </div>
            </div>
            <button onClick={handleOptimize} disabled={loading || !state.jobDescription.trim()}
              className="w-full py-3 px-6 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-sm hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
              Generate Optimizations →
            </button>
          </div>
        )}

        {state.step === 'applying' && <MergeAnimation count={approvedCount} />}

        {state.step === 'review' && state.optimizationResult && (
          <div className="space-y-6 anim-page-enter">
            <div>
              <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">Review proposed changes</h1>
              <p className="text-sm text-[var(--color-text-muted)]">Approve or reject each suggestion. Only approved changes will be written to your document.</p>
            </div>
            <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4 space-y-3">
              <p className="text-sm text-[var(--color-text)]">{state.optimizationResult.summary}</p>
              {state.optimizationResult.keywordsAdded.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-1.5">Keywords aligned</p>
                  <div className="flex flex-wrap gap-1.5">
                    {state.optimizationResult.keywordsAdded.map((kw) => (
                      <span key={kw} className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-primary-highlight)] text-[var(--color-primary)] font-medium">{kw}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DiffViewer changes={state.optimizationResult.changes} onApprove={handleApprove} onReject={handleReject} onApproveAll={handleApproveAll} onRejectAll={handleRejectAll} />
            <div className="sticky bottom-4 bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-lg p-4 flex items-center justify-between">
              <p className="text-sm text-[var(--color-text-muted)]">
                <span className="font-semibold text-[var(--color-text)]">{approvedCount}</span> change{approvedCount !== 1 ? 's' : ''} approved
              </p>
              <button onClick={handleApplyChanges} disabled={loading || approvedCount === 0}
                className="py-2.5 px-6 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-sm hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2">
                {`Apply ${approvedCount} Change${approvedCount !== 1 ? 's' : ''} →`}
              </button>
            </div>
          </div>
        )}

        {/* Step 4 — Enhanced Done */}
        {state.step === 'done' && (
          <div className="space-y-8 text-center py-12 anim-page-enter relative">
            {/* Confetti */}
            <div className="confetti-container">
              {Array.from({ length: 20 }).map((_, i) => (
                <div key={i} className="confetti-particle" style={{
                  left: `${5 + Math.random() * 90}%`,
                  backgroundColor: ['#01696f','#437a22','#d19900','#7a39bb','#006494'][i % 5],
                  animationDelay: `${Math.random() * 0.8}s`,
                  animationDuration: `${1.2 + Math.random() * 0.8}s`,
                  width: `${4 + Math.random() * 4}px`,
                  height: `${4 + Math.random() * 4}px`,
                  borderRadius: Math.random() > 0.5 ? '50%' : '1px',
                }} />
              ))}
            </div>

            {/* Animated checkmark */}
            <div className="w-20 h-20 rounded-full bg-[var(--color-success-highlight)] flex items-center justify-center mx-auto anim-circle-pop">
              <svg className="w-10 h-10 text-[var(--color-success)]" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" className="anim-check-draw" />
              </svg>
            </div>

            <div>
              <h1 className="text-2xl font-bold text-[var(--color-text)] mb-2">Resume optimized!</h1>
              <p className="text-sm text-[var(--color-text-muted)]">Your changes have been merged into the copied document.</p>
            </div>

            {/* Stats */}
            {state.optimizationResult && (
              <div className="flex justify-center gap-6">
                <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] px-5 py-3 text-center">
                  <p className="text-2xl font-bold text-[var(--color-primary)]">{state.optimizationResult.sectionsModified.length}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">Sections</p>
                </div>
                <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] px-5 py-3 text-center">
                  <p className="text-2xl font-bold text-[var(--color-success)]">{approvedCount}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">Changes</p>
                </div>
                <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] px-5 py-3 text-center">
                  <p className="text-2xl font-bold text-[var(--color-gold)]">{state.optimizationResult.keywordsAdded.length}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">Keywords</p>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <a href={state.copiedDocUrl ?? '#'} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-sm hover:bg-[var(--color-primary-hover)] transition-all shadow-md hover:shadow-lg">
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                Open in Google Docs
              </a>
              <button onClick={handleExportPdf}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-[var(--color-border)] text-[var(--color-text)] font-semibold text-sm hover:bg-[var(--color-surface-offset)] transition-all">
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Export as PDF
              </button>
            </div>
            <button onClick={() => setState(INITIAL_STATE)} className="text-sm text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] font-medium transition-colors">
              ← Optimize another resume
            </button>
          </div>
        )}
      </main>
    </div>
  )
}