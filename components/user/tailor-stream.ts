import { ApiError, readApiError } from '@/components/user/billing-client'
import { AiUsage, emptyUsage } from '@/lib/ai-usage'
import { RunStage } from '@/lib/run-optimization'
import { OptimizationResult, ParsedResume } from '@/types/resume'

/**
 * Reading a tailoring run as it happens.
 *
 * The route answers with newline-delimited JSON: a progress line as each pass
 * starts and after every model call, then one result line. Anything refused
 * before the run starts is still a normal JSON error with its status, so the
 * quota dialog and the rest of the error handling are unchanged.
 */

export interface RunUpdate {
  stage: RunStage
  label: string
  usage: AiUsage
}

export interface RunOutcome {
  result: OptimizationResult
  resume: ParsedResume
  usage: AiUsage
}

export async function readTailorStream(res: Response, onUpdate: (update: RunUpdate) => void): Promise<RunOutcome> {
  if (!res.ok) throw await readApiError(res, 'Tailoring failed.')
  if (!res.body) throw new Error('The server sent no response. Try again.')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let outcome: RunOutcome | null = null

  const handle = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let event: Record<string, unknown>
    try {
      event = JSON.parse(trimmed)
    } catch {
      // A half-written line can only be the last one, and that is handled after the loop.
      return
    }

    if (event.type === 'progress') {
      onUpdate({ stage: event.stage as RunStage, label: String(event.label ?? ''), usage: (event.usage as AiUsage) ?? emptyUsage() })
    } else if (event.type === 'result') {
      outcome = {
        result: event.result as OptimizationResult,
        resume: event.resume as ParsedResume,
        usage: (event.usage as AiUsage) ?? emptyUsage(),
      }
    } else if (event.type === 'error') {
      throw new ApiError(String(event.error ?? 'Tailoring failed.'), event.rateLimited ? 429 : 400)
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) handle(line)
  }
  handle(buffer)

  if (!outcome) throw new Error('The run ended before it produced any changes. Try again.')
  return outcome
}
