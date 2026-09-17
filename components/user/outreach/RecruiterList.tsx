'use client'
import { useEffect, useRef } from 'react'
import { Plus, Search, Trash, Users } from '@/components/brand/Icons'
import { cardClass, inputClass, linkButton, secondaryButton } from '@/components/user/shared'
import type { RecruiterSummary } from '@/lib/outreach/types'
import { StatusChip } from '@/components/user/outreach/controls'

/** The recruiter list: search, a status filter, and a selection for batch writing and sending. */

export type RecruiterFilter = 'all' | 'new' | 'draft' | 'sent' | 'replied'

const FILTERS: Array<{ value: RecruiterFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'Not emailed' },
  { value: 'draft', label: 'Drafts' },
  { value: 'sent', label: 'Waiting' },
  { value: 'replied', label: 'Replied' },
]

export function matchesFilter(recruiter: RecruiterSummary, filter: RecruiterFilter): boolean {
  const status = recruiter.latestThread?.status
  switch (filter) {
    case 'new':
      return !status
    case 'draft':
      return status === 'draft' || status === 'sending'
    case 'sent':
      return status === 'sent' || status === 'opened'
    case 'replied':
      return status === 'replied' || status === 'interview' || status === 'offer' || status === 'rejected'
    default:
      return true
  }
}

export function matchesQuery(recruiter: RecruiterSummary, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return !needle || [recruiter.name, recruiter.email, recruiter.company, recruiter.title].join(' ').toLowerCase().includes(needle)
}

interface RecruiterListProps {
  recruiters: RecruiterSummary[]
  shown: RecruiterSummary[]
  query: string
  filter: RecruiterFilter
  focusedId: string | null
  selected: Set<string>
  locked: boolean
  onQuery: (query: string) => void
  onFilter: (filter: RecruiterFilter) => void
  onFocus: (id: string) => void
  onSelect: (selected: Set<string>) => void
  onAdd: () => void
  onRemoveSelected: () => void
}

export default function RecruiterList(props: RecruiterListProps) {
  const { recruiters, shown, selected, focusedId, locked } = props
  const allShownSelected = shown.length > 0 && shown.every((recruiter) => selected.has(recruiter.id))
  const someShownSelected = shown.some((recruiter) => selected.has(recruiter.id))
  const counts = Object.fromEntries(FILTERS.map(({ value }) => [value, recruiters.filter((r) => matchesFilter(r, value)).length]))

  // A part-selected list shows the dash, not an empty box, which would read as "none selected".
  const selectAll = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = someShownSelected && !allShownSelected
  }, [someShownSelected, allShownSelected])

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    props.onSelect(next)
  }

  function toggleAll() {
    const next = new Set(selected)
    for (const recruiter of shown) {
      if (allShownSelected) next.delete(recruiter.id)
      else next.add(recruiter.id)
    }
    props.onSelect(next)
  }

  return (
    <section className={`${cardClass} p-0 overflow-hidden`}>
      <div className="p-4 space-y-3 border-b-[1.6px] border-[var(--color-ink)]">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-black flex items-center gap-2">
            <Users size={18} /> Recruiters
            <span className="nb-chip text-[11px] bg-[var(--color-surface-offset)] tabular-nums">{recruiters.length}</span>
          </h2>
          <button onClick={props.onAdd} disabled={locked} className={secondaryButton}>
            <Plus size={14} /> Add
          </button>
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]" />
          <input
            value={props.query}
            onChange={(e) => props.onQuery(e.target.value)}
            placeholder="Search name, company, email"
            aria-label="Search recruiters"
            className={`${inputClass} pl-9`}
          />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => props.onFilter(value)}
              aria-pressed={props.filter === value}
              className={`nb-chip px-2.5 py-0.5 text-xs ${props.filter === value ? 'bg-[var(--color-yellow)] text-[#0a0a0a]' : 'bg-[var(--color-surface)]'}`}
            >
              {label} <span className="tabular-nums opacity-70">{counts[value]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 px-4 py-2 bg-[var(--color-surface-offset)] border-b-[1.6px] border-[var(--color-ink)] text-sm">
        <label className="flex items-center gap-2 font-bold cursor-pointer">
          <input
            ref={selectAll}
            type="checkbox"
            checked={allShownSelected}
            onChange={toggleAll}
            disabled={shown.length === 0 || locked}
            aria-label={allShownSelected ? 'Clear the selection' : 'Select every recruiter shown'}
            className="w-4 h-4 accent-[var(--color-primary)]"
          />
          {selected.size > 0 ? `${selected.size} selected` : 'Select all'}
        </label>
        {selected.size > 0 && (
          <span className="flex items-center gap-3">
            <button onClick={() => props.onSelect(new Set())} disabled={locked} className={linkButton}>
              Clear
            </button>
            <button onClick={props.onRemoveSelected} disabled={locked} className="text-[var(--color-error)] font-bold inline-flex items-center gap-1 disabled:opacity-50" aria-label="Remove the selected recruiters">
              <Trash size={14} /> Remove
            </button>
          </span>
        )}
      </div>

      <ul className="max-h-[640px] overflow-y-auto divide-y-[1.6px] divide-[var(--color-border-soft)]">
        {shown.length === 0 && (
          <li className="p-6 text-center text-sm text-[var(--color-text-muted)]">
            {recruiters.length === 0 ? 'No recruiters yet.' : 'No recruiters match.'}
          </li>
        )}
        {shown.map((recruiter) => {
          const focused = recruiter.id === focusedId
          return (
            <li key={recruiter.id} className={`flex items-start gap-3 px-4 py-3 transition-colors ${focused ? 'bg-[var(--color-primary-highlight)]' : 'hover:bg-[var(--color-bg)]'}`}>
              <input
                type="checkbox"
                checked={selected.has(recruiter.id)}
                onChange={() => toggle(recruiter.id)}
                disabled={locked}
                aria-label={`Select ${recruiter.name || recruiter.email}`}
                className="mt-1 w-4 h-4 shrink-0 accent-[var(--color-primary)]"
              />
              <button onClick={() => props.onFocus(recruiter.id)} className="flex-1 min-w-0 text-left" aria-current={focused ? 'true' : undefined}>
                <span className="flex items-start justify-between gap-2">
                  <span className="font-black leading-tight break-words">{recruiter.name || recruiter.email}</span>
                  {recruiter.latestThread && <StatusChip status={recruiter.latestThread.status} className="shrink-0" />}
                </span>
                <span className="block text-xs text-[var(--color-text-muted)] break-words">
                  {[recruiter.title, recruiter.company].filter(Boolean).join(' · ') || recruiter.email}
                </span>
                {recruiter.name && <span className="block text-[11px] text-[var(--color-text-faint)] break-all">{recruiter.email}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
