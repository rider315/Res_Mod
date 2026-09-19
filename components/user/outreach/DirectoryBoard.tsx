'use client'
import { useCallback, useEffect, useState } from 'react'
import { Briefcase, CheckCircle, Plus, Search, Sparkles, Users } from '@/components/brand/Icons'
import { cardClass, errorBox, inputClass, primaryButton, secondaryButton, successBox } from '@/components/user/shared'
import Working from '@/components/user/Working'
import { ApiError } from '@/components/user/billing-client'
import { BILLING_CODES } from '@/lib/billing/types'
import { directoryApi, DirectoryEntry, DirectoryList } from '@/components/user/outreach/outreach-client'

/**
 * The recruiters Chills publishes, for accounts with nobody of their own yet.
 *
 * Addresses aren't shown, and aren't sent to the browser, until a contact is
 * taken — which is counted. Each card says how many places are left on it,
 * because that is the honest version of what the cap does: a recruiter is open
 * to only so many people before Chills stops handing them out.
 */

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

export default function DirectoryBoard({ onTaken, onOpenBilling }: { onTaken: () => void; onOpenBilling: () => void }) {
  const [list, setList] = useState<DirectoryList | null>(null)
  const [field, setField] = useState('')
  const [query, setQuery] = useState('')
  const [newOnly, setNewOnly] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** The list is for accounts that pay, and this one does not. */
  const [needsPlan, setNeedsPlan] = useState(false)

  const load = useCallback(async () => {
    try {
      setList(await directoryApi.list({ field, q: query, newOnly }))
      setError(null)
      setNeedsPlan(false)
    } catch (err) {
      if (err instanceof ApiError && err.code === BILLING_CODES.directoryNeedsPlan) {
        setNeedsPlan(true)
        return
      }
      setError(errorText(err))
      setList((current) => current ?? { entries: [], fields: [], latestBatch: null, weeklyLeft: 0, weeklyLimit: 0 })
    }
  }, [field, query, newOnly])

  useEffect(() => {
    const timer = setTimeout(load, query ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, query])

  async function take() {
    setBusy(true)
    setStartedAt(Date.now())
    setError(null)
    setNotice(null)
    try {
      const result = await directoryApi.take(Array.from(picked))
      setPicked(new Set())
      setNotice(
        `${result.added} recruiter${result.added === 1 ? '' : 's'} added to your list. ` +
          `They're on the Write and send tab now${result.weeklyLeft > 0 ? `, and you can take ${result.weeklyLeft} more this week.` : '.'}`
      )
      await load()
      onTaken()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  function toggle(id: string) {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }

  // The server refused, so there is no list to show. Say what it costs and what
  // is still free, rather than an error the account can do nothing about.
  if (needsPlan) {
    return (
      <section className={`${cardClass} p-6 space-y-4 bg-[var(--color-yellow-soft)]`}>
        <h2 className="text-2xl font-black flex items-center gap-2.5">
          <Sparkles size={22} /> The weekly list comes with a paid plan
        </h2>
        <p className="text-[var(--color-text-muted)] leading-relaxed">
          Every week Chills publishes a fresh batch of hiring contacts — found, checked and kept up to date — and you can take up
          to 40 of them. That is the part of Chills that costs real work to keep going, so it comes with Pro, or with any credit
          pack.
        </p>
        <ul className="space-y-2 text-sm">
          {[
            'Still free: tailoring, cover letters, the keyword finder',
            'Still free: writing and sending emails to recruiters you add yourself',
            'A credit pack is the cheapest way in, and the credits never expire',
          ].map((line) => (
            <li key={line} className="flex items-start gap-2.5">
              <CheckCircle size={18} className="text-[var(--color-success)] shrink-0 mt-0.5" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <button onClick={onOpenBilling} className={primaryButton}>
          See plans
        </button>
      </section>
    )
  }

  if (!list) return <p className="text-sm font-semibold text-[var(--color-text-muted)]">Loading the directory…</p>

  const available = list.entries.filter((entry) => !entry.taken)
  const canTake = Math.min(picked.size, list.weeklyLeft)

  return (
    <div className="space-y-5">
      <section className={`${cardClass} p-5 bg-[var(--color-yellow-soft)] space-y-2`}>
        <h2 className="text-xl font-black flex items-center gap-2">
          <Sparkles size={20} /> Recruiters we found for you
        </h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          A fresh list every week, checked before it goes up. Take the ones that fit, and they land in your own list ready to write to.
          You still read every email and press Send yourself.
        </p>
        <p className="text-xs font-bold text-[var(--color-text-muted)]">
          {list.weeklyLeft} of {list.weeklyLimit} left to take this week
          {list.latestBatch ? ` · newest batch ${list.latestBatch}` : ''}
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search company, role or place"
            aria-label="Search the directory"
            className={`${inputClass} pl-9`}
          />
        </div>
        <button
          onClick={() => setNewOnly(!newOnly)}
          aria-pressed={newOnly}
          className={`nb-chip px-3 py-1.5 ${newOnly ? 'bg-[var(--color-yellow)] text-[#0a0a0a]' : 'bg-[var(--color-surface)]'}`}
        >
          New this week
        </button>
      </div>

      {list.fields.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Field">
          <button
            onClick={() => setField('')}
            aria-pressed={field === ''}
            className={`nb-chip px-2.5 py-0.5 text-xs ${field === '' ? 'bg-[var(--color-yellow)] text-[#0a0a0a]' : 'bg-[var(--color-surface)]'}`}
          >
            All
          </button>
          {list.fields.map((entry) => (
            <button
              key={entry.field}
              onClick={() => setField(entry.field === field ? '' : entry.field)}
              aria-pressed={field === entry.field}
              className={`nb-chip px-2.5 py-0.5 text-xs ${field === entry.field ? 'bg-[var(--color-yellow)] text-[#0a0a0a]' : 'bg-[var(--color-surface)]'}`}
            >
              {entry.field} <span className="tabular-nums opacity-70">{entry.open}</span>
            </button>
          ))}
        </div>
      )}

      {error && <div className={errorBox}>{error}</div>}
      {notice && !error && <div className={successBox}>{notice}</div>}

      {busy ? (
        <Working kind="recruiters" startedAt={startedAt} active={0} steps={['Adding them to your list']} />
      ) : (
        picked.size > 0 && (
          <div className="nb-card rounded-[10px] p-3 flex flex-wrap items-center gap-3 bg-[var(--color-accent-soft)] sticky top-20 z-10">
            <button onClick={take} disabled={canTake === 0} className={primaryButton}>
              <Plus size={16} /> Add {canTake} to my recruiters
            </button>
            <button onClick={() => setPicked(new Set())} className={secondaryButton}>
              Clear
            </button>
            {picked.size > list.weeklyLeft && (
              <span className="text-xs font-bold text-[var(--color-warning)]">
                Only {list.weeklyLeft} left this week — the rest stay here for you.
              </span>
            )}
          </div>
        )
      )}

      {list.entries.length === 0 ? (
        <div className={`${cardClass} p-10 text-center space-y-3`}>
          <span className="nb-badge w-14 h-14 mx-auto bg-[var(--color-sky)]">
            <Users size={26} />
          </span>
          <h3 className="text-xl font-black">Nothing here yet</h3>
          <p className="text-[var(--color-text-muted)] max-w-md mx-auto">
            {query || field
              ? 'No recruiters match that. Try another field, or clear the search.'
              : 'The next list goes up shortly. In the meantime you can add your own recruiters on the Write and send tab.'}
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.entries.map((entry) => (
            <DirectoryCard key={entry.id} entry={entry} picked={picked.has(entry.id)} onToggle={() => toggle(entry.id)} />
          ))}
        </ul>
      )}

      {available.length > 0 && (
        <p className="text-xs text-[var(--color-text-muted)]">
          Each recruiter is open to {list.entries[0]?.spotsLeft !== undefined ? 'a limited number of' : 'a few'} people. Once enough have
          taken them, they come off the list — one inbox getting the same pitch from everyone helps nobody.
        </p>
      )}
    </div>
  )
}

function DirectoryCard({ entry, picked, onToggle }: { entry: DirectoryEntry; picked: boolean; onToggle: () => void }) {
  const who = entry.name || entry.title || 'Recruiter'
  return (
    <li>
      <button
        onClick={onToggle}
        disabled={entry.taken}
        aria-pressed={picked}
        className={`w-full h-full text-left rounded-[10px] border-[1.6px] border-[var(--color-ink)] p-4 transition-all disabled:opacity-60 disabled:cursor-default ${
          picked ? 'bg-[var(--color-accent)] shadow-[4px_4px_0_0_var(--color-ink)] -translate-y-0.5' : 'bg-[var(--color-surface)]'
        }`}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="nb-badge w-9 h-9 shrink-0 bg-[var(--color-sky)] font-black">{who.charAt(0).toUpperCase()}</span>
          {entry.taken ? (
            <span className="nb-chip text-[10px] bg-[var(--color-surface-offset)] whitespace-nowrap">
              <CheckCircle size={11} /> In your list
            </span>
          ) : (
            <span className="nb-chip text-[10px] bg-[var(--color-yellow-soft)] whitespace-nowrap tabular-nums">{entry.spotsLeft} left</span>
          )}
        </span>
        <span className="mt-2.5 block font-black leading-tight break-words">{who}</span>
        {entry.company && <span className="block text-sm text-[var(--color-text-muted)] break-words">{entry.company}</span>}
        <span className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
          {entry.field && (
            <span className="nb-chip bg-[var(--color-accent-soft)]">
              <Briefcase size={10} /> {entry.field}
            </span>
          )}
          {entry.location && <span className="nb-chip bg-[var(--color-surface-offset)]">{entry.location}</span>}
        </span>
      </button>
    </li>
  )
}
