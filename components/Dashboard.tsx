'use client'
import { useState, useCallback, useEffect } from 'react'
import { useSession, signOut } from 'next-auth/react'
import DiffViewer from './DiffViewer'
import StepIndicator from './StepIndicator'
import SettingsModal from './SettingsModal'
import LatexPreview from './LatexPreview'
import { AppState, OptimizationResult } from '@/types/resume'
import { AISettings, DEFAULT_AI_SETTINGS, loadAISettings, saveAISettings } from '@/lib/settings-storage'
import { getProvider } from '@/lib/providers'
import { DEFAULT_PROFILE_ID, getProfile, PROFILES, PROFILE_ORDER } from '@/lib/profiles'
import { ResumeProfileId } from '@/lib/profiles/types'
import { buildResumeFileName } from '@/lib/resume-filename'

const INITIAL_STATE: AppState = {
  step: 'input',
  profileId: DEFAULT_PROFILE_ID,
  latexSource: null,
  optimizedLatex: null,
  parsedResume: null,
  jobDescription: '',
  hardInstructions: '',
  softInstructions: '',
  optimizationResult: null,
  error: null,
  applyWarning: null,
  aiProvider: DEFAULT_AI_SETTINGS.provider,
  aiApiKeys: { ...DEFAULT_AI_SETTINGS.apiKeys },
  aiModels: { ...DEFAULT_AI_SETTINGS.models },
  showSettings: false,
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
        <h2 className="text-xl font-bold text-[var(--color-text)]">Reading your LaTeX resume</h2>
        <AnimatedPhaseText phases={['Loading the .tex source…', 'Walking the document tree…', 'Mapping editable bullets…', 'Almost ready…']} />
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
        <h2 className="text-xl font-bold text-[var(--color-text)]">Extracting ATS Keywords</h2>
        <AnimatedPhaseText phases={['Extracting keywords from JD…', 'Matching keywords to resume…', 'Rewriting experience bullets…', 'Injecting missing ATS keywords…', 'Refining suggestions…']} />
      </div>
      <div className="w-48 h-1.5 rounded-full bg-[var(--color-border)] overflow-hidden">
        <div className="h-full rounded-full anim-shimmer" style={{ width: '100%' }} />
      </div>
    </div>
  )
}

function RevampingAnimation() {
  return (
    <div className="anim-page-enter flex flex-col items-center justify-center py-20 space-y-8">
      <div className="flex items-center gap-6">
        <div className="relative anim-float" style={{ animationDelay: '0s' }}>
          <svg width="56" height="70" viewBox="0 0 56 70" fill="none">
            <rect x="2" y="2" width="52" height="66" rx="6" stroke="var(--color-error)" strokeWidth="2" fill="var(--color-surface)" />
            <rect x="10" y="14" width="36" height="3" rx="1.5" fill="var(--color-error)" opacity="0.3" />
            <rect x="10" y="22" width="28" height="3" rx="1.5" fill="var(--color-error)" opacity="0.3" />
            <rect x="10" y="30" width="32" height="3" rx="1.5" fill="var(--color-error)" opacity="0.3" />
          </svg>
          <p className="text-xs text-center text-[var(--color-text-muted)] mt-2 font-medium">Resume</p>
        </div>
        <div className="flex flex-col gap-1.5">
          {[0, 0.15, 0.3, 0.45, 0.6].map((d) => (
            <div key={d} className="w-2 h-2 rounded-full bg-[var(--color-error)] anim-flow-dot" style={{ animationDelay: `${d}s` }} />
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
        <h2 className="text-xl font-bold text-[var(--color-text)]">🔥 Full ATS Revamp in Progress</h2>
        <AnimatedPhaseText phases={['Extracting all JD keywords…', 'Rewriting every experience bullet…', 'Saturating with ATS keywords…', 'Swapping skills to match JD…', 'Finalizing aggressive rewrites…']} />
      </div>
      <div className="w-48 h-1.5 rounded-full bg-[var(--color-border)] overflow-hidden">
        <div className="h-full rounded-full anim-shimmer" style={{ width: '100%', background: 'linear-gradient(90deg, var(--color-error), var(--color-gold), var(--color-error))' }} />
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
        <h2 className="text-xl font-bold text-[var(--color-text)]">Splicing changes into LaTeX</h2>
        <p className="text-sm text-[var(--color-text-muted)]">Writing {count} approved change{count !== 1 ? 's' : ''} into a copy of your .tex…</p>
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
      <span className="flex-1 whitespace-pre-wrap">{message}</span>
      <button onClick={onDismiss} className="opacity-60 hover:opacity-100">✕</button>
    </div>
  )
}

/** Save a string to the user's machine as a file. */
function downloadText(text: string, fileName: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Hand the .tex to Overleaf, which compiles it into a new project.
 *
 * Overleaf takes the document as a POST field rather than a query parameter,
 * so this builds a real form instead of a link — a resume is far too long to
 * survive a URL.
 */
function openInOverleaf(latex: string) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = 'https://www.overleaf.com/docs'
  form.target = '_blank'
  form.rel = 'noopener noreferrer'

  for (const [name, value] of [['snip', latex], ['engine', 'pdflatex']]) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.appendChild(input)
  }

  document.body.appendChild(form)
  form.submit()
  document.body.removeChild(form)
}

export default function Dashboard() {
  const { data: session } = useSession()
  const [state, setState] = useState<AppState>(INITIAL_STATE)
  const [loading, setLoading] = useState(false)
  const [compiling, setCompiling] = useState(false)
  const [compileHost, setCompileHost] = useState('texlive.net')
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const theme = prefersDark ? 'dark' : 'light'
    setThemeMode(theme)
    document.documentElement.setAttribute('data-theme', theme)

    const ai = loadAISettings()
    const savedProfile = localStorage.getItem('resmod_profile') as ResumeProfileId | null

    setState((s) => ({
      ...s,
      profileId: savedProfile && PROFILE_ORDER.includes(savedProfile) ? savedProfile : s.profileId,
      aiProvider: ai.provider,
      aiApiKeys: ai.apiKeys,
      aiModels: ai.models,
    }))
  }, [])

  const activeProfile = getProfile(state.profileId)
  const companyName = state.optimizationResult?.companyName || 'Company'
  const baseFileName = buildResumeFileName(activeProfile.personName, companyName)

  function setActiveProfile(id: ResumeProfileId) {
    localStorage.setItem('resmod_profile', id)
    // Switching resumes invalidates anything parsed from the previous one.
    setState((s) => ({
      ...s,
      profileId: id,
      step: 'input',
      latexSource: null,
      optimizedLatex: null,
      parsedResume: null,
      optimizationResult: null,
      error: null,
      applyWarning: null,
    }))
  }

  function toggleTheme() {
    const next = themeMode === 'dark' ? 'light' : 'dark'
    setThemeMode(next)
    document.documentElement.setAttribute('data-theme', next)
  }

  function setError(error: string | null) {
    setState((s) => ({ ...s, error }))
  }

  function handleSaveSettings(next: AISettings) {
    saveAISettings(next)
    setState((s) => ({
      ...s,
      aiProvider: next.provider,
      aiApiKeys: next.apiKeys,
      aiModels: next.models,
      showSettings: false,
    }))
  }

  /**
   * Run one AI pass.
   *
   * Every provider except Puter goes through our API route. Puter has no API key
   * and only works from the browser, so for that one we build the prompt, call
   * puter.ai.chat, and parse the result entirely client-side.
   */
  async function runAIPass(mode: 'optimize' | 'revamp'): Promise<OptimizationResult> {
    const provider = state.aiProvider
    const model = state.aiModels[provider]

    if (getProvider(provider).clientSide) {
      const [{ generatePuterResponse }, { runOptimization }] = await Promise.all([
        import('@/lib/puter'),
        import('@/lib/run-optimization'),
      ])

      return runOptimization({
        mode,
        profile: activeProfile,
        resume: state.parsedResume!,
        jobDescription: state.jobDescription,
        hardInstructions: state.hardInstructions,
        softInstructions: state.softInstructions,
        provider,
        model,
        generate: ({ systemInstruction, prompt, temperature }) =>
          generatePuterResponse({ systemInstruction, prompt, temperature, model }),
      })
    }

    const res = await fetch(mode === 'optimize' ? '/api/optimize' : '/api/revamp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resume: state.parsedResume,
        jobDescription: state.jobDescription,
        hardInstructions: state.hardInstructions,
        softInstructions: state.softInstructions,
        provider,
        apiKey: state.aiApiKeys[provider],
        model,
        profileId: state.profileId,
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    return data.result
  }

  async function handleLoadResume() {
    setLoading(true)
    setError(null)
    setState((s) => ({ ...s, step: 'parsing' }))
    try {
      const res = await fetch('/api/resume/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: state.profileId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      if (data.compileHost) setCompileHost(data.compileHost)
      setState((s) => ({
        ...s,
        step: 'instructions',
        latexSource: data.latex,
        parsedResume: data.resume,
        error: null,
      }))
    } catch (err: unknown) {
      setState((s) => ({ ...s, step: 'input', error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setLoading(false)
    }
  }

  async function runPass(mode: 'optimize' | 'revamp') {
    if (!state.parsedResume || !state.jobDescription.trim()) return
    setLoading(true)
    setError(null)
    setState((s) => ({ ...s, step: mode === 'optimize' ? 'optimizing' : 'revamping' }))
    try {
      const result = await runAIPass(mode)
      setState((s) => ({ ...s, step: 'review', optimizationResult: result, error: null }))
    } catch (err: unknown) {
      setState((s) => ({ ...s, step: 'instructions', error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setLoading(false)
    }
  }

  async function handleApplyChanges() {
    if (!state.optimizationResult) return
    setLoading(true)
    setError(null)
    setState((s) => ({ ...s, step: 'applying' }))
    try {
      const res = await fetch('/api/resume/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId: state.profileId,
          changes: state.optimizationResult.changes,
          companyName: state.optimizationResult.companyName,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      // Three distinct ways a change can fail to land, each worth naming: text
      // that no longer matches a bullet, a change overlapping another rewrite,
      // and LaTeX the sanitizer refused to write.
      const notes: string[] = []
      const missed = Array.isArray(data.unmatched) ? data.unmatched.length : 0
      const overlapped = Array.isArray(data.overlapping) ? data.overlapping.length : 0
      const rejected = Array.isArray(data.rejected) ? data.rejected.length : 0

      if (missed > 0) {
        notes.push(`${missed} change${missed === 1 ? '' : 's'} no longer matched any bullet in the .tex, so ${missed === 1 ? 'it was' : 'they were'} skipped.`)
      }
      if (overlapped > 0) {
        notes.push(`${overlapped} change${overlapped === 1 ? '' : 's'} targeted a bullet another rewrite already covered.`)
      }
      if (rejected > 0) {
        const reasons = data.rejected.map((r: { reason: string }) => r.reason).join('; ')
        notes.push(`${rejected} change${rejected === 1 ? '' : 's'} produced invalid LaTeX and ${rejected === 1 ? 'was' : 'were'} refused (${reasons}).`)
      }

      setState((s) => ({
        ...s,
        step: 'done',
        optimizedLatex: data.latex,
        error: null,
        applyWarning: notes.length
          ? `${data.appliedCount} of ${data.requestedCount} changes applied. ${notes.join(' ')}`
          : null,
      }))
    } catch (err: unknown) {
      setState((s) => ({ ...s, step: 'review', error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setLoading(false)
    }
  }

  function handleDownloadTex() {
    const latex = state.optimizedLatex ?? state.latexSource
    if (!latex) return
    downloadText(latex, `${baseFileName}.tex`, 'application/x-tex')
  }

  async function handleCompilePdf() {
    const latex = state.optimizedLatex ?? state.latexSource
    if (!latex) return
    setCompiling(true)
    setError(null)
    try {
      const res = await fetch('/api/resume/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latex, fileName: baseFileName }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.log ? `${data.error}\n\n${data.log}` : data.error)
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${baseFileName}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCompiling(false)
    }
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

  // Header label so the active provider/model is visible without opening Settings.
  const activeProvider = getProvider(state.aiProvider)
  const activeModel = state.aiModels[state.aiProvider]
  const activeModelLabel = activeModel
    ? `${activeProvider.emoji} ${activeModel.split('/').pop()?.replace(':free', '') ?? activeModel}`
    : `${activeProvider.emoji} ${activeProvider.label}`

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
          <button
            onClick={() => setState((s) => ({ ...s, showSettings: true }))}
            className="h-8 px-2 flex items-center gap-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-offset)] transition-all"
            aria-label="AI Settings"
            title={`AI: ${activeModelLabel}`}
          >
            <span className="text-xs font-medium hidden md:inline max-w-[140px] truncate">{activeModelLabel}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
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
            // eslint-disable-next-line @next/next/no-img-element
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
              <p className="text-sm text-[var(--color-text-muted)]">
                Pick whose resume to tailor. The LaTeX source lives in this project — the optimizer reads it and
                writes a tailored copy, never touching the original.
              </p>
            </div>

            {/* Whose resume — each has its own layout rules and its own .tex */}
            <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-6 space-y-3">
              <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Whose resume</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {PROFILE_ORDER.map((id) => {
                  const p = PROFILES[id]
                  const selected = state.profileId === id
                  return (
                    <button
                      key={id}
                      onClick={() => setActiveProfile(id)}
                      className={`text-left p-3 rounded-xl border transition-all ${
                        selected
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary-highlight)] ring-1 ring-[var(--color-primary)]'
                          : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-[var(--color-text)]">{p.label}</p>
                        <code className="text-[10px] text-[var(--color-text-faint)] font-mono">resumes/{p.texFile}</code>
                      </div>
                      <p className="text-[11px] text-[var(--color-text-muted)] leading-snug mt-0.5">{p.description}</p>
                    </button>
                  )
                })}
              </div>
              <button onClick={handleLoadResume} disabled={loading}
                className="w-full py-3 px-6 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-sm hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
                Load {activeProfile.label}&apos;s Resume →
              </button>
            </div>

            <div className="rounded-xl bg-[var(--color-primary-highlight)] border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)] flex gap-3">
              <svg className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--color-primary)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
              <span>
                To change the base resume itself, edit <code className="font-mono text-xs">resumes/{activeProfile.texFile}</code> and
                reload. Keep prose inside <code className="font-mono text-xs">\resumeItem&#123;&#125;</code>,{' '}
                <code className="font-mono text-xs">\skillLine&#123;&#125;</code> and{' '}
                <code className="font-mono text-xs">\resumeSummary&#123;&#125;</code> so the optimizer can see it.
              </span>
            </div>
          </div>
        )}

        {state.step === 'optimizing' && <AnalyzingAnimation />}
        {state.step === 'revamping' && <RevampingAnimation />}

        {state.step === 'instructions' && state.parsedResume && (
          <div className="space-y-6 anim-page-enter">
            <div>
              <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">Define your optimization goals</h1>
              <p className="text-sm text-[var(--color-text-muted)]">
                Loaded <code className="font-mono text-xs">resumes/{activeProfile.texFile}</code> — {state.parsedResume.sections.length} sections detected
              </p>
            </div>
            <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4">
              <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-3">Detected Sections</p>
              <div className="flex flex-wrap gap-2">
                {state.parsedResume.sections.map((s) => (
                  <span key={s.id} className="text-xs px-2.5 py-1 rounded-full bg-[var(--color-primary-highlight)] text-[var(--color-primary)] font-medium">{s.title}</span>
                ))}
              </div>
            </div>
            {state.latexSource && <LatexPreview latex={state.latexSource} title="Current LaTeX source" />}
            <div className="space-y-4">
              <label className="block">
                <span className="text-sm font-semibold text-[var(--color-text)] mb-1.5 block">Job Description *</span>
                <span className="text-xs text-[var(--color-text-muted)] block mb-2">Paste the full job posting. The AI will extract keywords automatically.</span>
                <textarea rows={6} placeholder="We are looking for a Forward Deployed Engineer with Python, LLMs, RAG, React..." value={state.jobDescription} onChange={(e) => setState((s) => ({ ...s, jobDescription: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] resize-y transition-all" />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-sm font-semibold text-[var(--color-text)] mb-1.5 block">Hard Instructions</span>
                  <span className="text-xs text-[var(--color-text-muted)] block mb-2">Rules the AI must never break.</span>
                  <textarea rows={4} placeholder={'Do not modify the Innodata role\nDo not remove the IEEE publication\nDo not add fake experience'} value={state.hardInstructions} onChange={(e) => setState((s) => ({ ...s, hardInstructions: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] resize-y transition-all" />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-[var(--color-text)] mb-1.5 block">Soft Instructions</span>
                  <span className="text-xs text-[var(--color-text-muted)] block mb-2">Optimization preferences.</span>
                  <textarea rows={4} placeholder={'Use action verbs (Built, Led, Designed)\nAdd measurable impact\nLead with RAG and LLM evaluation'} value={state.softInstructions} onChange={(e) => setState((s) => ({ ...s, softInstructions: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] resize-y transition-all" />
                </label>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button onClick={() => runPass('optimize')} disabled={loading || !state.jobDescription.trim()}
                className="w-full py-3 px-6 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-sm hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
                Generate Optimizations →
              </button>
              <button onClick={() => runPass('revamp')} disabled={loading || !state.jobDescription.trim()}
                className="w-full py-3 px-6 rounded-xl font-semibold text-sm text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]"
                style={{ background: 'linear-gradient(135deg, #e8450e 0%, #f59e0b 100%)' }}>
                🔥 Full Revamp
              </button>
            </div>
            <p className="text-xs text-[var(--color-text-faint)] text-center">
              <strong>ATS Optimize</strong> = keyword extraction + experience rewriting &nbsp;|&nbsp; <strong>Full ATS Revamp</strong> = aggressive rewrite of ALL bullets to match JD
            </p>
          </div>
        )}

        {state.step === 'applying' && <MergeAnimation count={approvedCount} />}

        {state.step === 'review' && state.optimizationResult && (
          <div className="space-y-6 anim-page-enter">
            <div>
              <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">Review proposed changes</h1>
              <p className="text-sm text-[var(--color-text-muted)]">Approve or reject each suggestion. Only approved changes are written into the LaTeX.</p>
            </div>
            <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4 space-y-3">
              <p className="text-sm text-[var(--color-text)]">{state.optimizationResult.summary}</p>
              {(state.optimizationResult.unevidencedSkills?.length ?? 0) > 0 && (
                <div className="rounded-xl border border-[var(--color-warning)] bg-[var(--color-warning-highlight)] p-3">
                  <p className="text-xs font-semibold text-[var(--color-warning)] mb-1.5">
                    Claimed in Skills, but no bullet backs them up
                  </p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {state.optimizationResult.unevidencedSkills!.map((kw) => (
                      <span key={kw} className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-surface)] text-[var(--color-warning)] font-medium">
                        {kw}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-[var(--color-text-muted)] leading-snug">
                    The job asks for these, but nothing in this resume demonstrates them, so they were not written
                    into any experience or project bullet. Listing them in Skills alone may not survive a recruiter
                    read — consider rejecting the Skills change, or adding real work that shows them.
                  </p>
                </div>
              )}
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

        {state.step === 'done' && (
          <div className="space-y-8 anim-page-enter relative">
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

            <div className="text-center space-y-6">
              <div className="w-20 h-20 rounded-full bg-[var(--color-success-highlight)] flex items-center justify-center mx-auto anim-circle-pop">
                <svg className="w-10 h-10 text-[var(--color-success)]" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" className="anim-check-draw" />
                </svg>
              </div>

              <div>
                <h1 className="text-2xl font-bold text-[var(--color-text)] mb-2">Resume optimized!</h1>
                <p className="text-sm text-[var(--color-text-muted)]">
                  Your changes are spliced into a tailored copy of the LaTeX. <code className="font-mono text-xs">resumes/{activeProfile.texFile}</code> is untouched.
                </p>
              </div>

              {state.applyWarning && (
                <div className="max-w-xl mx-auto flex items-start gap-3 rounded-xl border border-[var(--color-warning)] bg-[var(--color-warning-highlight)] p-4 text-left text-sm text-[var(--color-warning)]">
                  <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>{state.applyWarning}</span>
                </div>
              )}

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
                <button onClick={handleDownloadTex}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-sm hover:bg-[var(--color-primary-hover)] transition-all shadow-md hover:shadow-lg">
                  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download .tex
                </button>
                <button onClick={() => state.optimizedLatex && openInOverleaf(state.optimizedLatex)}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-[var(--color-border)] text-[var(--color-text)] font-semibold text-sm hover:bg-[var(--color-surface-offset)] transition-all">
                  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  Open in Overleaf
                </button>
                <button onClick={handleCompilePdf} disabled={compiling}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-[var(--color-border)] text-[var(--color-text)] font-semibold text-sm hover:bg-[var(--color-surface-offset)] disabled:opacity-50 transition-all">
                  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                  </svg>
                  {compiling ? 'Compiling…' : 'Compile PDF'}
                </button>
              </div>

              <p className="text-[11px] text-[var(--color-text-faint)] max-w-xl mx-auto">
                <strong>Download .tex</strong> keeps everything on your machine. <strong>Open in Overleaf</strong> and{' '}
                <strong>Compile PDF</strong> send the document to overleaf.com and {compileHost} respectively to be typeset.
              </p>
            </div>

            {state.optimizedLatex && (
              <LatexPreview latex={state.optimizedLatex} title="Optimized LaTeX source" defaultOpen />
            )}

            <div className="text-center">
              <button onClick={() => setState({ ...INITIAL_STATE, profileId: state.profileId })} className="text-sm text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] font-medium transition-colors">
                ← Optimize for another job
              </button>
            </div>
          </div>
        )}

        {state.showSettings && (
          <SettingsModal
            settings={{
              provider: state.aiProvider,
              apiKeys: state.aiApiKeys,
              models: state.aiModels,
            }}
            onSave={handleSaveSettings}
            onClose={() => setState((s) => ({ ...s, showSettings: false }))}
          />
        )}
      </main>
    </div>
  )
}
