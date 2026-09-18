'use client'
import { useRef, useState } from 'react'
import Working from '@/components/user/Working'
import { CheckCircle, FileText, Upload, Users } from '@/components/brand/Icons'
import { errorBox, inputClass, linkButton, primaryButton, secondaryButton, successBox } from '@/components/user/shared'
import type { ImportSummary } from '@/lib/outreach/types'
import { LIMITS } from '@/lib/outreach/model'
import Dialog from '@/components/user/outreach/Dialog'
import { Field, Segmented } from '@/components/user/outreach/controls'
import { outreachApi } from '@/components/user/outreach/outreach-client'

/**
 * Adding recruiters: one at a time, a pasted list, a CSV/Excel/PDF file, or a
 * public Google Sheet. Every address is checked on the server, and what was
 * left out, and why, is shown.
 */

type Mode = 'one' | 'paste' | 'file' | 'sheet'

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

export default function AddRecruitersDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [mode, setMode] = useState<Mode>('one')
  const [busy, setBusy] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)

  const [one, setOne] = useState({ email: '', name: '', company: '', title: '' })
  const [pasted, setPasted] = useState('')
  const [sheetUrl, setSheetUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setStartedAt(Date.now())
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const addOne = () =>
    run(async () => {
      const { recruiter } = await outreachApi.addRecruiter(one)
      setNotice(`Added ${recruiter.name || recruiter.email}. Add another, or close this when you're done.`)
      setOne({ email: '', name: '', company: one.company, title: '' })
      onAdded()
    })

  const importList = () =>
    run(async () => {
      const result =
        mode === 'paste'
          ? await outreachApi.importText(pasted)
          : mode === 'sheet'
            ? await outreachApi.importSheet(sheetUrl)
            : await outreachApi.importFile(file as File)
      setSummary(result)
      if (result.added > 0) onAdded()
    })

  const canImport =
    !busy && ((mode === 'paste' && pasted.trim().length > 3) || (mode === 'sheet' && sheetUrl.trim().length > 10) || (mode === 'file' && file !== null))

  const pick = (chosen: File | undefined) => {
    if (!chosen) return
    setFile(chosen)
    setError(null)
  }

  const footer = summary ? (
    <>
      <button onClick={() => setSummary(null)} className={secondaryButton}>
        Add more
      </button>
      <button onClick={onClose} className={primaryButton}>
        Done
      </button>
    </>
  ) : mode === 'one' ? (
    <>
      <button onClick={onClose} disabled={busy} className={secondaryButton}>
        Close
      </button>
      <button onClick={addOne} disabled={busy || one.email.trim().length < 3} className={primaryButton}>
        {busy ? 'Checking…' : 'Add recruiter'}
      </button>
    </>
  ) : (
    <>
      <button onClick={onClose} disabled={busy} className={secondaryButton}>
        Cancel
      </button>
      <button onClick={importList} disabled={!canImport} className={primaryButton}>
        {busy ? 'Checking addresses…' : 'Import recruiters'}
      </button>
    </>
  )

  return (
    <Dialog
      title="Add recruiters"
      subtitle="Every address is checked before it’s saved."
      icon={<Users size={20} />}
      width="max-w-xl"
      busy={busy}
      onClose={onClose}
      footer={footer}
    >
      {summary ? (
        <ImportResult summary={summary} />
      ) : (
        <div className="space-y-5">
          <Segmented
            label="How to add recruiters"
            value={mode}
            onChange={(value) => {
              setMode(value)
              setError(null)
              setNotice(null)
            }}
            disabled={busy}
            options={[
              { value: 'one', label: 'One at a time' },
              { value: 'paste', label: 'Paste a list' },
              { value: 'file', label: 'Upload a file' },
              { value: 'sheet', label: 'Google Sheet' },
            ]}
          />

          {mode === 'one' && (
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!busy && one.email.trim()) addOne()
              }}
            >
              <div className="sm:col-span-2">
                <Field label="Email address">
                  <input
                    type="email"
                    value={one.email}
                    onChange={(e) => setOne({ ...one, email: e.target.value })}
                    disabled={busy}
                    autoComplete="off"
                    placeholder="priya.rao@company.com"
                    className={inputClass}
                    autoFocus
                  />
                </Field>
              </div>
              <Field label="Name" optional>
                <input value={one.name} onChange={(e) => setOne({ ...one, name: e.target.value })} disabled={busy} maxLength={120} placeholder="Priya Rao" className={inputClass} />
              </Field>
              <Field label="Company" optional>
                <input value={one.company} onChange={(e) => setOne({ ...one, company: e.target.value })} disabled={busy} maxLength={160} placeholder="Northwind" className={inputClass} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Their job title" optional hint="Helps the AI address them well, such as “Talent Acquisition Lead”.">
                  <input value={one.title} onChange={(e) => setOne({ ...one, title: e.target.value })} disabled={busy} maxLength={120} className={inputClass} />
                </Field>
              </div>
              {/* Enter submits the form. */}
              <button type="submit" hidden aria-hidden tabIndex={-1} />
            </form>
          )}

          {mode === 'paste' && (
            <Field label="One recruiter per line" hint="Name, company and title can go on the same line, separated by commas.">
              <textarea
                rows={9}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                disabled={busy}
                placeholder={'priya.rao@northwind.com\nAmit Shah <amit@blueharbor.io>\nNeha Gupta, Contoso, neha@contoso.com, Talent Partner'}
                className={`${inputClass} resize-y leading-relaxed font-mono text-[13px]`}
              />
            </Field>
          )}

          {mode === 'file' && (
            <div className="space-y-3">
              <div
                role="button"
                tabIndex={0}
                onClick={() => !busy && fileInput.current?.click()}
                onKeyDown={(e) => {
                  if (!busy && (e.key === 'Enter' || e.key === ' ')) fileInput.current?.click()
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
                className={`cursor-pointer rounded-[10px] border-2 border-dashed border-[var(--color-ink)] p-8 text-center transition-all ${
                  dragging ? 'bg-[var(--color-accent-soft)] shadow-[4px_4px_0_0_var(--color-ink)]' : 'bg-[var(--color-bg)] hover:bg-[var(--color-accent-soft)]'
                }`}
              >
                <input
                  ref={fileInput}
                  type="file"
                  accept=".csv,.xlsx,.pdf,.txt,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={(e) => pick(e.target.files?.[0])}
                />
                <span className={`nb-badge w-14 h-14 mx-auto mb-3 ${file ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-yellow)]'}`}>
                  {file ? <FileText size={26} /> : <Upload size={26} />}
                </span>
                {file ? (
                  <>
                    <p className="font-black break-all">{file.name}</p>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">Click to choose a different file</p>
                  </>
                ) : (
                  <>
                    <p className="font-black">Drop a recruiter list here, or click to choose</p>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">CSV, Excel (.xlsx) or a PDF table, up to 4 MB</p>
                  </>
                )}
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">
                Spreadsheets need a column headed “Email”; columns named Name, Company and Title are picked up too. PDF tables of HR
                contacts are read as well, but scanned PDFs have no text to read.
              </p>
            </div>
          )}

          {mode === 'sheet' && (
            <Field
              label="Google Sheets link"
              hint="The sheet must be shared as “Anyone with the link can view”. The first row should name the columns, with one headed “Email”."
            >
              <input
                type="url"
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                disabled={busy}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                className={inputClass}
              />
            </Field>
          )}

          {busy && mode !== 'one' && (
            <Working
              kind="recruiters"
              startedAt={startedAt}
              active={0}
              steps={['Checking every address before it is saved']}
              note="Format, mistyped providers, throwaway domains, and whether the domain can receive mail at all."
            />
          )}

          {mode !== 'one' && (
            <p className="text-xs text-[var(--color-text-faint)]">
              Up to {LIMITS.importRows} recruiters at a time, and {LIMITS.recruitersPerAccount.toLocaleString()} in your list.
            </p>
          )}
          {error && <div className={errorBox}>{error}</div>}
          {notice && <div className={successBox}>{notice}</div>}
        </div>
      )}
    </Dialog>
  )
}

function ImportResult({ summary }: { summary: ImportSummary }) {
  const [showRejected, setShowRejected] = useState(summary.rejected.length <= 5)
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="nb-badge w-12 h-12 bg-[var(--color-accent)]">
          <CheckCircle size={24} />
        </span>
        <div>
          <p className="text-xl font-black">
            {summary.added} recruiter{summary.added === 1 ? '' : 's'} added
          </p>
          <p className="text-sm text-[var(--color-text-muted)]">
            {summary.found} found in the list
            {summary.duplicates > 0 ? ` · ${summary.duplicates} already in your list` : ''}
            {summary.rejected.length > 0 ? ` · ${summary.rejected.length} not valid` : ''}
          </p>
        </div>
      </div>
      {summary.overLimit > 0 && (
        <div className={errorBox}>
          {summary.overLimit} were left out because your list is full. Remove recruiters you no longer need, then import again.
        </div>
      )}
      {summary.rejected.length > 0 && (
        <div className="rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-bg)] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-black">Left out</p>
            {summary.rejected.length > 5 && (
              <button onClick={() => setShowRejected(!showRejected)} className={linkButton}>
                {showRejected ? 'Hide' : `Show all ${summary.rejected.length}`}
              </button>
            )}
          </div>
          {showRejected && (
            <ul className="mt-2 space-y-1.5 max-h-60 overflow-y-auto text-sm">
              {summary.rejected.map((row, i) => (
                <li key={`${row.email}-${i}`} className="flex flex-wrap gap-x-2">
                  <span className="font-semibold break-all">{row.email || '(empty)'}</span>
                  <span className="text-[var(--color-text-muted)]">
                    {row.reason}
                    {row.suggestion ? ` Did you mean ${row.suggestion}?` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
