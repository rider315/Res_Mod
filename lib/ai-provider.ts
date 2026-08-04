import { GoogleGenerativeAI } from '@google/generative-ai'
import { AIProvider } from '@/types/resume'
import { DEFAULT_OPENROUTER_MODEL, OPENROUTER_BASE_URL } from '@/lib/openrouter-models'

// Re-export for use by optimizer/revamper as a fallback JSON parser
export { extractJSON }

interface AIRequestOptions {
  provider: AIProvider
  apiKey: string
  systemInstruction: string
  prompt: string
  temperature: number
  /** OpenRouter model id. Ignored by the other providers. */
  model?: string
}

const PROVIDER_LABELS: Record<AIProvider, string> = {
  openrouter: 'OpenRouter',
  gemini: 'Gemini',
  cerebras: 'Cerebras',
}

const PROVIDER_ENV_VARS: Record<AIProvider, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  gemini: 'GEMINI_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
}

/**
 * Pick the API key to use: the one the user typed in Settings wins, otherwise
 * fall back to the provider's server-side env var.
 */
export function resolveApiKey(provider: AIProvider, clientKey?: string): string {
  const userKey = clientKey?.trim()
  if (userKey) return userKey

  const envKey = process.env[PROVIDER_ENV_VARS[provider]]?.trim()
  if (envKey) return envKey

  throw new Error(
    `No ${PROVIDER_LABELS[provider]} API key configured. ` +
    `Add one in Settings (gear icon), or set ${PROVIDER_ENV_VARS[provider]} in .env.local.`
  )
}

/** Settings value wins, then OPENROUTER_MODEL from env, then the built-in default. */
export function resolveOpenRouterModel(model?: string): string {
  return model?.trim() || process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL
}

/**
 * Unified AI generation function that dispatches to the chosen provider.
 * Returns the raw text response (expected to be valid JSON).
 */
export async function generateAIResponse(options: AIRequestOptions): Promise<string> {
  const { provider, apiKey, systemInstruction, prompt, temperature, model } = options

  if (provider === 'openrouter') {
    return generateOpenRouter(apiKey, systemInstruction, prompt, temperature, model)
  }

  if (provider === 'cerebras') {
    return generateCerebras(apiKey, systemInstruction, prompt, temperature)
  }

  // Default: Gemini
  return generateGemini(apiKey, systemInstruction, prompt, temperature)
}

// ─── Gemini ──────────────────────────────────────────────────────────────────

async function generateGemini(
  apiKey: string,
  systemInstruction: string,
  prompt: string,
  temperature: number
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-pro',
    systemInstruction,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature,
    },
  })

  const result = await model.generateContent(prompt)
  return result.response.text()
}

// ─── OpenRouter (OpenAI-compatible) ──────────────────────────────────────────

const OPENROUTER_MAX_RETRIES = 3
const OPENROUTER_INITIAL_BACKOFF_MS = 5_000
const OPENROUTER_MAX_OUTPUT_TOKENS = 8192

/**
 * OpenRouter asks for two optional attribution headers. They are what makes the
 * app show up on the openrouter.ai activity/leaderboard pages — harmless if unset.
 */
function openRouterHeaders(apiKey: string): Record<string, string> {
  const referer =
    process.env.OPENROUTER_SITE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000'
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': referer,
    'X-Title': process.env.OPENROUTER_SITE_NAME || 'ResMod Resume Optimizer',
  }
}

/** Turn an OpenRouter error payload into something worth showing the user. */
export function openRouterErrorMessage(status: number, body: string, model: string): string {
  let detail = body
  try {
    const parsed = JSON.parse(body)
    detail = parsed?.error?.message || parsed?.message || body
  } catch {
    // Not JSON — use the raw body
  }
  const short = detail.slice(0, 400)

  switch (status) {
    case 401:
      return 'OpenRouter rejected the API key (401). Check the key in Settings — it should start with "sk-or-v1-".'
    case 402:
      return `OpenRouter says this request needs credits (402). Either add credits at openrouter.ai/credits or pick a ":free" model. Model: ${model}.`
    case 403:
      return `OpenRouter blocked the request (403) — the model may need extra privacy settings enabled at openrouter.ai/settings/privacy. Model: ${model}. ${short}`
    case 404:
      return `Model "${model}" was not found on OpenRouter (404). Pick a different model in Settings.`
    case 429:
      return `OpenRouter rate limit hit (429) for "${model}". Free models are limited per minute/day — wait a moment or switch models. ${short}`
    default:
      return `OpenRouter API error (${status}) for model "${model}": ${short}`
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

async function callOpenRouterAPI(
  apiKey: string,
  model: string,
  systemContent: string,
  userContent: string,
  temperature: number,
  useJsonMode: boolean
): Promise<{ rawText: string; finishReason: string }> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= OPENROUTER_MAX_RETRIES; attempt++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: Record<string, any> = {
      model,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent },
      ],
      temperature,
      max_tokens: OPENROUTER_MAX_OUTPUT_TOKENS,
    }
    if (useJsonMode) body.response_format = { type: 'json_object' }

    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify(body),
    })

    if (response.ok) {
      const data = await response.json()

      // OpenRouter can return HTTP 200 with an error payload when the upstream
      // provider fails mid-stream.
      if (data?.error) {
        const upstreamStatus = Number(data.error.code) || 502
        if (upstreamStatus === 429 && attempt < OPENROUTER_MAX_RETRIES) {
          const waitMs = OPENROUTER_INITIAL_BACKOFF_MS * Math.pow(2, attempt)
          console.warn(`[openrouter] Upstream 429 in 200 body. Waiting ${waitMs / 1000}s…`)
          await sleep(waitMs)
          lastError = new Error(openRouterErrorMessage(429, JSON.stringify(data.error), model))
          continue
        }
        throw new Error(openRouterErrorMessage(upstreamStatus, JSON.stringify(data.error), model))
      }

      return {
        rawText: readMessageContent(data.choices?.[0]?.message),
        finishReason: data.choices?.[0]?.finish_reason ?? 'unknown',
      }
    }

    const errorBody = await response.text()

    // Some models (mostly the free/community ones) don't implement JSON mode.
    // Retry once without it rather than failing the whole optimization.
    if (useJsonMode && (response.status === 400 || response.status === 404) && /response_format|json/i.test(errorBody)) {
      console.warn(`[openrouter] ${model} rejected response_format — retrying without JSON mode`)
      return callOpenRouterAPI(apiKey, model, systemContent, userContent, temperature, false)
    }

    // Rate limits and transient upstream failures are worth retrying.
    const retryable = response.status === 429 || response.status >= 500
    if (retryable && attempt < OPENROUTER_MAX_RETRIES) {
      const retryAfterHeader = response.headers.get('retry-after')
      const retryAfterSecs = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN
      const waitMs = Number.isNaN(retryAfterSecs)
        ? OPENROUTER_INITIAL_BACKOFF_MS * Math.pow(2, attempt)
        : retryAfterSecs * 1000

      console.warn(
        `[openrouter] ${response.status} on attempt ${attempt + 1}/${OPENROUTER_MAX_RETRIES + 1}. ` +
        `Waiting ${Math.round(waitMs / 1000)}s before retry… (model: ${model})`
      )
      await sleep(waitMs)
      lastError = new Error(openRouterErrorMessage(response.status, errorBody, model))
      continue
    }

    console.error(`[openrouter] API error (model=${model}):`, response.status, errorBody.slice(0, 500))
    throw new Error(openRouterErrorMessage(response.status, errorBody, model))
  }

  throw lastError ?? new Error('OpenRouter: max retries exhausted')
}

async function generateOpenRouter(
  apiKey: string,
  systemInstruction: string,
  prompt: string,
  temperature: number,
  model?: string
): Promise<string> {
  const targetModel = resolveOpenRouterModel(model)

  const jsonSuffix =
    '\n\nIMPORTANT: Respond with ONLY valid JSON. No markdown fences, no explanation — just the raw JSON object.'
  const userContent = prompt + jsonSuffix

  console.log(
    `[openrouter] Requesting ${targetModel} ` +
    `(~${estimateTokens(systemInstruction) + estimateTokens(userContent)} input tokens)`
  )

  const result = await callOpenRouterAPI(
    apiKey,
    targetModel,
    systemInstruction,
    userContent,
    temperature,
    true
  )

  if (!result.rawText.trim()) {
    console.error('[openrouter] Empty response. finish_reason:', result.finishReason)
    throw new Error(
      `OpenRouter model "${targetModel}" returned an empty response (finish_reason: ${result.finishReason}). ` +
      'Try a different model in Settings — reasoning models and very small models often struggle with this prompt.'
    )
  }

  console.log(
    `[openrouter] Response received (${result.rawText.length} chars, finish_reason: ${result.finishReason})`
  )

  const extracted = extractJSON(result.rawText)
  if (extracted) return extracted

  console.warn('[openrouter] Could not extract valid JSON. First 500 chars:', result.rawText.slice(0, 500))
  return result.rawText.trim()
}

// ─── Cerebras (OpenAI-compatible) ────────────────────────────────────────────

const CEREBRAS_BASE_URL = 'https://api.cerebras.ai/v1'

// Priority-ordered list of models to try — we'll pick the first one that's available
const CEREBRAS_MODEL_PRIORITY = [
  'llama-3.3-70b',
  'llama3.3-70b',
  'llama3.1-8b',
  'llama-3.1-8b',
  'qwen-3-32b',
  'qwen3-32b',
  'deepseek-r1-distill-llama-70b',
]

async function fetchAvailableModel(apiKey: string): Promise<string> {
  try {
    const res = await fetch(`${CEREBRAS_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) {
      console.warn(`[cerebras] /models returned ${res.status}, will try priority list directly`)
      return CEREBRAS_MODEL_PRIORITY[0]
    }
    const data = await res.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ids: string[] = (data.data || []).map((m: any) => m.id)
    console.log('[cerebras] Available models:', ids)

    // Try our priority list first
    for (const candidate of CEREBRAS_MODEL_PRIORITY) {
      if (ids.includes(candidate)) {
        console.log(`[cerebras] Selected model: ${candidate}`)
        return candidate
      }
    }

    // If none of our preferred models match, just pick the first available one
    if (ids.length > 0) {
      console.log(`[cerebras] No preferred model found, using first available: ${ids[0]}`)
      return ids[0]
    }

    throw new Error('No models available on your Cerebras account. Please check your API key and account status at cloud.cerebras.ai')
  } catch (err) {
    if (err instanceof Error && err.message.includes('No models available')) throw err
    console.warn('[cerebras] Failed to fetch models list, trying llama-3.3-70b:', err)
    return CEREBRAS_MODEL_PRIORITY[0]
  }
}

/**
 * Compress a prompt by removing redundant whitespace, duplicate instructions,
 * and verbose examples to fit within Cerebras's smaller context window.
 * Rough estimate: ~4 chars per token, Cerebras models typically support 8K–128K context.
 */
function compressForCerebras(text: string, level: 'light' | 'aggressive' = 'light'): string {
  let compressed = text
    // Collapse multiple blank lines into one
    .replace(/\n{3,}/g, '\n\n')
    // Remove horizontal rule-style section dividers
    .replace(/^[-─═]{3,}.*$/gm, '')
    // Collapse multiple spaces (preserve leading indentation)
    .replace(/([^\n]) {2,}/g, '$1 ')

  if (level === 'aggressive') {
    // Remove all "Example:" lines and the example content that follows
    compressed = compressed.replace(/^\s*-?\s*Example:.*$/gm, '')
    compressed = compressed.replace(/^\s*-?\s*e\.g\.,.*$/gm, '')
    // Remove lines that are purely instructional duplication (e.g., "CRITICAL", "IMPORTANT" reminders repeated)
    const lines = compressed.split('\n')
    const seen = new Set<string>()
    const deduped: string[] = []
    for (const line of lines) {
      const normalized = line.trim().toLowerCase()
      // Skip empty lines and lines we've seen before (exact duplication)
      if (normalized.length > 40 && seen.has(normalized)) continue
      if (normalized.length > 40) seen.add(normalized)
      deduped.push(line)
    }
    compressed = deduped.join('\n')
    // Collapse blank lines again after dedup
    compressed = compressed.replace(/\n{3,}/g, '\n\n')
  }

  return compressed.trim()
}

/**
 * Estimate token count (rough: ~4 chars per token for English text)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// Maximum input tokens to target for Cerebras models (leave room for output)
const CEREBRAS_MAX_INPUT_TOKENS = 6000

/** Helper to pause execution for a given number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Retry config for rate-limited requests
const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 15_000 // 15 seconds — Cerebras TPM limits reset per minute
const BACKOFF_MULTIPLIER = 2

async function callCerebrasAPI(
  apiKey: string,
  model: string,
  systemContent: string,
  userContent: string,
  temperature: number
): Promise<{ rawText: string; finishReason: string }> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(`${CEREBRAS_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: userContent },
        ],
        temperature,
        max_completion_tokens: 8192,
      }),
    })

    if (response.ok) {
      const data = await response.json()
      return {
        rawText: data.choices?.[0]?.message?.content ?? '',
        finishReason: data.choices?.[0]?.finish_reason ?? 'unknown',
      }
    }

    const errorBody = await response.text()

    // Handle rate limiting (429) with exponential backoff
    if (response.status === 429 && attempt < MAX_RETRIES) {
      // Try to extract retry-after header, otherwise use exponential backoff
      const retryAfterHeader = response.headers.get('retry-after')
      let waitMs: number

      if (retryAfterHeader) {
        // retry-after can be seconds (integer) or an HTTP date
        const retryAfterSecs = parseInt(retryAfterHeader, 10)
        waitMs = isNaN(retryAfterSecs) ? INITIAL_BACKOFF_MS : retryAfterSecs * 1000
      } else {
        waitMs = INITIAL_BACKOFF_MS * Math.pow(BACKOFF_MULTIPLIER, attempt)
      }

      console.warn(
        `[cerebras] Rate limited (429) on attempt ${attempt + 1}/${MAX_RETRIES + 1}. ` +
        `Waiting ${Math.round(waitMs / 1000)}s before retry… (model: ${model})`
      )
      await sleep(waitMs)
      lastError = new Error(`Cerebras API rate limited (429): ${errorBody}`)
      continue
    }

    // Non-retryable error or max retries exhausted
    console.error(`[cerebras] API error (model=${model}):`, response.status, errorBody)
    throw new Error(`Cerebras API error (${response.status}): ${errorBody}`)
  }

  // Should only reach here if all retries were exhausted on 429s
  throw lastError ?? new Error('Cerebras API: max retries exhausted')
}

/**
 * Try to extract a valid JSON object from a string that may contain
 * markdown fences, explanatory text, or other wrapper content.
 */
function extractJSON(text: string): string | null {
  if (!text || !text.trim()) return null

  let cleaned = text.trim()

  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  cleaned = cleaned
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim()

  // Try direct parse first
  try {
    JSON.parse(cleaned)
    return cleaned
  } catch {
    // Continue to extraction strategies
  }

  // Strategy 1: Find the first { and last } to extract the JSON object
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = cleaned.slice(firstBrace, lastBrace + 1)
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      // Continue — might be truncated
    }
  }

  // Strategy 2: JSON was truncated (no closing }). Try to repair it.
  if (firstBrace !== -1) {
    const partial = cleaned.slice(firstBrace)
    const repaired = repairTruncatedJSON(partial)
    if (repaired) {
      try {
        JSON.parse(repaired)
        return repaired
      } catch {
        // Give up
      }
    }
  }

  return null
}

/**
 * Attempt to repair a truncated JSON string by closing open structures.
 * This handles the common case where the model's output was cut off mid-response.
 */
function repairTruncatedJSON(partial: string): string | null {
  if (!partial.startsWith('{')) return null

  let repaired = partial.trim()

  // Remove any trailing incomplete string (ends mid-string without closing quote)
  // e.g., ..."reason": "this was trun
  repaired = repaired.replace(/,\s*"[^"]*":\s*"[^"]*$/, '')
  repaired = repaired.replace(/,\s*"[^"]*":\s*$/, '')
  repaired = repaired.replace(/,\s*"[^"]*$/, '')
  // Remove trailing comma
  repaired = repaired.replace(/,\s*$/, '')

  // Count open brackets/braces and close them
  let openBraces = 0
  let openBrackets = 0
  let inString = false
  let escaped = false

  for (const char of repaired) {
    if (escaped) { escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (char === '"') { inString = !inString; continue }
    if (inString) continue
    if (char === '{') openBraces++
    if (char === '}') openBraces--
    if (char === '[') openBrackets++
    if (char === ']') openBrackets--
  }

  // If we're still inside a string, close it
  if (inString) {
    repaired += '"'
  }

  // Close open brackets and braces
  while (openBrackets > 0) { repaired += ']'; openBrackets-- }
  while (openBraces > 0) { repaired += '}'; openBraces-- }

  return repaired
}

async function generateCerebras(
  apiKey: string,
  systemInstruction: string,
  prompt: string,
  temperature: number
): Promise<string> {
  const targetModel = await fetchAvailableModel(apiKey)

  const jsonSuffix = '\n\nIMPORTANT: Respond with ONLY valid JSON. No markdown, no explanation — just the raw JSON object.'

  // Always use aggressive compression for Cerebras to stay within token limits
  let compressedSystem = compressForCerebras(systemInstruction, 'aggressive')
  let compressedPrompt = compressForCerebras(prompt, 'aggressive') + jsonSuffix

  let inputTokens = estimateTokens(compressedSystem) + estimateTokens(compressedPrompt)
  console.log(`[cerebras] Estimated input tokens: ${inputTokens} (model: ${targetModel})`)

  // If still too large, truncate aggressively
  if (inputTokens > CEREBRAS_MAX_INPUT_TOKENS) {
    const systemBudget = Math.floor(CEREBRAS_MAX_INPUT_TOKENS * 0.20) * 4 // 20% for system
    const promptBudget = Math.floor(CEREBRAS_MAX_INPUT_TOKENS * 0.80) * 4 // 80% for user prompt

    if (compressedSystem.length > systemBudget) {
      compressedSystem = compressedSystem.slice(0, systemBudget) + '\n[Truncated. Follow rules above.]'
    }
    if (compressedPrompt.length > promptBudget) {
      // Preserve OUTPUT FORMAT section if present
      const outputFormatIdx = compressedPrompt.indexOf('## OUTPUT FORMAT')
      if (outputFormatIdx > 0) {
        const beforeFormat = compressedPrompt.slice(0, outputFormatIdx)
        const fromFormat = compressedPrompt.slice(outputFormatIdx)
        const availableForBefore = promptBudget - fromFormat.length
        if (availableForBefore > 0) {
          compressedPrompt = beforeFormat.slice(0, availableForBefore) + '\n\n' + fromFormat
        } else {
          compressedPrompt = compressedPrompt.slice(0, promptBudget) + jsonSuffix
        }
      } else {
        compressedPrompt = compressedPrompt.slice(0, promptBudget) + jsonSuffix
      }
    }

    inputTokens = estimateTokens(compressedSystem) + estimateTokens(compressedPrompt)
    console.log(`[cerebras] After truncation — estimated input tokens: ${inputTokens}`)
  }

  const result = await callCerebrasAPI(apiKey, targetModel, compressedSystem, compressedPrompt, temperature)

  if (!result.rawText.trim()) {
    console.error('[cerebras] Model returned empty response. finish_reason:', result.finishReason)
    throw new Error(
      'Cerebras returned an empty response. ' +
      'This usually means the prompt is too large for the model. ' +
      'Try using Gemini instead, or shorten your job description.'
    )
  }

  console.log(`[cerebras] Response received (${result.rawText.length} chars, finish_reason: ${result.finishReason})`)

  // Try to extract and optionally repair the JSON from the response
  const extracted = extractJSON(result.rawText)
  if (extracted) {
    return extracted
  }

  // If extraction failed, log what we got and return the raw text for the caller to handle
  console.warn('[cerebras] Could not extract valid JSON from response. First 500 chars:', result.rawText.slice(0, 500))
  return result.rawText.trim()
}
