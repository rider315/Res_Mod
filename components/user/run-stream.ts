import { ApiError, readApiError } from '@/components/user/billing-client'
import { AiUsage, emptyUsage } from '@/lib/ai-usage'

/**
 * Reading a long run as it happens.
 *
 * Tailoring and complete applications both answer with newline-delimited JSON: a
 * progress line as each pass starts and after every model call, then one result
 * line. Anything refused before the run starts is still a normal JSON error with
 * its status, so the quota dialog and the rest of the error handling work as
 * they do for any other request.
 *
 * The reading is the same for both; only what the result line carries differs,
 * which is what `readResult` is for.
 */

export interface RunProgressUpdate {
  stage: string
  label: string
  usage: AiUsage
}

export async function readRunStream<T>({
  res,
  onUpdate,
  readResult,
  whatFailed,
}: {
  res: Response
  onUpdate: (update: RunProgressUpdate) => void
  readResult: (event: Record<string, unknown>) => T
  /** What to say when the run ends without a result line. */
  whatFailed: string
}): Promise<T> {
  if (!res.ok) throw await readApiError(res, whatFailed)
  if (!res.body) throw new Error('The server sent no response. Try again.')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let outcome: { value: T } | null = null

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
      onUpdate({
        stage: String(event.stage ?? ''),
        label: String(event.label ?? ''),
        usage: (event.usage as AiUsage) ?? emptyUsage(),
      })
    } else if (event.type === 'result') {
      outcome = { value: readResult(event) }
    } else if (event.type === 'error') {
      throw new ApiError(String(event.error ?? whatFailed), event.rateLimited ? 429 : 400)
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

  if (!outcome) throw new Error('The run ended before it produced anything. Try again.')
  return (outcome as { value: T }).value
}
