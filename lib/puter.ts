import { extractJSON } from '@/lib/json-repair'
import { CallUsage, estimateCall, reportedCall } from '@/lib/ai-usage'

/**
 * Browser-side Puter provider.
 *
 * Puter is different from every other provider here: there is no API key and no
 * server call. puter.js runs in the page, the user signs in to their own Puter
 * account once, and usage bills to that account ("user pays"). That means the
 * optimize/revamp round trip for Puter happens entirely in the browser.
 */

const PUTER_SCRIPT_URL = 'https://js.puter.com/v2/'

interface PuterChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface PuterChatOptions {
  model?: string
  temperature?: number
  max_tokens?: number
  stream?: boolean
}

interface PuterChatResponse {
  message?: { role?: string; content?: unknown }
  /** Token counts, when the model behind Puter reports any. Shape varies by model. */
  usage?: unknown
}

interface PuterGlobal {
  ai: {
    chat: (messages: PuterChatMessage[], options?: PuterChatOptions) => Promise<PuterChatResponse>
    listModels?: () => Promise<unknown>
  }
  auth: {
    isSignedIn: () => boolean
    signIn: () => Promise<unknown>
  }
}

declare global {
  interface Window {
    puter?: PuterGlobal
  }
}

let scriptPromise: Promise<PuterGlobal> | null = null

/** Load puter.js once, on demand — no reason to ship it to users on other providers. */
export function loadPuter(): Promise<PuterGlobal> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Puter is only available in the browser.'))
  }
  if (window.puter) return Promise.resolve(window.puter)
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<PuterGlobal>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PUTER_SCRIPT_URL}"]`)
    const script = existing ?? document.createElement('script')

    script.addEventListener('load', () => {
      if (window.puter) resolve(window.puter)
      else reject(new Error('puter.js loaded but the global "puter" object is missing.'))
    })
    script.addEventListener('error', () => {
      scriptPromise = null
      reject(new Error('Could not load puter.js. Check your network connection or ad blocker.'))
    })

    if (!existing) {
      script.src = PUTER_SCRIPT_URL
      script.async = true
      document.head.appendChild(script)
    }
  })

  return scriptPromise
}

/** Opens Puter's own sign-in popup if the user isn't authenticated yet. */
export async function ensurePuterSignedIn(): Promise<void> {
  const puter = await loadPuter()
  try {
    if (puter.auth.isSignedIn()) return
  } catch {
    // Older builds may not expose isSignedIn — fall through to signIn().
  }
  await puter.auth.signIn()
}

/**
 * Turn whatever Puter rejected with into a readable string.
 *
 * puter.ai.chat does not reject with an Error — it throws a plain object whose
 * shape varies: sometimes `{ success:false, error:{ message, code, delegate } }`,
 * sometimes `{ error:"..." }`, sometimes just `{ message:"..." }`. String()ing
 * any of those gives "[object Object]" and swallows the real cause (model not
 * available, usage-limit delegate, permission denied), so pull the message out
 * by hand and only fall back to JSON as a last resort.
 */
export function puterErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    const inner = e.error

    if (typeof inner === 'string') return inner
    if (inner && typeof inner === 'object') {
      const ie = inner as Record<string, unknown>
      if (typeof ie.message === 'string' && ie.message) return ie.message
      if (typeof ie.delegate === 'string' && ie.delegate) {
        const code = typeof ie.code === 'string' ? ` (${ie.code})` : ''
        return `${ie.delegate}${code}`
      }
    }

    if (typeof e.message === 'string' && e.message) return e.message

    try {
      const json = JSON.stringify(err)
      if (json && json !== '{}') return json
    } catch {
      // Circular or otherwise unserializable — fall through.
    }
  }
  return String(err)
}

/** Pull the text out of Puter's response shape, which varies a little by model. */
function readPuterContent(response: PuterChatResponse): string {
  const content = response?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === 'string' ? part : ((part as { text?: string })?.text ?? '')
      )
      .join('')
  }
  // Some models return the object itself as stringifiable.
  return content ? String(content) : ''
}

/**
 * What the call cost, however this model chose to report it: a list of
 * {type, amount} entries, an object of counts, or nothing at all.
 */
function readPuterUsage(response: PuterChatResponse, input: string, output: string): CallUsage {
  const counts = new Map<string, number>()
  const raw = response?.usage
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const { type, amount } = (entry ?? {}) as { type?: unknown; amount?: unknown }
      if (typeof type === 'string') counts.set(type, Number(amount))
    }
  } else if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) counts.set(key, Number(value))
  }

  const pick = (...names: string[]) => names.map((name) => counts.get(name)).find((value) => Number.isFinite(value))
  return (
    reportedCall(pick('input_tokens', 'prompt_tokens'), pick('output_tokens', 'completion_tokens')) ??
    estimateCall(input, output)
  )
}

/**
 * Run one chat completion through Puter and return the raw JSON text.
 * Mirrors the contract of generateAIResponse on the server side.
 */
export async function generatePuterResponse(options: {
  systemInstruction: string
  prompt: string
  /**
   * The opening every pass of a run repeats. Puter bills the signed-in Puter
   * account and caches nothing, so it is simply the start of the prompt here.
   */
  cachePrefix?: string
  temperature: number
  model?: string
  /** Told what the call cost, so a run can meter itself. */
  onUsage?: (usage: CallUsage) => void
}): Promise<string> {
  const { systemInstruction, temperature, model, onUsage } = options
  const prompt = (options.cachePrefix ?? '') + options.prompt
  const puter = await loadPuter()
  await ensurePuterSignedIn()

  const jsonSuffix =
    '\n\nIMPORTANT: Respond with ONLY valid JSON. No markdown fences, no explanation — just the raw JSON object.'

  let response: PuterChatResponse
  try {
    response = await puter.ai.chat(
      [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt + jsonSuffix },
      ],
      { model: model || 'gpt-5-nano', temperature, max_tokens: 8192 }
    )
  } catch (err: unknown) {
    const message = puterErrorMessage(err)
    throw new Error(
      `Puter request failed: ${message}. ` +
      'Check that you are signed in to Puter and that the selected model is available on your account.'
    )
  }

  const rawText = readPuterContent(response)
  if (!rawText.trim()) {
    throw new Error(
      `Puter model "${model || 'gpt-5-nano'}" returned an empty response. Try a different model in Settings.`
    )
  }

  onUsage?.(readPuterUsage(response, systemInstruction + prompt, rawText))
  return extractJSON(rawText) ?? rawText.trim()
}
