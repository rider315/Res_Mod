'use client'
import { useEffect, useRef, useState } from 'react'
import { Upload, Users } from '@/components/brand/Icons'
import { errorBox, inputClass, primaryButton, secondaryButton, successBox } from '@/components/user/shared'

/**
 * Publishing the week's recruiter list, and taking people out of it.
 *
 * The suppression box is not an afterthought: anyone who asks not to be written
 * to has to come off the list at once, and stay off. Paste the address, and no
 * account can take them again.
 */

interface Stats {
  total: number
  open: number
  suppressed: number
  batches: number
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))
const today = () => new Date().toISOString().slice(0, 10)

export default function DirectoryAdmin() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [field, setField] = useState('engineering')
  const [batch, setBatch] = useState(today)
  const [source, setSource] = useState('')
  const [suppress, setSuppress] = useState('')
  const [busy, setBusy] = useState<'publish' | 'suppress' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const load = () =>
    fetch('/api/admin/directory', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setStats(data))
      .catch(() => undefined)

  useEffect(() => {
    load()
  }, [])

  async function publish() {
    if (!file) return
    setBusy('publish')
    setError(null)
    setNotice(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('field', field)
      form.append('batch', batch)
      form.append('source', source)
      const res = await fetch('/api/admin/directory', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'That list could not be published.')
      setNotice(
        `${data.added} published in batch ${data.batch}. ${data.duplicates} were already there` +
          `${data.rejected?.length ? `, and ${data.rejected.length} addresses were refused` : ''}.`
      )
      setFile(null)
      if (input.current) input.current.value = ''
      await load()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  async function takeOut() {
    const emails = suppress
      .split(/[\s,;]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
    if (emails.length === 0) return
    setBusy('suppress')
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/admin/directory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails, reason: 'asked not to be contacted' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Those could not be taken out.')
      setNotice(`${data.suppressed} taken out of the directory for good.`)
      setSuppress('')
      await load()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-lg font-black flex items-center gap-2">
        <Users size={18} /> Recruiter directory
      </h3>
      {stats && (
        <p className="text-sm text-[var(--color-text-muted)] tabular-nums">
          {stats.total} published · {stats.open} still open to new accounts · {stats.suppressed} taken out · {stats.batches} weekly
          {stats.batches === 1 ? ' batch' : ' batches'}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block sm:col-span-1">
          <span className="block text-sm font-bold mb-1.5">Field</span>
          <input value={field} onChange={(e) => setField(e.target.value)} maxLength={60} placeholder="engineering" className={inputClass} />
        </label>
        <label className="block">
          <span className="block text-sm font-bold mb-1.5">Week</span>
          <input type="date" value={batch} onChange={(e) => setBatch(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="block text-sm font-bold mb-1.5">Where it came from</span>
          <input value={source} onChange={(e) => setSource(e.target.value)} maxLength={60} placeholder="careers pages" className={inputClass} />
        </label>
      </div>

      <input
        ref={input}
        type="file"
        accept=".csv,.xlsx,.pdf,.txt"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="block w-full text-sm file:mr-3 file:rounded-[8px] file:border-[1.6px] file:border-[var(--color-ink)] file:bg-[var(--color-yellow)] file:px-3 file:py-1.5 file:font-bold"
      />

      <button onClick={publish} disabled={!file || busy !== null} className={primaryButton}>
        <Upload size={16} /> {busy === 'publish' ? 'Checking every address…' : 'Publish this week’s list'}
      </button>
      <p className="text-xs text-[var(--color-text-muted)]">
        CSV, Excel, a PDF table or a pasted list — the same readers the users&apos; own imports use. Every address is checked before it
        goes up, and one already published keeps the batch it arrived in.
      </p>

      <div className="pt-2 border-t-[1.6px] border-[var(--color-border-soft)] space-y-2">
        <span className="block text-sm font-bold">Take someone out</span>
        <textarea
          rows={2}
          value={suppress}
          onChange={(e) => setSuppress(e.target.value)}
          placeholder="priya.rao@example.com, another@example.com"
          className={`${inputClass} resize-y`}
        />
        <button onClick={takeOut} disabled={!suppress.trim() || busy !== null} className={secondaryButton}>
          {busy === 'suppress' ? 'Taking them out…' : 'Take out of the directory'}
        </button>
        <p className="text-xs text-[var(--color-text-muted)]">
          For anyone who asks not to be written to. They come off the list at once and can never be taken again.
        </p>
      </div>

      {error && <div className={errorBox}>{error}</div>}
      {notice && !error && <div className={successBox}>{notice}</div>}
    </section>
  )
}
