'use client'
import { useRef, useState } from 'react'
import AiAllowance from '@/components/user/AiAllowance'
import { ArrowLeft, ArrowRight, CheckCircle, FileText, Upload } from '@/components/brand/Icons'
import { ApiError, readApiError } from '@/components/user/billing-client'
import { AISettings } from '@/lib/settings-storage'
import { getProvider } from '@/lib/providers'
import { BILLING_CODES, BillingStatus } from '@/lib/billing/types'
import { MAX_UPLOAD_BYTES, ResumeDoc, SourceFormat } from '@/lib/resume-doc'
import { backLinkClass, cardClass, errorBox, inputClass, primaryButton } from '@/components/user/shared'

/**
 * Importing a resume: a file or pasted text, turned into a structured resume.
 *
 * Text extraction always runs on the server. Structuring runs on Chills AI, free
 * within a monthly import limit. The owner uses their own AI settings instead:
 * through /api/import/structure for key-based providers, or entirely in the
 * browser for Puter.
 */

interface ImportPanelProps {
  /** The owner runs on their own AI settings; everyone else on Chills AI. */
  isOwner: boolean
  settings: AISettings
  /** undefined while loading; null when it couldn't be loaded, and always for the owner. */
  billing: BillingStatus | null | undefined
  onOpenSettings: () => void
  onOpenBilling: () => void
  onBillingChanged: () => void
  onQuotaExhausted: () => void
  onImported: (doc: ResumeDoc, sourceFormat: SourceFormat) => void
  onCancel: () => void
}

type Phase = 'idle' | 'reading' | 'structuring'

export default function ImportPanel({
  isOwner,
  settings,
  billing,
  onOpenSettings,
  onOpenBilling,
  onBillingChanged,
  onQuotaExhausted,
  onImported,
  onCancel,
}: ImportPanelProps) {
  const [mode, setMode] = useState<'file' | 'paste'>('file')
  const [file, setFile] = useState<File | null>(null)
  const [pasted, setPasted] = useState('')
  const [dragging, setDragging] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const provider = getProvider(settings.provider)
  const model = settings.models[settings.provider]
  const checkingRuns = !isOwner && billing === undefined
  const needsKey = isOwner && provider.needsKey && !settings.apiKeys[settings.provider]?.trim()
  const aiOff = !isOwner && Boolean(billing) && !billing?.platformAi
  const busy = phase !== 'idle'
  const ready = mode === 'file' ? Boolean(file) : pasted.trim().length > 0

  function pick(selected: File | undefined) {
    setError(null)
    if (!selected) return
    if (selected.size > MAX_UPLOAD_BYTES) {
      setError('Resumes must be smaller than 4 MB.')
      return
    }
    setFile(selected)
  }

  async function readText(): Promise<{ text: string; sourceFormat: SourceFormat }> {
    if (mode === 'paste') {
      const text = pasted.trim()
      if (text.length < 40) throw new Error('That is too little text to be a resume. Paste the whole thing.')
      return { text, sourceFormat: 'text' }
    }
    if (!file) throw new Error('Choose a resume file first.')

    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/import/extract', { method: 'POST', body: form })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'That file could not be read.')
    return { text: data.text, sourceFormat: data.sourceFormat }
  }

  async function structure(text: string): Promise<ResumeDoc> {
    if (isOwner && provider.clientSide) {
      const [{ generatePuterResponse }, { structureResume }] = await Promise.all([
        import('@/lib/puter'),
        import('@/lib/import/structure'),
      ])
      return structureResume({
        text,
        generate: ({ systemInstruction, prompt, temperature }) =>
          generatePuterResponse({ systemInstruction, prompt, temperature, model }),
      })
    }

    // Regular accounts always run on Chills AI, so only the owner sends AI settings.
    const ai = isOwner ? { provider: settings.provider, apiKey: settings.apiKeys[settings.provider], model } : {}
    const res = await fetch('/api/import/structure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, ...ai }),
    })
    if (!res.ok) throw await readApiError(res, 'The AI could not read this resume.')
    const data = await res.json()
    return data.doc
  }

  async function run() {
    setError(null)
    try {
      setPhase('reading')
      const { text, sourceFormat } = await readText()
      setPhase('structuring')
      const doc = await structure(text)
      onImported(doc, sourceFormat)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      if (err instanceof ApiError && err.code === BILLING_CODES.importLimit) onQuotaExhausted()
    } finally {
      setPhase('idle')
      if (!isOwner) onBillingChanged()
    }
  }

  return (
    <div className="space-y-8 anim-page-enter">
      <div>
        <button onClick={onCancel} disabled={busy} className={backLinkClass}>
          <ArrowLeft size={16} /> Your resumes
        </button>
        <h1 className="mt-3 text-4xl sm:text-5xl font-black tracking-tight">
          Import your <span className="nb-highlight">resume</span>
        </h1>
        <p className="mt-5 text-lg text-[var(--color-text-muted)] max-w-3xl">
          The AI copies your resume into editable fields without rewriting anything, and you check the result before it is saved.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr] items-start">
      <div className={`${cardClass} p-6 space-y-5`}>
        <div className="inline-flex rounded-[8px] border-[1.6px] border-[var(--color-ink)] p-1 gap-1 text-sm bg-[var(--color-surface-offset)]">
          {(['file', 'paste'] as const).map((option) => (
            <button
              key={option}
              onClick={() => {
                setMode(option)
                setError(null)
              }}
              disabled={busy}
              aria-pressed={mode === option}
              className={`px-3.5 py-1.5 rounded-[6px] font-bold transition-all ${
                mode === option
                  ? 'bg-[var(--color-yellow)] text-[#0a0a0a] border-[1.6px] border-[var(--color-ink)] shadow-[2px_2px_0_0_var(--color-ink)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] border-[1.6px] border-transparent'
              }`}
            >
              {option === 'file' ? 'Upload a file' : 'Paste text'}
            </button>
          ))}
        </div>

        {mode === 'file' ? (
          <div
            role="button"
            tabIndex={0}
            onClick={() => !busy && inputRef.current?.click()}
            onKeyDown={(e) => {
              if (!busy && (e.key === 'Enter' || e.key === ' ')) inputRef.current?.click()
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              if (!busy) pick(e.dataTransfer.files[0])
            }}
            className={`cursor-pointer rounded-[10px] border-2 border-dashed border-[var(--color-ink)] p-10 text-center transition-all ${
              dragging ? 'bg-[var(--color-accent-soft)] shadow-[4px_4px_0_0_var(--color-ink)]' : 'bg-[var(--color-bg)] hover:bg-[var(--color-accent-soft)]'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,.tex,.txt,.md"
              className="hidden"
              onChange={(e) => pick(e.target.files?.[0])}
            />
            <span className={`nb-badge w-16 h-16 mx-auto mb-4 ${file ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-yellow)]'}`}>
              {file ? <FileText size={30} /> : <Upload size={30} />}
            </span>
            {file ? (
              <>
                <p className="text-lg font-black break-all">{file.name}</p>
                <p className="text-sm text-[var(--color-text-muted)] mt-1">
                  {Math.max(1, Math.round(file.size / 1024))} KB · click to choose a different file
                </p>
              </>
            ) : (
              <>
                <p className="text-lg font-black">Drop your resume here, or click to choose</p>
                <p className="text-sm text-[var(--color-text-muted)] mt-1">PDF, Word (.docx), LaTeX (.tex) or plain text, up to 4 MB</p>
              </>
            )}
          </div>
        ) : (
          <textarea
            rows={12}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            disabled={busy}
            placeholder="Paste the full text of your resume…"
            className={`${inputClass} resize-y leading-relaxed`}
          />
        )}

        <AiAllowance
          kind="import"
          isOwner={isOwner}
          settings={settings}
          billing={billing}
          onOpenSettings={onOpenSettings}
          onOpenBilling={onOpenBilling}
          disabled={busy}
        />

        {error && (
          <div className={errorBox}>
            {error}
            {isOwner && /API key/i.test(error) && (
              <>
                {' '}
                <button onClick={onOpenSettings} className="underline font-medium">
                  Open AI settings
                </button>
              </>
            )}
          </div>
        )}

        <button
          onClick={run}
          disabled={busy || !ready || needsKey || checkingRuns || aiOff}
          className={`w-full ${primaryButton} py-3.5 text-base`}
        >
          {phase === 'reading' ? (
            'Reading your resume…'
          ) : phase === 'structuring' ? (
            'Sorting it into sections…'
          ) : (
            <>
              Import resume <ArrowRight size={18} />
            </>
          )}
        </button>
      </div>

      <aside className={`${cardClass} p-6 bg-[var(--color-sky-soft)] space-y-4`}>
        <p className="text-lg font-black">What happens next</p>
        <ol className="space-y-3">
          {[
            'Chills reads the text of your file. Nothing is rewritten at this stage.',
            'The AI sorts it into sections: summary, skills, experience, projects and education.',
            'You check every field, fix anything that came through wrong, and save.',
            'Then paste a job description and tailor it.',
          ].map((line, i) => (
            <li key={line} className="flex items-start gap-2.5 text-sm">
              <span className="nb-badge w-7 h-7 shrink-0 bg-[var(--color-accent)] text-xs">{i + 1}</span>
              <span className="pt-1">{line}</span>
            </li>
          ))}
        </ol>
        <p className="flex items-start gap-2 text-xs text-[var(--color-text-muted)]">
          <CheckCircle size={16} className="shrink-0 text-[var(--color-success)]" />
          Your file itself isn&apos;t kept, only the resume you save.
        </p>
      </aside>
      </div>
    </div>
  )
}
