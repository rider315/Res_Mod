'use client'
import { useCallback, useEffect, useState } from 'react'
import { Close } from '@/components/brand/Icons'
import { secondaryButton } from '@/components/user/shared'

/**
 * The browser extensions connected to this account, and the button that cuts
 * one off.
 *
 * The connect screen promises this exists, which is the only reason it is worth
 * building before anyone asks: a revoke button nobody can find is the same as
 * no revoke button, and the promise would be a lie.
 *
 * Nothing here shows a key. There is nothing to show — only the hash is kept.
 */

interface Key {
  id: string
  label: string
  createdAt: string
  lastUsedAt: string | null
}

const when = (value: string | null) => {
  if (!value) return 'never used'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'never used'
  return `last used ${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
}

export default function ExtensionKeys() {
  const [keys, setKeys] = useState<Key[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/extension/token', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? 'Those could not be loaded.')
      setKeys(data.tokens ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setKeys([])
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function revoke(id: string) {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/extension/token?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? 'That could not be disconnected.')
      }
      setKeys((current) => (current ?? []).filter((key) => key.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  // Nothing to manage and nothing to explain: an account that has never
  // connected one does not need a section about it.
  if (keys !== null && keys.length === 0 && !error) return null

  return (
    <section className="nb-card rounded-[10px] p-5 space-y-3">
      <h2 className="text-xl font-black">Browser extension</h2>
      <p className="text-sm text-[var(--color-text-muted)]">
        These can read job postings you open and score your resumes against them. They can&apos;t send email, change your plan
        or delete anything. Disconnecting one stops it immediately.
      </p>
      {error && <p className="text-sm font-bold text-[var(--color-error)]">{error}</p>}
      <ul className="space-y-2">
        {(keys ?? []).map((key) => (
          <li key={key.id} className="flex items-center justify-between gap-3 border-[1.6px] border-[var(--color-ink)] rounded-[8px] px-3 py-2">
            <span className="min-w-0">
              <span className="block font-bold truncate">{key.label}</span>
              <span className="block text-xs text-[var(--color-text-muted)]">{when(key.lastUsedAt)}</span>
            </span>
            <button onClick={() => revoke(key.id)} disabled={busyId === key.id} className={secondaryButton}>
              <Close size={14} /> {busyId === key.id ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
