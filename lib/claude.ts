import Anthropic from '@anthropic-ai/sdk'

/**
 * Claude API transport through the official Anthropic SDK.
 *
 * Server-only: the routes call it with a key from Settings or ANTHROPIC_API_KEY,
 * and nothing in the browser bundle may import it. It differs from the
 * OpenAI-compatible adapter in four ways:
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
 */

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

export async function generateClaude(options: {
  apiKey: string
  systemInstruction: string
  prompt: string
  model: string
  /** Upper bound for max_tokens; lowered to the model's own output cap. */
  maxOutputTokens: number
}): Promise<string> {
  const { apiKey, systemInstruction, prompt, model, maxOutputTokens } = options
  const client = new Anthropic({ apiKey })
  const fail = (err: unknown): never => {
    throw new Error(claudeErrorMessage(err, model))
  }

  const maxTokens = await outputCapFor(client, model, maxOutputTokens).catch(fail)
  console.log(`[anthropic] Requesting ${model} (max_tokens ${maxTokens})`)

  const message = await client.beta.messages
    .stream({
      model,
      max_tokens: maxTokens,
      system: systemInstruction,
      messages: [{ role: 'user', content: prompt }],
      ...(SERVER_FALLBACK_MODELS.has(model)
        ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
        : {}),
    })
    .finalMessage()
    .catch(fail)

  if (message.stop_reason === 'refusal') {
    const category = message.stop_details?.category
    throw new Error(
      `Claude declined this request${category ? ` (${category})` : ''}. ` +
        'Try again, or pick a different model in Settings.'
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
    throw new Error(
      `Claude model "${model}" returned no text (stop_reason: ${message.stop_reason}). ` +
        'Try a different model in Settings.'
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
    throw new Error(claudeErrorMessage(err))
  }
}

/** Look up one model: validates the key and the id without spending a token. */
export async function describeClaudeModel(apiKey: string, model: string): Promise<ClaudeModelSummary> {
  const client = new Anthropic({ apiKey })
  try {
    return summarize(await client.models.retrieve(model))
  } catch (err) {
    throw new Error(claudeErrorMessage(err, model))
  }
}

async function outputCapFor(client: Anthropic, model: string, requested: number): Promise<number> {
  let cap = outputCaps.get(model)
  if (cap === undefined) {
    cap = (await client.models.retrieve(model)).max_tokens ?? requested
    outputCaps.set(model, cap)
  }
  return Math.min(requested, cap)
}

function summarize(info: Anthropic.ModelInfo): ClaudeModelSummary {
  return {
    id: info.id,
    name: info.display_name,
    contextLength: info.max_input_tokens ?? 0,
    maxOutputTokens: info.max_tokens ?? 0,
  }
}

/** The SDK's typed errors turned into messages worth showing, most specific first. */
function claudeErrorMessage(err: unknown, model?: string): string {
  const forModel = model ? ` for "${model}"` : ''
  if (err instanceof Anthropic.AuthenticationError) {
    return 'The Claude API rejected the API key (401). Check the key in Settings.'
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return `This Anthropic key can't use the Claude API${forModel} (403): ${err.message}`
  }
  if (err instanceof Anthropic.NotFoundError) {
    return model
      ? `Model "${model}" was not found on the Claude API (404). Pick a different model in Settings.`
      : `The Claude API returned 404: ${err.message}`
  }
  if (err instanceof Anthropic.RateLimitError) {
    return `Claude API rate limit hit (429)${forModel}. Wait a moment or switch models.`
  }
  if (err instanceof Anthropic.BadRequestError) {
    return `The Claude API rejected the request${forModel} (400): ${err.message}`
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return `Could not reach the Claude API: ${err.message}`
  }
  if (err instanceof Anthropic.APIError) {
    return `Claude API error (${err.status ?? 'no status'})${forModel}: ${err.message}`
  }
  return err instanceof Error ? err.message : String(err)
}
