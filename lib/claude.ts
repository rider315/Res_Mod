import Anthropic from '@anthropic-ai/sdk'
import { CallUsage, reportedCall } from '@/lib/ai-usage'
import { AiCallError, withRetries } from '@/lib/ai-errors'

/**
 * Claude API transport through the official Anthropic SDK.
 *
 * Server-only: the routes call it with a key from Settings or ANTHROPIC_API_KEY,
 * and nothing in the browser bundle may import it. It differs from the
 * OpenAI-compatible adapter in six ways:
 *
 * - No sampling parameters. Claude Opus 5, Sonnet 5 and Opus 4.7+ reject
 *   `temperature` with a 400, so it is never sent.
 * - No `thinking` setting. Opus 5 and Sonnet 5 think adaptively when it is
 *   omitted, and an explicit value would 400 on older models the picker can
 *   still select.
 * - Streaming. A long JSON answer plus thinking can outlast a plain HTTP
 *   request; `finalMessage()` collects the stream into one message.
 * - Refusals arrive as HTTP 200 with `stop_reason: "refusal"`, so that is
 *   checked before any text is read.
 * - Two retries of its own. The SDK retries a request the API turns away, but
 *   once an answer has started streaming it retries nothing: an overload
 *   reported partway through, or a dropped connection, ends the call. Those are
 *   tried again here (lib/ai-errors.ts).
 * - Prompt caching. After reading the job's keywords, a tailoring run makes up
 *   to four passes that repeat the same rules and the same job description, and
 *   reading those again costs the same as reading them the first time. Marked
 *   as cacheable, they come back at a tenth of the price on every pass after the
 *   first. See below.
 */

/**
 * Where the caching breakpoints go, and why there are two.
 *
 * Caching is a prefix match: the API keys on the exact bytes from the start of
 * the request up to each mark, so only content that is byte-identical between
 * calls — and physically ahead of everything that isn't — can be reused.
 *
 *   1. The system instruction. The same for every run at one level and tone, so
 *      where it clears the model's minimum on its own it stays warm across runs,
 *      not just within one. The owner's profile rules do; the tailoring rules
 *      sit right around Sonnet's minimum, and the one-off features' are far
 *      below it.
 *   2. `cachePrefix`, the first thing in the user message: what every pass of one
 *      run repeats, which is the job description (lib/run-optimization.ts).
 *
 * Anything that differs per call goes after both, in `prompt`. A prefix shorter
 * than the model's minimum (1,024 tokens on Sonnet 4.5 and 5, 512 on Opus 5,
 * 4,096 on Haiku 4.5) silently isn't cached, which costs nothing; that is why
 * the job description rides behind the system instruction rather than being
 * marked on its own.
 *
 * `usage.cache_read_input_tokens` is the only proof this is working, so every
 * call logs it. If it stays at zero across a run, something ahead of a mark
 * stopped being byte-identical.
 */
const CACHEABLE = { type: 'ephemeral' } as const

/**
 * Models whose safety classifiers can decline a request. For these a declined
 * request is re-run server-side on Anthropic's recommended fallback model rather
 * than failing the whole optimization.
 */
const SERVER_FALLBACK_MODELS = new Set(['claude-opus-5', 'claude-fable-5-1'])

export interface ClaudeModelSummary {
  id: string
  name: string
  /** Context window in tokens; 0 when the API doesn't report one. */
  contextLength: number
  /** Most output tokens per response; 0 when the API doesn't report one. */
  maxOutputTokens: number
}

/** Output caps by model id. They don't vary by account, so look each up once per warm instance. */
const outputCaps = new Map<string, number>()

/**
 * The parts of the request the cache marks sit on. Separate from the call so the
 * checks can read where the marks landed without making a request.
 */
export function claudeRequest(options: { systemInstruction: string; prompt: string; cachePrefix?: string }): {
  system: Anthropic.Beta.BetaTextBlockParam[]
  messages: Anthropic.Beta.BetaMessageParam[]
} {
  const { systemInstruction, prompt, cachePrefix } = options
  return {
    system: [{ type: 'text', text: systemInstruction, cache_control: CACHEABLE }],
    messages: [
      {
        role: 'user',
        content: [
          ...(cachePrefix ? [{ type: 'text' as const, text: cachePrefix, cache_control: CACHEABLE }] : []),
          { type: 'text' as const, text: prompt },
        ],
      },
    ],
  }
}

interface ClaudeUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

/**
 * What one call really read. `input_tokens` counts only the part read at full
 * price, so the cached parts are added back in: the meter is there to show the
 * size of the prompt, not the size of the bill.
 */
export function claudeUsage(usage: ClaudeUsage): { input: number; output: number; read: number; written: number } {
  const read = usage.cache_read_input_tokens ?? 0
  const written = usage.cache_creation_input_tokens ?? 0
  return { input: usage.input_tokens + read + written, output: usage.output_tokens, read, written }
}

export async function generateClaude(options: {
  apiKey: string
  systemInstruction: string
  prompt: string
  /**
   * Text every call in this run repeats, placed at the very start of the user
   * message so it can be cached and read back cheaply. See CACHEABLE above.
   */
  cachePrefix?: string
  model: string
  /** Upper bound for max_tokens; lowered to the model's own output cap. */
  maxOutputTokens: number
  /** Told what the call cost, so a run can meter itself. */
  onUsage?: (usage: CallUsage | null) => void
}): Promise<string> {
  const { apiKey, model, maxOutputTokens, onUsage } = options
  const client = new Anthropic({ apiKey })
  const maxTokens = await outputCapFor(client, model, maxOutputTokens)

  const message = await withRetries('anthropic', () => {
    console.log(`[anthropic] Requesting ${model} (max_tokens ${maxTokens})`)
    return client.beta.messages
      .stream({
        model,
        max_tokens: maxTokens,
        ...claudeRequest(options),
        ...(SERVER_FALLBACK_MODELS.has(model)
          ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
          : {}),
      })
      .finalMessage()
      .catch((err: unknown) => {
        throw claudeFailure(err, model)
      })
  })

  const used = claudeUsage(message.usage)
  console.log(
    `[anthropic] Input ${used.input} tokens: ${used.read} read from cache, ` +
      `${used.written} written to it, ${message.usage.input_tokens} at full price`
  )
  onUsage?.(reportedCall(used.input, used.output, used.read))

  if (message.stop_reason === 'refusal') {
    const category = message.stop_details?.category
    throw new AiCallError(
      `Claude declined this request${category ? ` (${category})` : ''}. ` +
        'Try again, or pick a different model in Settings.',
      'refused'
    )
  }

  if ((message.usage.iterations ?? []).some((entry) => entry.type === 'fallback_message')) {
    console.log(`[anthropic] ${model} declined; served by ${message.model}`)
  }

  const text = message.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')

  if (!text.trim()) {
    throw new AiCallError(
      `Claude model "${model}" returned no text (stop_reason: ${message.stop_reason}). ` +
        'Try a different model in Settings.',
      'unusable'
    )
  }
  if (message.stop_reason === 'max_tokens') {
    console.warn(`[anthropic] ${model} stopped at max_tokens (${maxTokens}); the JSON may be cut off`)
  }

  console.log(`[anthropic] Response received (${text.length} chars, stop_reason: ${message.stop_reason})`)
  return text
}

/** Every model the key can use, newest first — for the Settings picker. */
export async function listClaudeModels(apiKey: string): Promise<ClaudeModelSummary[]> {
  const client = new Anthropic({ apiKey })
  try {
    const models: ClaudeModelSummary[] = []
    for await (const info of client.models.list()) models.push(summarize(info))
    return models
  } catch (err) {
    throw claudeFailure(err)
  }
}

/** Look up one model: validates the key and the id without spending a token. */
export async function describeClaudeModel(apiKey: string, model: string): Promise<ClaudeModelSummary> {
  const client = new Anthropic({ apiKey })
  try {
    return summarize(await client.models.retrieve(model))
  } catch (err) {
    throw claudeFailure(err, model)
  }
}

/**
 * The model's own output cap, when it is lower than what was asked for. The
 * lookup only helps: when it fails for any reason but a wrong key or model,
 * which would fail the real request too, the request goes ahead as asked.
 */
async function outputCapFor(client: Anthropic, model: string, requested: number): Promise<number> {
  const known = outputCaps.get(model)
  if (known !== undefined) return Math.min(requested, known)
  try {
    const cap = (await client.models.retrieve(model)).max_tokens ?? requested
    outputCaps.set(model, cap)
    return Math.min(requested, cap)
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.NotFoundError) {
      throw claudeFailure(err, model)
    }
    console.warn(`[anthropic] Could not look up ${model}; asking for max_tokens ${requested}:`, claudeFailure(err, model).message)
    return requested
  }
}

function summarize(info: Anthropic.ModelInfo): ClaudeModelSummary {
  return {
    id: info.id,
    name: info.display_name,
    contextLength: info.max_input_tokens ?? 0,
    maxOutputTokens: info.max_tokens ?? 0,
  }
}

/** Error types the API reports for its own trouble, not the request's: worth another attempt. */
const PASSING_TROUBLE = new Set(['overloaded_error', 'api_error'])

/** The API's own sentence, without the status and JSON the SDK wraps it in. */
function apiMessage(err: InstanceType<typeof Anthropic.APIError>): string {
  const body = err.error as { error?: { message?: unknown } } | undefined
  return typeof body?.error?.message === 'string' ? body.error.message : err.message
}

/**
 * The SDK's typed errors as messages worth showing, sorted by what can be done
 * about them (lib/ai-errors.ts). Most specific first.
 */
function claudeFailure(err: unknown, model?: string): AiCallError {
  if (err instanceof AiCallError) return err
  const forModel = model ? ` for "${model}"` : ''

  if (err instanceof Anthropic.AuthenticationError) {
    return new AiCallError('The Claude API rejected the API key (401). Check the key in Settings.', 'setup')
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new AiCallError(`This Anthropic key can't use the Claude API${forModel} (403): ${apiMessage(err)}`, 'setup')
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new AiCallError(
      model
        ? `Model "${model}" was not found on the Claude API (404). Pick a different model in Settings.`
        : `The Claude API returned 404: ${apiMessage(err)}`,
      'setup'
    )
  }
  if (err instanceof Anthropic.RateLimitError) {
    // The SDK has already waited and retried for as long as the API asked.
    return new AiCallError(`Claude API rate limit hit (429)${forModel}: ${apiMessage(err)} Wait a moment or switch models.`, 'busy')
  }
  if (err instanceof Anthropic.BadRequestError) {
    // An exhausted credit balance is one of these, as well as a malformed request.
    return new AiCallError(`The Claude API rejected the request${forModel} (400): ${apiMessage(err)}`, 'setup')
  }
  if (err instanceof Anthropic.APIConnectionError) {
    // A timeout is one of these. The SDK has retried already, but a new connection often gets through.
    return new AiCallError(`Could not reach the Claude API: ${err.message}`, 'busy', true)
  }
  if (err instanceof Anthropic.APIError) {
    // An error event partway through a streamed answer carries no HTTP status, only its type.
    if (err.status === undefined) {
      const passing = PASSING_TROUBLE.has(err.type ?? '')
      return new AiCallError(
        `The Claude API stopped partway through the answer${forModel} (${err.type ?? 'no error type'}): ${apiMessage(err)}`,
        passing || err.type === 'rate_limit_error' ? 'busy' : 'unknown',
        passing
      )
    }
    if (err.status >= 500) {
      const what = err.type === 'overloaded_error' ? 'is overloaded' : 'had an error'
      return new AiCallError(`The Claude API ${what} (${err.status})${forModel}: ${apiMessage(err)}`, 'busy', true)
    }
    if (err.status === 402) {
      return new AiCallError(`The Anthropic account behind this key has a billing problem (402): ${apiMessage(err)}`, 'setup')
    }
    return new AiCallError(`Claude API error (${err.status})${forModel}: ${apiMessage(err)}`, 'setup')
  }
  if (err instanceof Anthropic.AnthropicError && (err as { cause?: unknown }).cause) {
    // A network error while the answer streams: the SDK passes it on, wrapped, without retrying.
    return new AiCallError(`The connection to the Claude API broke off${forModel}: ${err.message}`, 'busy', true)
  }
  return new AiCallError(err instanceof Error ? err.message : String(err), 'unknown')
}
