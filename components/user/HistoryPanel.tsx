'use client'
import { useEffect, useState } from 'react'
import { ArrowLeft, Download, FileText, History as HistoryIcon, Mail, Trash } from '@/components/brand/Icons'
import CoverLetterPanel from '@/components/user/CoverLetterPanel'
import { LEVELS, TailorLevel } from '@/lib/tailor/levels'
import type { HistoryCoverage } from '@/lib/tailor/history'
import { AISettings } from '@/lib/settings-storage'
import { formatDate } from '@/components/user/billing-client'
import {
  backLinkClass,
  cardClass,
  downloadBlob,
  downloadTailoringPdf,
  errorBox,
  openInOverleaf,
  resumeFileBase,
  secondaryButton,
} from '@/components/user/shared'

/**
 * The tailored copies a user applied, newest first, ready to download again,
 * each with its cover letter. Each copy is the finished document as it was
 * saved, so editing or deleting the resume it came from doesn't change it.
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

interface HistoryPanelProps {
  isOwner: boolean
  settings: AISettings
  onBack: () => void
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

function heading(item: TailoringSummary): string {
  if (item.jobTitle && item.company) return `${item.jobTitle} at ${item.company}`
  return item.jobTitle || item.company || 'Tailored resume'
}

const levelLabel = (level: string) => (level in LEVELS ? LEVELS[level as TailorLevel].label : level)
const fileName = (item: TailoringSummary) => `${item.resumeTitle} ${item.company}`.trim()

type Open = { id: string; what: 'job' | 'letter' } | null

export default function HistoryPanel({ isOwner, settings, onBack }: HistoryPanelProps) {
  const [items, setItems] = useState<TailoringSummary[] | null>(null)
  const [details, setDetails] = useState<Record<string, TailoringDetail>>({})
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [open, setOpen] = useState<Open>(null)

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

  function toggle(item: TailoringSummary, what: 'job' | 'letter') {
    if (open?.id === item.id && open.what === what) return setOpen(null)
    if (what === 'letter') return setOpen({ id: item.id, what })
    run(item.id, async () => {
      await detail(item.id)
      setOpen({ id: item.id, what })
    })
  }

  function remove(item: TailoringSummary) {
    if (!window.confirm(`Delete the tailored copy for ${heading(item)}, and its cover letter? This cannot be undone.`)) return
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
    <div className="space-y-8 anim-page-enter">
      <div>
        <button onClick={onBack} className={backLinkClass}>
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="mt-3 text-4xl sm:text-5xl font-black tracking-tight">
          <span className="nb-highlight">History</span>
        </h1>
        <p className="mt-5 text-lg text-[var(--color-text-muted)] max-w-3xl">
          Every tailored copy you apply is kept here, newest first, with its cover letter, so you can download them again and see which
          version went to which job. Your latest 50 are kept.
        </p>
      </div>

      {error && <div className={errorBox}>{error}</div>}

      {items === null ? (
        <p className="text-sm font-semibold text-[var(--color-text-muted)]">Loading your history…</p>
      ) : items.length === 0 ? (
        <div className={`${cardClass} p-10 text-center space-y-3`}>
          <span className="nb-badge w-12 h-12 bg-[var(--color-yellow)] mx-auto">
            <HistoryIcon size={24} />
          </span>
          <p className="text-xl font-black">Nothing here yet</p>
          <p className="text-[var(--color-text-muted)] max-w-md mx-auto">
            When you tailor a resume to a job and apply the changes, the tailored copy is saved here.
          </p>
        </div>
      ) : (
        <ul className="space-y-5">
          {items.map((item) => {
            const full = details[item.id]
            const coverage = item.coverage
            const openHere = open?.id === item.id ? open.what : null
            return (
              <li key={item.id} className={`${cardClass} p-5 space-y-4`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="nb-badge w-11 h-11 shrink-0 bg-[var(--color-accent)]">
                      <FileText size={22} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-lg font-black leading-tight break-words">{heading(item)}</p>
                      <p className="text-sm text-[var(--color-text-muted)] mt-1">
                        {item.resumeTitle} · {levelLabel(item.level)} · {item.appliedCount} change
                        {item.appliedCount === 1 ? '' : 's'} · {formatDate(item.createdAt)}
                      </p>
                      {coverage && coverage.after.requiredTotal > 0 && (
                        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold">
                          Required keywords
                          <span className="nb-chip bg-[var(--color-error-highlight)] text-[#0a0a0a]">
                            {coverage.before.requiredPresent}/{coverage.before.requiredTotal}
                          </span>
                          →
                          <span className="nb-chip bg-[var(--color-accent)] text-[#0a0a0a]">
                            {coverage.after.requiredPresent}/{coverage.after.requiredTotal}
                          </span>
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => downloadPdf(item)} disabled={busyId !== null} className="nb-btn nb-btn-sm nb-btn-primary py-2 px-3.5 text-sm">
                      <Download size={15} /> {busyId === item.id ? 'Working…' : 'PDF'}
                    </button>
                    <button onClick={() => downloadTex(item)} disabled={busyId !== null} className={secondaryButton}>
                      .tex
                    </button>
                    <button onClick={() => overleaf(item)} disabled={busyId !== null} className={secondaryButton}>
                      Overleaf
                    </button>
                    <button
                      onClick={() => remove(item)}
                      disabled={busyId !== null}
                      className="nb-btn nb-btn-sm nb-btn-danger py-2 px-2.5"
                      aria-label="Delete this tailored copy"
                      title="Delete"
                    >
                      <Trash size={15} />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 border-t-[1.6px] border-[var(--color-ink)] pt-4">
                  <button
                    onClick={() => toggle(item, 'letter')}
                    aria-expanded={openHere === 'letter'}
                    className={`nb-btn nb-btn-sm py-2 px-3.5 text-sm ${openHere === 'letter' ? 'nb-btn-yellow' : ''}`}
                  >
                    <Mail size={15} /> Cover letter
                  </button>
                  <button
                    onClick={() => toggle(item, 'job')}
                    disabled={busyId !== null}
                    aria-expanded={openHere === 'job'}
                    className={`nb-btn nb-btn-sm py-2 px-3.5 text-sm ${openHere === 'job' ? 'nb-btn-yellow' : ''}`}
                  >
                    {openHere === 'job' ? 'Hide the job description' : 'Job description'}
                  </button>
                </div>

                {openHere === 'job' && full && (
                  <p className="text-sm text-[var(--color-text-muted)] whitespace-pre-wrap max-h-72 overflow-y-auto rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-bg)] p-4">
                    {full.jobDescription || 'No job description was saved with this copy.'}
                  </p>
                )}
                {openHere === 'letter' && (
                  <div className="rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-bg)] p-4">
                    <CoverLetterPanel tailoringId={item.id} name={item.resumeTitle} isOwner={isOwner} settings={settings} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <p className="text-[11px] text-[var(--color-text-faint)]">
        PDF sends the document to texlive.net to be typeset, and Overleaf sends it to overleaf.com.
      </p>
    </div>
  )
}
