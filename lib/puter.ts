import { extractJSON } from '@/lib/json-repair'

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
 * Run one chat completion through Puter and return the raw JSON text.
 * Mirrors the contract of generateAIResponse on the server side.
 */
export async function generatePuterResponse(options: {
  systemInstruction: string
  prompt: string
  temperature: number
  model?: string
}): Promise<string> {
  const { systemInstruction, prompt, temperature, model } = options
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
    const message = err instanceof Error ? err.message : String(err)
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

  return extractJSON(rawText) ?? rawText.trim()
}
