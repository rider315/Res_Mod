'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Briefcase, CheckCircle, Close, Mail, Plus, Send, Users, Wand } from '@/components/brand/Icons'
import { ApiError } from '@/components/user/billing-client'
import { backLinkClass, cardClass, errorBox, linkButton, primaryButton, ResumeSummary, secondaryButton } from '@/components/user/shared'
import { BILLING_CODES } from '@/lib/billing/types'
import type { BillingStatus } from '@/lib/billing/types'
import { BATCH_SEND_GAP_MS, followUpDue, wasSent } from '@/lib/outreach/model'
import { summarizeThreads } from '@/lib/outreach/stats'
import type { OutreachSetup, RecruiterSummary, ThreadSummary } from '@/lib/outreach/types'
import { AISettings } from '@/lib/settings-storage'
import AddRecruitersDialog from '@/components/user/outreach/AddRecruitersDialog'
import { BatchProgress, BatchSendDialog, BatchState, BatchWriteDialog, BatchWriteOptions } from '@/components/user/outreach/BatchDialogs'
import Composer, { defaultSourceKey, TailoringOption } from '@/components/user/outreach/Composer'
import RecruiterList, { matchesFilter, matchesQuery, RecruiterFilter } from '@/components/user/outreach/RecruiterList'
import SenderSetup from '@/components/user/outreach/SenderSetup'
import ThreadDialog from '@/components/user/outreach/ThreadDialog'
import TrackerBoard from '@/components/user/outreach/TrackerBoard'
import { Segmented } from '@/components/user/outreach/controls'
import { describeTailoring, outreachApi, OutreachContext, ownerAi } from '@/components/user/outreach/outreach-client'

/**
 * Recruiter outreach: the recruiters to write to, an email for each written
 * from a resume or a tailored copy, sending from the user's own mailbox, and a
 * tracker for what happens next.
 */

type Tab = 'write' | 'tracker' | 'setup'

interface OutreachPanelProps {
  /** Null while they load: an email is written from one of these, so nothing that picks one renders until they are here. */
  resumes: ResumeSummary[] | null
  isOwner: boolean
  settings: AISettings
  billing: BillingStatus | null | undefined
  /** Opened from a tailored copy: new emails are about that job. */
  context: OutreachContext | null
  onClearContext: () => void
  onBillingChanged: () => void
  onOpenBilling: () => void
  onImportResume: () => void
  onBack: () => void
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Errors that stop a whole batch, not just one email. */
const STOPPERS = new Set<string>([
  BILLING_CODES.draftLimit,
  BILLING_CODES.dailyLimit,
  BILLING_CODES.platformUnavailable,
  BILLING_CODES.sendLimit,
  'mailbox_missing',
  'mailbox_auth',
  'mailbox_connection',
  'mailbox_settings',
])

export default function OutreachPanel(props: OutreachPanelProps) {
  const { isOwner, settings, billing, context } = props
  const [tab, setTab] = useState<Tab>('write')
  const [recruiters, setRecruiters] = useState<RecruiterSummary[] | null>(null)
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [setup, setSetup] = useState<OutreachSetup | null>(null)
  const [tailorings, setTailorings] = useState<TailoringOption[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<RecruiterFilter>('all')
  const [adding, setAdding] = useState(false)
  const [openThread, setOpenThread] = useState<string | null>(null)
  const [batchDialog, setBatchDialog] = useState<'write' | 'send' | null>(null)
  const [batch, setBatch] = useState<BatchState | null>(null)
  const stopRequested = useRef(false)
  const running = batch !== null && !batch.finished

  const { onBillingChanged } = props
  // The tailored copies load with the recruiters, not beside them: a draft written
  // from one reads as "the resume was deleted" until its copy is here.
  const refresh = useCallback(async () => {
    try {
      const [recruiterList, threadList, tailoringList] = await Promise.all([
        outreachApi.recruiters(),
        outreachApi.threads(),
        outreachApi.tailorings(),
      ])
      setRecruiters(recruiterList.recruiters)
      setThreads(threadList.threads)
      setTailorings(tailoringList)
      setLoadError(null)
    } catch (err) {
      setLoadError(errorText(err))
      setRecruiters((current) => current ?? [])
      setTailorings((current) => current ?? [])
    }
    onBillingChanged()
  }, [onBillingChanged])

  useEffect(() => {
    refresh()
    outreachApi
      .setup()
      .then(setSetup)
      .catch((err) => setLoadError(errorText(err)))
  }, [refresh])

  // A batch keeps going only while this screen is open; leaving asks first.
  useEffect(() => {
    if (!running) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [running])
  useEffect(
    () => () => {
      stopRequested.current = true
    },
    []
  )

  const threadById = useMemo(() => new Map(threads.map((thread) => [thread.id, thread])), [threads])
  const list = recruiters ?? []
  // What an email can be written from. Until both are here, anything that picks one waits:
  // choosing from an empty list would quietly write from the wrong resume, or none.
  const resumes = props.resumes ?? []
  const tailoringList = tailorings ?? []
  const sourcesReady = props.resumes !== null && tailorings !== null
  const shown = list.filter((recruiter) => matchesFilter(recruiter, filter) && matchesQuery(recruiter, query))
  const focused = list.find((recruiter) => recruiter.id === focusedId) ?? null
  const selectedRecruiters = list.filter((recruiter) => selected.has(recruiter.id))
  const toWrite = selectedRecruiters.filter((recruiter) => !recruiter.latestThread)
  const toSend = selectedRecruiters.filter((recruiter) => recruiter.latestThread?.status === 'draft')
  const stats = summarizeThreads(threads, list.length)
  const mailbox = setup?.mailbox?.address ?? null
  const draftsLeft = isOwner || !billing ? null : Math.max(0, billing.emailDrafts.limit - billing.emailDrafts.used)
  const sendsLeft = isOwner || !billing ? null : Math.max(0, billing.emailSends.limit - billing.emailSends.used)
  const contextCopy = context ? tailoringList.find((t) => t.id === context.tailoringId) : undefined

  function leave() {
    if (running && !window.confirm('Emails are still being processed. Stop and leave?')) return
    stopRequested.current = true
    props.onBack()
  }

  async function removeSelected() {
    const count = selected.size
    if (!window.confirm(`Remove ${count} recruiter${count === 1 ? '' : 's'}? Their drafts, sent-email history and replies in ResMod go too.`)) return
    try {
      await outreachApi.removeRecruiters(Array.from(selected))
      if (focusedId && selected.has(focusedId)) setFocusedId(null)
      setSelected(new Set())
      await refresh()
    } catch (err) {
      setLoadError(errorText(err))
    }
  }

  async function runBatch(kind: 'write' | 'send', targets: RecruiterSummary[], step: (recruiter: RecruiterSummary) => Promise<void>) {
    setBatchDialog(null)
    stopRequested.current = false
    const state: BatchState = { kind, total: targets.length, done: 0, current: '', failed: [], finished: false, stopped: null }
    setBatch({ ...state })
    for (let i = 0; i < targets.length; i++) {
      if (stopRequested.current) {
        state.stopped = 'Stopped. Nothing after this point was touched.'
        break
      }
      const recruiter = targets[i]
      state.current = recruiter.name || recruiter.email
      setBatch({ ...state })
      try {
        await step(recruiter)
      } catch (err) {
        state.failed.push({ who: state.current, error: errorText(err) })
        if (err instanceof ApiError && err.code && STOPPERS.has(err.code)) {
          state.done++
          state.stopped = err.message
          break
        }
      }
      state.done++
      setBatch({ ...state })
      if (kind === 'send' && i < targets.length - 1 && !stopRequested.current) await pause(BATCH_SEND_GAP_MS)
    }
    state.finished = true
    state.current = ''
    setBatch({ ...state })
    setSelected(new Set())
    await refresh()
  }

  const startWrite = (options: BatchWriteOptions) =>
    runBatch('write', toWrite, async (recruiter) => {
      const key = options.source === 'best' ? defaultSourceKey(recruiter, context, tailoringList, resumes) : options.source
      const [kind, id] = key.split(':')
      if (!id) throw new Error('Import a resume first.')
      await outreachApi.write(
        {
          recruiterId: recruiter.id,
          source: { kind: kind as 'resume' | 'tailoring', id },
          jobTitle: kind === 'resume' ? options.jobTitle : '',
          tone: options.tone,
          notes: options.notes,
          attachResume: options.attachResume,
        },
        ownerAi(isOwner, settings)
      )
    })

  const startSend = () =>
    runBatch('send', toSend, async (recruiter) => {
      const threadId = recruiter.latestThread?.id
      if (!threadId) throw new Error('No draft to send.')
      await outreachApi.send(threadId)
    })

  const followUpsDue = threads.filter((thread) => wasSent(thread.status) && followUpDue(thread)).length

  return (
    <div className="space-y-6 anim-page-enter">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <button onClick={leave} className={backLinkClass}>
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="mt-3 text-4xl sm:text-5xl font-black tracking-tight">
            Recruiter <span className="nb-highlight">outreach</span>
          </h1>
          <p className="mt-4 text-lg text-[var(--color-text-muted)] max-w-3xl">
            Write to recruiters from your own resume, send from your own mailbox with the right resume attached, and keep track of every
            reply.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="nb-chip bg-[var(--color-surface)]">
            <Users size={13} /> {stats.recruiters} recruiters
          </span>
          <span className="nb-chip bg-[var(--color-sky-soft)]">
            <Send size={13} /> {stats.sent} sent
          </span>
          <span className="nb-chip bg-[var(--color-accent-soft)]">
            <CheckCircle size={13} /> {stats.replied} replied
          </span>
          {draftsLeft !== null && (
            <button onClick={props.onOpenBilling} className="nb-chip bg-[var(--color-yellow-soft)] hover:bg-[var(--color-yellow)] transition-colors">
              <Wand size={13} /> {draftsLeft} AI emails left
            </button>
          )}
        </div>
      </div>

      {context && (
        <div className="nb-card rounded-[10px] p-4 bg-[var(--color-accent-soft)] flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-start gap-3">
            <span className="nb-badge w-9 h-9 shrink-0 bg-[var(--color-accent)]">
              <Briefcase size={17} />
            </span>
            <span>
              <span className="block font-black">Emailing about {describeTailoring(contextCopy ?? context)}</span>
              <span className="block text-sm text-[var(--color-text-muted)]">
                New emails are written from that tailored copy and attach it. Add the recruiters for this job, then write to them.
              </span>
            </span>
          </p>
          <button onClick={props.onClearContext} className={secondaryButton}>
            <Close size={14} /> Any job
          </button>
        </div>
      )}

      <Segmented
        label="Outreach"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'write', label: 'Write and send' },
          {
            value: 'tracker',
            label: 'Tracker',
            badge: followUpsDue > 0 ? <span className="nb-chip text-[10px] px-1.5 py-0 bg-[var(--color-yellow)] text-[#0a0a0a]">{followUpsDue}</span> : undefined,
          },
          {
            value: 'setup',
            label: 'Sender setup',
            badge: setup && !setup.mailbox ? <span className="w-2 h-2 rounded-full bg-[var(--color-error)]" aria-label="Not connected" /> : undefined,
          },
        ]}
      />

      {loadError && <div className={errorBox}>{loadError}</div>}
      {batch && (
        <BatchProgress
          batch={batch}
          onStop={() => {
            stopRequested.current = true
          }}
          onDismiss={() => setBatch(null)}
        />
      )}

      {tab === 'write' &&
        (recruiters === null || !sourcesReady ? (
          <p className="text-sm font-semibold text-[var(--color-text-muted)]">Loading your recruiters…</p>
        ) : list.length === 0 ? (
          <GettingStarted
            hasResume={resumes.length > 0}
            mailbox={mailbox}
            onAdd={() => setAdding(true)}
            onSetup={() => setTab('setup')}
            onImportResume={props.onImportResume}
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start">
            <div className={`space-y-3 ${focused ? 'hidden lg:block' : ''}`}>
              {selected.size > 0 && (
                <div className="nb-card rounded-[10px] p-3 flex flex-wrap items-center gap-2 bg-[var(--color-yellow-soft)]">
                  <button onClick={() => setBatchDialog('write')} disabled={running || toWrite.length === 0} className={primaryButton}>
                    <Wand size={15} /> Write {toWrite.length}
                  </button>
                  <button
                    onClick={() => (mailbox ? setBatchDialog('send') : setTab('setup'))}
                    disabled={running || toSend.length === 0}
                    className={secondaryButton}
                  >
                    <Send size={14} /> {mailbox ? `Send ${toSend.length} drafts` : 'Connect a mailbox to send'}
                  </button>
                </div>
              )}
              <RecruiterList
                recruiters={list}
                shown={shown}
                query={query}
                filter={filter}
                focusedId={focusedId}
                selected={selected}
                locked={running}
                onQuery={setQuery}
                onFilter={setFilter}
                onFocus={setFocusedId}
                onSelect={setSelected}
                onAdd={() => setAdding(true)}
                onRemoveSelected={removeSelected}
              />
            </div>
            <div className={focused ? '' : 'hidden lg:block'}>
              {focused ? (
                <div className="space-y-3">
                  <button onClick={() => setFocusedId(null)} className={`${backLinkClass} lg:hidden`}>
                    <ArrowLeft size={16} /> All recruiters
                  </button>
                  <Composer
                    key={focused.id}
                    recruiter={focused}
                    thread={focused.latestThread ? threadById.get(focused.latestThread.id) ?? null : null}
                    resumes={resumes}
                    tailorings={tailoringList}
                    context={context}
                    mailbox={mailbox}
                    billing={billing}
                    isOwner={isOwner}
                    settings={settings}
                    locked={running}
                    onChanged={refresh}
                    onOpenSetup={() => setTab('setup')}
                    onOpenThread={setOpenThread}
                    onOpenBilling={props.onOpenBilling}
                  />
                </div>
              ) : (
                <PickSomeone mailbox={mailbox} onSetup={() => setTab('setup')} />
              )}
            </div>
          </div>
        ))}

      {tab === 'tracker' && <TrackerBoard threads={threads} recruiters={list.length} onOpenThread={setOpenThread} />}

      {tab === 'setup' &&
        (setup ? (
          <SenderSetup setup={setup} onSetupChange={setSetup} />
        ) : (
          <p className="text-sm font-semibold text-[var(--color-text-muted)]">Loading your settings…</p>
        ))}

      {adding && <AddRecruitersDialog onClose={() => setAdding(false)} onAdded={refresh} />}
      {openThread && sourcesReady && (
        <ThreadDialog
          threadId={openThread}
          resumes={resumes}
          tailorings={tailoringList}
          mailbox={mailbox}
          billing={billing}
          isOwner={isOwner}
          settings={settings}
          onClose={() => setOpenThread(null)}
          onChanged={refresh}
          onOpenSetup={() => {
            setOpenThread(null)
            setTab('setup')
          }}
          onOpenBilling={props.onOpenBilling}
        />
      )}
      {batchDialog === 'write' && (
        <BatchWriteDialog
          recruiters={toWrite}
          skipped={selectedRecruiters.length - toWrite.length}
          resumes={resumes}
          tailorings={tailoringList}
          context={context}
          draftsLeft={draftsLeft}
          onStart={startWrite}
          onClose={() => setBatchDialog(null)}
        />
      )}
      {batchDialog === 'send' && mailbox && (
        <BatchSendDialog
          recruiters={toSend}
          skipped={selectedRecruiters.length - toSend.length}
          mailbox={mailbox}
          sendsLeft={sendsLeft}
          onStart={startSend}
          onClose={() => setBatchDialog(null)}
        />
      )}
    </div>
  )
}

function GettingStarted({
  hasResume,
  mailbox,
  onAdd,
  onSetup,
  onImportResume,
}: {
  hasResume: boolean
  mailbox: string | null
  onAdd: () => void
  onSetup: () => void
  onImportResume: () => void
}) {
  const steps = [
    {
      done: hasResume,
      title: 'Have a resume in ResMod',
      detail: 'Every email is written from it, and it goes along as a PDF. Tailored copies work too.',
      action: hasResume ? null : (
        <button onClick={onImportResume} className={linkButton}>
          Import a resume
        </button>
      ),
    },
    {
      done: Boolean(mailbox),
      title: 'Connect your mailbox',
      detail: mailbox ? `Sending from ${mailbox}.` : 'Optional: without it, you can open each email in Gmail or Outlook and send it there.',
      action: mailbox ? null : (
        <button onClick={onSetup} className={linkButton}>
          Connect a mailbox
        </button>
      ),
    },
    {
      done: false,
      title: 'Add the recruiters you want to reach',
      detail: 'One at a time, from a CSV, Excel or PDF list, a Google Sheet, or pasted in.',
      action: null,
    },
  ]
  return (
    <section className={`${cardClass} p-6 sm:p-8 space-y-6`}>
      <div className="flex items-center gap-3">
        <span className="nb-badge w-12 h-12 bg-[var(--color-yellow)]">
          <Mail size={24} />
        </span>
        <div>
          <h2 className="text-2xl font-black">Reach recruiters directly</h2>
          <p className="text-[var(--color-text-muted)]">Short, specific emails, written from your resume, sent as you.</p>
        </div>
      </div>
      <ol className="space-y-4">
        {steps.map((step, i) => (
          <li key={step.title} className="flex items-start gap-3">
            <span className={`nb-badge w-8 h-8 shrink-0 text-sm ${step.done ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-surface)]'}`}>
              {step.done ? <CheckCircle size={16} /> : i + 1}
            </span>
            <div>
              <p className="font-black">{step.title}</p>
              <p className="text-sm text-[var(--color-text-muted)]">{step.detail}</p>
              {step.action}
            </div>
          </li>
        ))}
      </ol>
      <button onClick={onAdd} className={primaryButton}>
        <Plus size={16} /> Add recruiters
      </button>
    </section>
  )
}

function PickSomeone({ mailbox, onSetup }: { mailbox: string | null; onSetup: () => void }) {
  return (
    <section className={`${cardClass} p-8 text-center space-y-3 bg-[var(--color-sky-soft)]`}>
      <span className="nb-badge w-14 h-14 mx-auto bg-[var(--color-surface)]">
        <Mail size={26} />
      </span>
      <h2 className="text-xl font-black">Pick a recruiter to write to</h2>
      <p className="text-sm text-[var(--color-text-muted)] max-w-sm mx-auto">
        Or tick several and write or send their emails in one go. Each email is still written for its own recruiter.
      </p>
      {!mailbox && (
        <p className="text-sm">
          To send from ResMod,{' '}
          <button onClick={onSetup} className={linkButton}>
            connect your mailbox
          </button>
          .
        </p>
      )}
    </section>
  )
}
