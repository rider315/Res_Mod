import { GoogleGenerativeAI } from '@google/generative-ai'
import { AIProvider } from '@/types/resume'
import { getProvider, ProviderConfig } from '@/lib/providers'
import { extractJSON, estimateTokens } from '@/lib/json-repair'

/**
 * Server-side provider dispatch.
 *
 * Every provider except Gemini speaks the OpenAI chat-completions dialect, so one
 * adapter covers them all — the differences live in lib/providers.ts. Puter never
 * reaches this module: it runs entirely in the browser (see lib/puter.ts).
 */

interface AIRequestOptions {
  provider: AIProvider
  apiKey: string
  systemInstruction: string
  prompt: string
  temperature: number
  model?: string
}

/**
 * Pick the API key to use: the one the user typed in Settings wins, otherwise
 * fall back to the provider's server-side env var. Providers that need no key
 * (Ollama, Puter) return an empty string.
 */
export function resolveApiKey(provider: AIProvider, clientKey?: string): string {
  const config = getProvider(provider)
  const userKey = clientKey?.trim()
  if (userKey) return userKey
  if (!config.needsKey) return ''

  const envKey = config.envVar ? process.env[config.envVar]?.trim() : undefined
  if (envKey) return envKey

  throw new Error(
    `No ${config.label} API key configured. Add one in Settings (gear icon), ` +
    `or set ${config.envVar} in .env.local.`
  )
}

/** Settings value wins, then the provider's env override, then its built-in default. */
export function resolveModel(provider: AIProvider, model?: string): string {
  const chosen = model?.trim()
  if (chosen) return chosen

  if (provider === 'openrouter') {
    const fromEnv = process.env.OPENROUTER_MODEL?.trim()
    if (fromEnv) return fromEnv
  }
  return getProvider(provider).defaultModel
}

/** Base URL override, so Ollama can live somewhere other than localhost. */
export function resolveBaseUrl(config: ProviderConfig): string {
  if (config.id === 'ollama') {
    const fromEnv = process.env.OLLAMA_BASE_URL?.trim()
    if (fromEnv) return fromEnv.replace(/\/$/, '')
  }
  return config.baseUrl ?? ''
}

/**
 * Unified AI generation function that dispatches to the chosen provider.
 * Returns the raw text response (expected to be valid JSON).
 */
export async function generateAIResponse(options: AIRequestOptions): Promise<string> {
  const { provider, apiKey, systemInstruction, prompt, temperature, model } = options
  const config = getProvider(provider)

  if (config.transport === 'puter') {
    throw new Error('Puter runs in the browser and cannot be called from the server.')
  }

  if (config.transport === 'gemini') {
    return generateGemini(apiKey, systemInstruction, prompt, temperature, resolveModel(provider, model))
  }

  return generateOpenAICompatible(config, apiKey, systemInstruction, prompt, temperature, model)
}

// ─── Gemini ──────────────────────────────────────────────────────────────────

async function generateGemini(
  apiKey: string,
  systemInstruction: string,
  prompt: string,
  temperature: number,
  model: string
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey)
  const generativeModel = genAI.getGenerativeModel({
    model,
    systemInstruction,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature,
    },
  })

  const result = await generativeModel.generateContent(prompt)
  return result.response.text()
}

// ─── OpenAI-compatible providers ─────────────────────────────────────────────

const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 5_000

/** Helper to pause execution for a given number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildHeaders(config: ProviderConfig, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  if (config.id === 'openrouter') {
    // Optional attribution headers — they put the app on your OpenRouter activity page.
    headers['HTTP-Referer'] =
      process.env.OPENROUTER_SITE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000'
    headers['X-Title'] = process.env.OPENROUTER_SITE_NAME || 'ResMod Resume Optimizer'
  }
  return headers
}

/** Turn a provider error payload into something worth showing the user. */
export function providerErrorMessage(
  config: ProviderConfig,
  status: number,
  body: string,
  model: string
): string {
  let detail = body
  try {
    const parsed = JSON.parse(body)
    detail = parsed?.error?.message || parsed?.message || parsed?.detail || body
  } catch {
    // Not JSON — use the raw body
  }
  const short = String(detail).slice(0, 400)

  switch (status) {
    case 401:
    case 403:
      return `${config.label} rejected the API key (${status}). Check the key in Settings. ${short}`
    case 402:
      return `${config.label} needs credits for this request (402). Pick a free model or top up. Model: ${model}.`
    case 404:
      return `Model "${model}" was not found on ${config.label} (404). Pick a different model in Settings.`
    case 429:
      return `${config.label} rate limit hit (429) for "${model}". Wait a moment or switch models. ${short}`
    default:
      return `${config.label} API error (${status}) for model "${model}": ${short}`
  }
}

/** Message content can come back as a plain string or as OpenAI-style content parts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readMessageContent(message: any): string {
  if (!message) return ''
  const { content, reasoning } = message
  if (typeof content === 'string' && content.trim()) return content
  if (Array.isArray(content)) {
    const joined = content
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((part: any) => (typeof part === 'string' ? part : part?.text ?? ''))
      .join('')
    if (joined.trim()) return joined
  }
  // Reasoning models occasionally put the whole answer in `reasoning` when they
  // run out of tokens before emitting content.
  if (typeof reasoning === 'string' && reasoning.trim()) return reasoning
  return ''
}

interface CallOptions {
  /** Send response_format: json_object. Dropped automatically if unsupported. */
  useJsonMode: boolean
  /** Send max_tokens. Dropped automatically if the model rejects the value. */
  useMaxTokens: boolean
}

async function callChatCompletions(
  config: ProviderConfig,
  apiKey: string,
  model: string,
  systemContent: string,
  userContent: string,
  temperature: number,
  opts: CallOptions
): Promise<{ rawText: string; finishReason: string }> {
  const baseUrl = resolveBaseUrl(config)
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: Record<string, any> = {
      model,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent },
      ],
      temperature,
    }
    if (opts.useJsonMode) body.response_format = { type: 'json_object' }
    if (opts.useMaxTokens && config.maxOutputTokens) body.max_tokens = config.maxOutputTokens

    let response: Response
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: buildHeaders(config, apiKey),
        body: JSON.stringify(body),
      })
    } catch (err) {
      // Ollama is the common case here: the local server simply isn't running.
      if (config.id === 'ollama') {
        throw new Error(
          `Could not reach Ollama at ${baseUrl}. Start it with "ollama serve" and make sure ` +
          `you have pulled the model ("ollama pull ${model}").`
        )
      }
      throw new Error(`Could not reach ${config.label} at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`)
    }

    if (response.ok) {
      const data = await response.json()

      // Some gateways return HTTP 200 with an error payload when the upstream fails.
      if (data?.error) {
        const upstreamStatus = Number(data.error.code) || 502
        if (upstreamStatus === 429 && attempt < MAX_RETRIES) {
          const waitMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt)
          console.warn(`[${config.id}] Upstream 429 inside a 200 body. Waiting ${waitMs / 1000}s…`)
          await sleep(waitMs)
          lastError = new Error(providerErrorMessage(config, 429, JSON.stringify(data.error), model))
          continue
        }
        throw new Error(providerErrorMessage(config, upstreamStatus, JSON.stringify(data.error), model))
      }

      return {
        rawText: readMessageContent(data.choices?.[0]?.message),
        finishReason: data.choices?.[0]?.finish_reason ?? 'unknown',
      }
    }

    const errorBody = await response.text()
    const badRequest = response.status === 400 || response.status === 404 || response.status === 422

    // Not every model implements JSON mode — retry without it rather than failing.
    if (opts.useJsonMode && badRequest && /response_format|json/i.test(errorBody)) {
      console.warn(`[${config.id}] ${model} rejected response_format — retrying without JSON mode`)
      return callChatCompletions(config, apiKey, model, systemContent, userContent, temperature, {
        ...opts,
        useJsonMode: false,
      })
    }

    // Some models cap completion tokens below our default — retry without the cap.
    if (opts.useMaxTokens && badRequest && /max_tokens|max_completion_tokens/i.test(errorBody)) {
      console.warn(`[${config.id}] ${model} rejected max_tokens — retrying without it`)
      return callChatCompletions(config, apiKey, model, systemContent, userContent, temperature, {
        ...opts,
        useMaxTokens: false,
      })
    }

    // Rate limits and transient upstream failures are worth retrying.
    const retryable = response.status === 429 || response.status >= 500
    if (retryable && attempt < MAX_RETRIES) {
      const retryAfterHeader = response.headers.get('retry-after')
      const retryAfterSecs = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN
      const waitMs = Number.isNaN(retryAfterSecs)
        ? INITIAL_BACKOFF_MS * Math.pow(2, attempt)
        : retryAfterSecs * 1000

      console.warn(
        `[${config.id}] ${response.status} on attempt ${attempt + 1}/${MAX_RETRIES + 1}. ` +
        `Waiting ${Math.round(waitMs / 1000)}s before retry… (model: ${model})`
      )
      await sleep(waitMs)
      lastError = new Error(providerErrorMessage(config, response.status, errorBody, model))
      continue
    }

    console.error(`[${config.id}] API error (model=${model}):`, response.status, errorBody.slice(0, 500))
    throw new Error(providerErrorMessage(config, response.status, errorBody, model))
  }

  throw lastError ?? new Error(`${config.label}: max retries exhausted`)
}

async function generateOpenAICompatible(
  config: ProviderConfig,
  apiKey: string,
  systemInstruction: string,
  prompt: string,
  temperature: number,
  model?: string
): Promise<string> {
  const targetModel = config.compressPrompt
    ? (model?.trim() || (await pickCerebrasModel(config, apiKey)))
    : resolveModel(config.id, model)

  const jsonSuffix =
    '\n\nIMPORTANT: Respond with ONLY valid JSON. No markdown fences, no explanation — just the raw JSON object.'

  let systemContent = systemInstruction
  let userContent = prompt + jsonSuffix

  if (config.compressPrompt) {
    ;({ systemContent, userContent } = compressForSmallContext(systemContent, userContent, jsonSuffix))
  }

  console.log(
    `[${config.id}] Requesting ${targetModel} ` +
    `(~${estimateTokens(systemContent) + estimateTokens(userContent)} input tokens)`
  )

  const result = await callChatCompletions(
    config,
    apiKey,
    targetModel,
    systemContent,
    userContent,
    temperature,
    { useJsonMode: true, useMaxTokens: true }
  )

  if (!result.rawText.trim()) {
    console.error(`[${config.id}] Empty response. finish_reason:`, result.finishReason)
    throw new Error(
      `${config.label} model "${targetModel}" returned an empty response ` +
      `(finish_reason: ${result.finishReason}). Try a different model in Settings — ` +
      'reasoning models and very small models often struggle with this prompt.'
    )
  }

  console.log(
    `[${config.id}] Response received (${result.rawText.length} chars, finish_reason: ${result.finishReason})`
  )

  const extracted = extractJSON(result.rawText)
  if (extracted) return extracted

  console.warn(`[${config.id}] Could not extract valid JSON. First 500 chars:`, result.rawText.slice(0, 500))
  return result.rawText.trim()
}

// ─── Cerebras-specific handling (small context, tight token limits) ───────────

// Priority-ordered list — we pick the first one the account actually has.
const CEREBRAS_MODEL_PRIORITY = [
  'llama-3.3-70b',
  'llama3.3-70b',
  'llama3.1-8b',
  'llama-3.1-8b',
  'qwen-3-32b',
  'qwen3-32b',
  'deepseek-r1-distill-llama-70b',
]

async function pickCerebrasModel(config: ProviderConfig, apiKey: string): Promise<string> {
  try {
    const res = await fetch(`${resolveBaseUrl(config)}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) {
      console.warn(`[cerebras] /models returned ${res.status}, trying the priority list directly`)
      return CEREBRAS_MODEL_PRIORITY[0]
    }
    const data = await res.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ids: string[] = (data.data || []).map((m: any) => m.id)

    for (const candidate of CEREBRAS_MODEL_PRIORITY) {
      if (ids.includes(candidate)) return candidate
    }
    if (ids.length > 0) return ids[0]

    throw new Error(
      'No models available on your Cerebras account. Check your API key and account status at cloud.cerebras.ai'
    )
  } catch (err) {
    if (err instanceof Error && err.message.includes('No models available')) throw err
    console.warn('[cerebras] Failed to fetch the model list, falling back:', err)
    return CEREBRAS_MODEL_PRIORITY[0]
  }
}

// Maximum input tokens to target for small-context models (leaves room for output)
const SMALL_CONTEXT_MAX_INPUT_TOKENS = 6000

/**
 * Compress a prompt by removing redundant whitespace, duplicate instructions,
 * and verbose examples to fit within a small context window.
 */
function compressText(text: string): string {
  const compressed = text
    // Collapse multiple blank lines into one
    .replace(/\n{3,}/g, '\n\n')
    // Remove horizontal rule-style section dividers
    .replace(/^[-─═]{3,}.*$/gm, '')
    // Collapse multiple spaces (preserve leading indentation)
    .replace(/([^\n]) {2,}/g, '$1 ')
    // Drop illustrative examples — they are the most expendable tokens
    .replace(/^\s*-?\s*Example:.*$/gm, '')
    .replace(/^\s*-?\s*e\.g\.,.*$/gm, '')

  // Drop repeated long lines (the prompts restate several rules verbatim)
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const line of compressed.split('\n')) {
    const normalized = line.trim().toLowerCase()
    if (normalized.length > 40 && seen.has(normalized)) continue
    if (normalized.length > 40) seen.add(normalized)
    deduped.push(line)
  }

  return deduped.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function compressForSmallContext(
  systemInstruction: string,
  prompt: string,
  jsonSuffix: string
): { systemContent: string; userContent: string } {
  let systemContent = compressText(systemInstruction)
  let userContent = compressText(prompt)

  const total = estimateTokens(systemContent) + estimateTokens(userContent)
  if (total <= SMALL_CONTEXT_MAX_INPUT_TOKENS) return { systemContent, userContent }

  const systemBudget = Math.floor(SMALL_CONTEXT_MAX_INPUT_TOKENS * 0.2) * 4
  const promptBudget = Math.floor(SMALL_CONTEXT_MAX_INPUT_TOKENS * 0.8) * 4

  if (systemContent.length > systemBudget) {
    systemContent = systemContent.slice(0, systemBudget) + '\n[Truncated. Follow rules above.]'
  }

  if (userContent.length > promptBudget) {
    // Preserve the OUTPUT FORMAT section — without it the response shape is anyone's guess.
    const outputFormatIdx = userContent.indexOf('## OUTPUT FORMAT')
    if (outputFormatIdx > 0) {
      const beforeFormat = userContent.slice(0, outputFormatIdx)
      const fromFormat = userContent.slice(outputFormatIdx)
      const availableForBefore = promptBudget - fromFormat.length
      userContent =
        availableForBefore > 0
          ? beforeFormat.slice(0, availableForBefore) + '\n\n' + fromFormat
          : userContent.slice(0, promptBudget) + jsonSuffix
    } else {
      userContent = userContent.slice(0, promptBudget) + jsonSuffix
    }
  }

  console.log(
    `[cerebras] Compressed to ~${estimateTokens(systemContent) + estimateTokens(userContent)} input tokens`
  )
  return { systemContent, userContent }
}
