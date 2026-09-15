'use client'
import { useEffect, useState } from 'react'
import { LEVELS, TailorLevel } from '@/lib/tailor/levels'
import type { HistoryCoverage } from '@/lib/tailor/history'
import { formatDate } from '@/components/user/billing-client'
import {
  dangerButton,
  downloadBlob,
  downloadTailoringPdf,
  errorBox,
  openInOverleaf,
  resumeFileBase,
  secondaryButton,
} from '@/components/user/shared'

/**
 * The tailored copies a user applied, newest first, ready to download again.
 * Each is the finished document as it was saved, so editing or deleting the
 * resume it came from doesn't change it.
 */

interface TailoringSummary {
  id: string
  resumeId: string | null
  resumeTitle: string
  jobTitle: string
  company: string
  level: string
  appliedCount: number
  coverage: HistoryCoverage | null
  createdAt: string
}

interface TailoringDetail extends TailoringSummary {
  jobDescription: string
  latex: string
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

function heading(item: TailoringSummary): string {
  if (item.jobTitle && item.company) return `${item.jobTitle} at ${item.company}`
  return item.jobTitle || item.company || 'Tailored resume'
}

const levelLabel = (level: string) => (level in LEVELS ? LEVELS[level as TailorLevel].label : level)
const fileName = (item: TailoringSummary) => `${item.resumeTitle} ${item.company}`.trim()

export default function HistoryPanel({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<TailoringSummary[] | null>(null)
  const [details, setDetails] = useState<Record<string, TailoringDetail>>({})
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/tailorings', { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error ?? 'Your history could not be loaded.')
        if (!cancelled) setItems(data.tailorings)
      })
      .catch((err) => {
        if (cancelled) return
        setError(errorText(err))
        setItems([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function detail(id: string): Promise<TailoringDetail> {
    if (details[id]) return details[id]
    const res = await fetch(`/api/tailorings/${id}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'That tailored resume could not be loaded.')
    setDetails((current) => ({ ...current, [id]: data.tailoring }))
    return data.tailoring
  }

  async function run(id: string, action: () => Promise<void>) {
    setBusyId(id)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusyId(null)
    }
  }

  const downloadTex = (item: TailoringSummary) =>
    run(item.id, async () => {
      const { latex } = await detail(item.id)
      downloadBlob(new Blob([latex], { type: 'application/x-tex' }), `${resumeFileBase(fileName(item))}.tex`)
    })

  const downloadPdf = (item: TailoringSummary) => run(item.id, () => downloadTailoringPdf(item.id, fileName(item)))

  const overleaf = (item: TailoringSummary) => run(item.id, async () => openInOverleaf((await detail(item.id)).latex))

  function toggleJobDescription(item: TailoringSummary) {
    if (openId === item.id) return setOpenId(null)
    run(item.id, async () => {
      await detail(item.id)
      setOpenId(item.id)
    })
  }

  function remove(item: TailoringSummary) {
    if (!window.confirm(`Delete the tailored copy for ${heading(item)}? This cannot be undone.`)) return
    run(item.id, async () => {
      const res = await fetch(`/api/tailorings/${item.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'That tailored copy could not be deleted.')
      }
      setItems((list) => (list ?? []).filter((entry) => entry.id !== item.id))
    })
  }

  return (
    <div className="space-y-6 anim-page-enter">
      <div>
        <button onClick={onBack} className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-[var(--color-text)] mt-2">History</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          Every tailored copy you apply is kept here, newest first, so you can download it again. Your latest 50 are kept.
        </p>
      </div>

      {error && <div className={errorBox}>{error}</div>}

      {items === null ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading your history…</p>
      ) : items.length === 0 ? (
        <div className="bg-[var(--color-surface)] rounded-2xl border border-dashed border-[var(--color-border)] p-10 text-center space-y-2">
          <p className="text-base font-semibold text-[var(--color-text)]">Nothing here yet</p>
          <p className="text-sm text-[var(--color-text-muted)] max-w-md mx-auto">
            When you tailor a resume to a job and apply the changes, the tailored copy is saved here.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const full = details[item.id]
            const coverage = item.coverage
            return (
              <li key={item.id} className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-4 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--color-text)] truncate">{heading(item)}</p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                      {item.resumeTitle} · {levelLabel(item.level)} · {item.appliedCount} change
                      {item.appliedCount === 1 ? '' : 's'} · {formatDate(item.createdAt)}
                    </p>
                    {coverage && coverage.after.requiredTotal > 0 && (
                      <p className="text-xs text-[var(--color-text-muted)] mt-1">
                        Required keywords {coverage.before.requiredPresent}/{coverage.before.requiredTotal} →{' '}
                        <span className="font-semibold text-[var(--color-success)]">
                          {coverage.after.requiredPresent}/{coverage.after.requiredTotal}
                        </span>
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => downloadTex(item)} disabled={busyId !== null} className={secondaryButton}>
                      .tex
                    </button>
                    <button onClick={() => downloadPdf(item)} disabled={busyId !== null} className={secondaryButton}>
                      {busyId === item.id ? 'Working…' : 'PDF'}
                    </button>
                    <button onClick={() => overleaf(item)} disabled={busyId !== null} className={secondaryButton}>
                      Overleaf
                    </button>
                    <button onClick={() => remove(item)} disabled={busyId !== null} className={dangerButton}>
                      Delete
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => toggleJobDescription(item)}
                  disabled={busyId !== null}
                  className="text-xs text-[var(--color-primary)] hover:underline disabled:opacity-50"
                >
                  {openId === item.id ? 'Hide the job description' : 'Show the job description'}
                </button>
                {openId === item.id && full && (
                  <p className="text-xs text-[var(--color-text-muted)] whitespace-pre-wrap max-h-64 overflow-y-auto rounded-xl border border-[var(--color-border)] p-3">
                    {full.jobDescription || 'No job description was saved with this copy.'}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <p className="text-[11px] text-[var(--color-text-faint)]">
        PDF sends the tailored resume to texlive.net to be typeset, and Overleaf sends it to overleaf.com.
      </p>
    </div>
  )
}
