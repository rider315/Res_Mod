'use client'
import { useEffect, useId, useRef, useState } from 'react'
import Working from '@/components/user/Working'
import { Copy, Download, Mail, Pencil } from '@/components/brand/Icons'
import { readApiError } from '@/components/user/billing-client'
import {
  downloadBlob,
  downloadCoverLetterPdf,
  errorBox,
  inputClass,
  primaryButton,
  secondaryButton,
  successBox,
} from '@/components/user/shared'
import {
  COVER_LETTER_TONES,
  CoverLetterLength,
  CoverLetterTone,
  MAX_COVER_LETTER_CHARS,
  TONE_LABELS,
} from '@/lib/cover-letter'
import { getProvider } from '@/lib/providers'
import { AISettings } from '@/lib/settings-storage'

/**
 * A cover letter for one tailored copy: pick a tone and length, write it, edit
 * it, then copy it or download it as a PDF. It is written from the tailored
 * resume and the job it was tailored to, so the two match.
 */

interface Letter {
  id: string
  tone: CoverLetterTone
  body: string
  updatedAt: string
}

interface CoverLetterPanelProps {
  tailoringId: string
  /** The candidate's name, for the file name. */
  name: string
  isOwner: boolean
  settings: AISettings
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * Sent when a letter is written or saved. The finished tailoring stays mounted
 * behind the History screen, so both can show the same letter at once.
 */
const LETTER_CHANGED = 'resmod:cover-letter-changed'

interface LetterChanged {
  tailoringId: string
  letter: Letter
  written: number
  from: string
}

export default function CoverLetterPanel({ tailoringId, name, isOwner, settings }: CoverLetterPanelProps) {
  const panelId = useId()
  const [loaded, setLoaded] = useState(false)
  const [letter, setLetter] = useState<Letter | null>(null)
  const [draft, setDraft] = useState('')
  const [written, setWritten] = useState(0)
  const [max, setMax] = useState(3)
  const [choosing, setChoosing] = useState(false)
  const [tone, setTone] = useState<CoverLetterTone>('professional')
  const [length, setLength] = useState<CoverLetterLength>('standard')
  const [recipient, setRecipient] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState<'write' | 'save' | 'pdf' | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const puter = isOwner && getProvider(settings.provider).clientSide
  const left = Math.max(0, max - written)
  const dirty = letter !== null && draft !== letter.body

  useEffect(() => {
    let cancelled = false
    fetch(`/api/tailorings/${tailoringId}/cover-letter`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw await readApiError(res, 'The cover letter could not be loaded.')
        return res.json()
      })
      .then((data) => {
        if (cancelled) return
        setLetter(data.letter)
        setDraft(data.letter?.body ?? '')
        setWritten(data.written)
        setMax(data.max)
        if (data.letter) setTone(data.letter.tone)
      })
      .catch((err) => !cancelled && setError(errorText(err)))
      .finally(() => !cancelled && setLoaded(true))
    return () => {
      cancelled = true
    }
  }, [tailoringId])

  const shown = useRef({ letter, draft })
  useEffect(() => {
    shown.current = { letter, draft }
  })

  useEffect(() => {
    function onChanged(event: Event) {
      const change = (event as CustomEvent<LetterChanged>).detail
      if (change.tailoringId !== tailoringId || change.from === panelId) return
      // Unsaved edits made here are kept.
      const { letter: mine, draft: mineDraft } = shown.current
      if (!mine || mineDraft === mine.body) setDraft(change.letter.body)
      setLetter(change.letter)
      setWritten(change.written)
      setTone(change.letter.tone)
      setNotice(null)
    }
    window.addEventListener(LETTER_CHANGED, onChanged)
    return () => window.removeEventListener(LETTER_CHANGED, onChanged)
  }, [tailoringId, panelId])

  function announce(next: Letter, count: number) {
    const detail: LetterChanged = { tailoringId, letter: next, written: count, from: panelId }
    window.dispatchEvent(new CustomEvent(LETTER_CHANGED, { detail }))
  }

  async function write() {
    setBusy('write')
    setStartedAt(Date.now())
    setError(null)
    setNotice(null)
    try {
      const ai = isOwner
        ? { provider: settings.provider, apiKey: settings.apiKeys[settings.provider], model: settings.models[settings.provider] }
        : {}
      const res = await fetch(`/api/tailorings/${tailoringId}/cover-letter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tone, length, recipient, notes, ...ai }),
      })
      if (!res.ok) throw await readApiError(res, 'The cover letter could not be written.')
      const data = await res.json()
      setLetter(data.letter)
      setDraft(data.letter.body)
      setWritten(data.written)
      setMax(data.max)
      setChoosing(false)
      announce(data.letter, data.written)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  async function save(): Promise<boolean> {
    if (!letter) return false
    setBusy('save')
    setError(null)
    try {
      const res = await fetch(`/api/cover-letters/${letter.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: draft }),
      })
      if (!res.ok) throw await readApiError(res, 'Your edits could not be saved.')
      const data = await res.json()
      setLetter(data.letter)
      setDraft(data.letter.body)
      setNotice('Saved.')
      announce(data.letter, written)
      return true
    } catch (err) {
      setError(errorText(err))
      return false
    } finally {
      setBusy(null)
    }
  }

  async function pdf() {
    if (!letter) return
    if (dirty && !(await save())) return
    setBusy('pdf')
    setError(null)
    try {
      await downloadCoverLetterPdf(letter.id, name)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft)
      setNotice('Copied to the clipboard.')
    } catch {
      setError('Copying was blocked by the browser. Select the text and copy it instead.')
    }
  }

  if (!loaded) {
    return <p className="text-sm font-semibold text-[var(--color-text-muted)]">Loading the cover letter…</p>
  }

  const showOptions = !letter || choosing

  return (
    <div className="space-y-4">
      {error && <div className={errorBox}>{error}</div>}
      {notice && !error && <div className={successBox}>{notice}</div>}

      {showOptions && (
        <div className="space-y-4">
          <div>
            <span className="block text-sm font-bold mb-2">Tone</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {COVER_LETTER_TONES.map((id) => (
                <button
                  key={id}
                  onClick={() => setTone(id)}
                  disabled={busy !== null}
                  aria-pressed={tone === id}
                  className={`text-left rounded-[10px] border-[1.6px] border-[var(--color-ink)] p-2.5 transition-all ${
                    tone === id
                      ? 'bg-[var(--color-accent)] shadow-[3px_3px_0_0_var(--color-ink)] text-[#0a0a0a]'
                      : 'bg-[var(--color-surface)] hover:bg-[var(--color-surface-offset)]'
                  }`}
                >
                  <span className="block text-sm font-extrabold">{TONE_LABELS[id].label}</span>
                  <span className="block text-[11px] leading-snug opacity-80">{TONE_LABELS[id].hint}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold mr-1">Length</span>
            {(['short', 'standard'] as const).map((id) => (
              <button
                key={id}
                onClick={() => setLength(id)}
                disabled={busy !== null}
                aria-pressed={length === id}
                className={`nb-chip px-3 py-1 ${length === id ? 'bg-[var(--color-yellow)] text-[#0a0a0a]' : 'bg-[var(--color-surface)]'}`}
              >
                {id === 'short' ? 'Short · 3 paragraphs' : 'Standard · 4 paragraphs'}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 items-end">
            <label className="block">
              <span className="block text-sm font-bold mb-1.5">
                Addressed to <span className="font-normal text-[var(--color-text-muted)]">(optional)</span>
              </span>
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                maxLength={120}
                disabled={busy !== null}
                placeholder="Hiring Manager"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="block text-sm font-bold mb-1.5">
                Anything to mention <span className="font-normal text-[var(--color-text-muted)]">(optional)</span>
              </span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={600}
                disabled={busy !== null}
                placeholder="e.g. happy to relocate to Pune"
                className={inputClass}
              />
            </label>
          </div>
          {puter ? (
            <p className="text-sm font-semibold text-[var(--color-warning)]">
              Puter runs in your browser, so it can&apos;t write cover letters. Pick another provider in AI settings.
            </p>
          ) : left === 0 ? (
            <p className="text-sm font-semibold text-[var(--color-text-muted)]">
              You&apos;ve written {max} cover letters for this resume. Edit the latest one instead.
            </p>
          ) : busy === 'write' ? (
            <Working
              kind="letter"
              startedAt={startedAt}
              active={0}
              steps={['Writing your letter from the tailored resume']}
              note="Built from what the resume already says, in the tone you picked."
            />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={write} disabled={busy !== null} className={primaryButton}>
                <Mail size={16} /> {letter ? 'Rewrite the letter' : 'Write my cover letter'}
              </button>
              {letter && (
                <button onClick={() => setChoosing(false)} disabled={busy !== null} className={secondaryButton}>
                  Keep the current one
                </button>
              )}
              <span className="text-xs text-[var(--color-text-muted)]">
                {left} of {max} left for this resume · uses no tailoring
              </span>
            </div>
          )}
        </div>
      )}

      {letter && !choosing && (
        <div className="space-y-3">
          <textarea
            rows={16}
            value={draft}
            maxLength={MAX_COVER_LETTER_CHARS}
            onChange={(e) => {
              setDraft(e.target.value)
              setNotice(null)
            }}
            aria-label="Cover letter"
            className={`${inputClass} resize-y leading-relaxed font-[inherit]`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={save} disabled={busy !== null || !dirty} className={primaryButton}>
              {busy === 'save' ? 'Saving…' : dirty ? 'Save edits' : 'Saved'}
            </button>
            <button onClick={pdf} disabled={busy !== null} className={secondaryButton}>
              <Download size={15} /> {busy === 'pdf' ? 'Building PDF…' : 'PDF'}
            </button>
            <button onClick={copy} disabled={busy !== null} className={secondaryButton}>
              <Copy size={15} /> Copy
            </button>
            <button
              onClick={() => downloadBlob(new Blob([draft], { type: 'text/plain' }), `${name.replace(/[^\w-]+/g, '_') || 'Cover'}_Cover_Letter.txt`)}
              disabled={busy !== null}
              className={secondaryButton}
            >
              .txt
            </button>
            {left > 0 && !puter && (
              <button onClick={() => setChoosing(true)} disabled={busy !== null} className={secondaryButton}>
                <Pencil size={15} /> Change tone or rewrite
              </button>
            )}
          </div>
          <p className="text-[11px] text-[var(--color-text-faint)]">
            Written from your tailored resume in a {TONE_LABELS[letter.tone]?.label.toLowerCase() ?? 'professional'} tone. Read it through
            before you send it. PDF sends the letter to texlive.net to be typeset.
          </p>
        </div>
      )}
    </div>
  )
}
