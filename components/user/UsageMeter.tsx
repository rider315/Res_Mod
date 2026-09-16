'use client'
import { useEffect, useState } from 'react'
import { AiUsage, formatTokens, isEstimated, totalTokens } from '@/lib/ai-usage'
import { RUN_STAGES, RunStage } from '@/lib/run-optimization'

/**
 * What the run is spending, while it spends it.
 *
 * A tailoring run is several model calls on the user's own key or on an included
 * run, and takes a minute or two with nothing to look at. This shows the passes
 * ticking by and the tokens adding up, so the cost of tailoring to this job is
 * visible at the time it is being incurred, not guessed at afterwards.
 */

interface UsageMeterProps {
  usage: AiUsage
  /** The pass running now. Undefined once the run has finished. */
  stage?: RunStage
  label?: string
  /** When the run started, for the clock. */
  startedAt?: number
  /** Whose AI is paying: an included run, the account's own key, or Puter. */
  source: 'platform' | 'own' | 'puter'
  /** Included runs left after this one, when it is running on ResMod AI. */
  runsLeft?: number | null
}

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function useElapsed(startedAt: number | undefined, running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running || !startedAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running, startedAt])
  return startedAt ? now - startedAt : 0
}

/** The stages before the one running now are done; a pass with nothing to do is skipped over. */
function stageState(index: number, current: RunStage | undefined): 'done' | 'running' | 'waiting' {
  if (!current || current === 'done') return 'done'
  const at = RUN_STAGES.findIndex((entry) => entry.stage === current)
  if (index < at) return 'done'
  return index === at ? 'running' : 'waiting'
}

export default function UsageMeter({ usage, stage, label, startedAt, source, runsLeft }: UsageMeterProps) {
  const running = Boolean(stage) && stage !== 'done'
  const elapsed = useElapsed(startedAt, running)
  const total = totalTokens(usage)
  const about = isEstimated(usage) && total > 0 ? 'about ' : ''
  const inputShare = total > 0 ? Math.round((usage.inputTokens / total) * 100) : 0

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-offset)] p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">AI usage this run</h2>
        <span className="text-xs tabular-nums text-[var(--color-text-muted)]">
          {startedAt ? clock(elapsed) : null}
        </span>
      </div>

      <div>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
          <div
            className="bg-[var(--color-primary)] transition-all duration-500"
            style={{ width: `${inputShare}%` }}
            aria-hidden
          />
          <div
            className="bg-[var(--color-success)] transition-all duration-500"
            style={{ width: `${total > 0 ? 100 - inputShare : 0}%` }}
            aria-hidden
          />
        </div>
        <p className="mt-2 text-sm text-[var(--color-text)]">
          <span className="font-semibold tabular-nums">{about}{formatTokens(total)}</span> tokens
          <span className="text-[var(--color-text-muted)]">
            {' '}· {formatTokens(usage.inputTokens)} in / {formatTokens(usage.outputTokens)} out ·{' '}
            {usage.calls} model call{usage.calls === 1 ? '' : 's'}
          </span>
        </p>
      </div>

      <ol className="space-y-1.5">
        {RUN_STAGES.map((entry, index) => {
          const state = stageState(index, stage)
          return (
            <li key={entry.stage} className="flex items-center gap-2 text-xs">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  state === 'done'
                    ? 'bg-[var(--color-success)]'
                    : state === 'running'
                      ? 'bg-[var(--color-primary)] animate-pulse'
                      : 'bg-[var(--color-border)]'
                }`}
                aria-hidden
              />
              <span
                className={
                  state === 'waiting'
                    ? 'text-[var(--color-text-faint)]'
                    : state === 'running'
                      ? 'text-[var(--color-text)] font-medium'
                      : 'text-[var(--color-text-muted)]'
                }
              >
                {state === 'running' && label ? label : entry.label}
              </span>
            </li>
          )
        })}
      </ol>

      <p className="text-[11px] text-[var(--color-text-faint)]">
        {source === 'platform'
          ? `Running on ResMod AI: this run uses one of your included runs${
              typeof runsLeft === 'number' ? `, ${runsLeft} left after it` : ''
            }.`
          : source === 'puter'
            ? 'Running in your browser on your own Puter account, which is what these tokens are billed to.'
            : 'Running on your own API key, which is what these tokens are billed to.'}
        {isEstimated(usage) && usage.calls > 0
          ? ' Your provider does not report token counts, so these are estimated from the text.'
          : ''}
      </p>
    </div>
  )
}

/** The same numbers in one line, for the review screen. */
export function UsageLine({ usage, elapsedMs }: { usage: AiUsage; elapsedMs?: number }) {
  if (usage.calls === 0) return null
  const about = isEstimated(usage) ? 'about ' : ''
  return (
    <p className="text-xs text-[var(--color-text-muted)]">
      This run used <span className="font-medium text-[var(--color-text)]">{usage.calls}</span> model call
      {usage.calls === 1 ? '' : 's'} · {about}
      {formatTokens(totalTokens(usage))} tokens ({formatTokens(usage.inputTokens)} in /{' '}
      {formatTokens(usage.outputTokens)} out)
      {elapsedMs ? ` · ${clock(elapsedMs)}` : ''}
    </p>
  )
}
