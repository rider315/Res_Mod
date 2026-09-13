'use client'
import { useRef, useState } from 'react'
import { AISettings } from '@/lib/settings-storage'
import { getProvider } from '@/lib/providers'
import { MAX_UPLOAD_BYTES, ResumeDoc, SourceFormat } from '@/lib/resume-doc'
import { errorBox, inputClass, primaryButton } from '@/components/user/shared'

/**
 * Importing a resume: a file or pasted text, turned into a structured resume.
 *
 * Text extraction always runs on the server. Structuring runs with the user's
 * own AI settings: through /api/import/structure for key-based providers, or
 * entirely in the browser for Puter, which bills the user's Puter account.
 */

interface ImportPanelProps {
  settings: AISettings
  onOpenSettings: () => void
  onImported: (doc: ResumeDoc, sourceFormat: SourceFormat) => void
  onCancel: () => void
}

type Phase = 'idle' | 'reading' | 'structuring'

export default function ImportPanel({ settings, onOpenSettings, onImported, onCancel }: ImportPanelProps) {
  const [mode, setMode] = useState<'file' | 'paste'>('file')
  const [file, setFile] = useState<File | null>(null)
  const [pasted, setPasted] = useState('')
  const [dragging, setDragging] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const provider = getProvider(settings.provider)
  const model = settings.models[settings.provider]
  const needsKey = provider.needsKey && !settings.apiKeys[settings.provider]?.trim()
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
    if (provider.clientSide) {
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

    const res = await fetch('/api/import/structure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, provider: settings.provider, apiKey: settings.apiKeys[settings.provider], model }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'The AI could not read this resume.')
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
    } finally {
      setPhase('idle')
    }
  }

  return (
    <div className="space-y-6 anim-page-enter">
      <div>
        <button
          onClick={onCancel}
          disabled={busy}
          className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50 transition-colors"
        >
          ← Your resumes
        </button>
        <h1 className="text-2xl font-bold text-[var(--color-text)] mt-2">Import your resume</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          The AI copies your resume into editable fields without rewriting anything, and you check the result
          before it is saved.
        </p>
      </div>

      <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-5 space-y-4">
        <div className="inline-flex rounded-lg border border-[var(--color-border)] p-0.5 text-sm">
          {(['file', 'paste'] as const).map((option) => (
            <button
              key={option}
              onClick={() => {
                setMode(option)
                setError(null)
              }}
              disabled={busy}
              className={`px-3 py-1.5 rounded-md transition-all ${
                mode === option
                  ? 'bg-[var(--color-primary-highlight)] text-[var(--color-primary)] font-semibold'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
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
            className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-all ${
              dragging
                ? 'border-[var(--color-primary)] bg-[var(--color-primary-highlight)]'
                : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,.tex,.txt,.md"
              className="hidden"
              onChange={(e) => pick(e.target.files?.[0])}
            />
            {file ? (
              <>
                <p className="text-sm font-semibold text-[var(--color-text)] break-all">{file.name}</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  {Math.max(1, Math.round(file.size / 1024))} KB · click to choose a different file
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-[var(--color-text)]">Drop your resume here, or click to choose</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  PDF, Word (.docx), LaTeX (.tex) or plain text, up to 4 MB
                </p>
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

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-text-muted)]">
          <span>
            AI: {provider.emoji} {provider.label}
            {model ? ` · ${model.split('/').pop()}` : ''}
          </span>
          <button onClick={onOpenSettings} disabled={busy} className="text-[var(--color-primary)] hover:underline disabled:opacity-50">
            Change AI settings
          </button>
        </div>

        {needsKey && (
          <p className="text-xs text-[var(--color-warning)]">
            {provider.label} needs your own API key.{' '}
            <button onClick={onOpenSettings} className="underline font-medium">
              Add it in AI settings
            </button>
            , or choose Puter, which needs no key.
          </p>
        )}

        {error && (
          <div className={errorBox}>
            {error}
            {/API key/i.test(error) && (
              <>
                {' '}
                <button onClick={onOpenSettings} className="underline font-medium">
                  Open AI settings
                </button>
              </>
            )}
          </div>
        )}

        <button onClick={run} disabled={busy || !ready || needsKey} className={`w-full ${primaryButton}`}>
          {phase === 'reading' ? 'Reading your resume…' : phase === 'structuring' ? 'Sorting it into sections…' : 'Import resume →'}
        </button>
      </div>
    </div>
  )
}
