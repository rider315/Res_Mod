import { GoogleGenerativeAI } from '@google/generative-ai'
import { AIProvider } from '@/types/resume'

interface AIRequestOptions {
  provider: AIProvider
  apiKey: string
  systemInstruction: string
  prompt: string
  temperature: number
}

/**
 * Unified AI generation function that dispatches to the chosen provider.
 * Returns the raw text response (expected to be valid JSON).
 */
export async function generateAIResponse(options: AIRequestOptions): Promise<string> {
  const { provider, apiKey, systemInstruction, prompt, temperature } = options

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

async function callCerebrasAPI(
  apiKey: string,
  model: string,
  systemContent: string,
  userContent: string,
  temperature: number
): Promise<{ rawText: string; finishReason: string }> {
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
      max_completion_tokens: 16384,
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    console.error(`[cerebras] API error (model=${model}):`, response.status, errorBody)
    throw new Error(`Cerebras API error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  return {
    rawText: data.choices?.[0]?.message?.content ?? '',
    finishReason: data.choices?.[0]?.finish_reason ?? 'unknown',
  }
}

async function generateCerebras(
  apiKey: string,
  systemInstruction: string,
  prompt: string,
  temperature: number
): Promise<string> {
  const targetModel = await fetchAvailableModel(apiKey)

  const jsonSuffix = '\n\nCRITICAL: You MUST respond with ONLY a valid JSON object. No markdown fences, no explanation, no extra text — just the raw JSON.'

  // --- Attempt 1: Light compression ---
  const lightSystem = compressForCerebras(systemInstruction, 'light')
  const lightPrompt = compressForCerebras(prompt, 'light') + jsonSuffix

  const inputTokens = estimateTokens(lightSystem) + estimateTokens(lightPrompt)
  console.log(`[cerebras] Attempt 1 — estimated input tokens: ${inputTokens} (model: ${targetModel})`)

  let result = await callCerebrasAPI(apiKey, targetModel, lightSystem, lightPrompt, temperature)

  // --- Attempt 2: If empty, try aggressive compression ---
  if (!result.rawText.trim()) {
    console.warn(`[cerebras] Attempt 1 returned empty (finish_reason: ${result.finishReason}). Retrying with aggressive compression…`)

    const aggressiveSystem = compressForCerebras(systemInstruction, 'aggressive')
    const aggressivePrompt = compressForCerebras(prompt, 'aggressive') + jsonSuffix

    const retryTokens = estimateTokens(aggressiveSystem) + estimateTokens(aggressivePrompt)
    console.log(`[cerebras] Attempt 2 — estimated input tokens: ${retryTokens} (reduced from ${inputTokens})`)

    // If still too large even after aggressive compression, truncate the prompt
    let finalPrompt = aggressivePrompt
    let finalSystem = aggressiveSystem
    if (retryTokens > CEREBRAS_MAX_INPUT_TOKENS) {
      // Prioritize keeping the resume + JD, trim the instruction sections
      const systemBudget = Math.floor(CEREBRAS_MAX_INPUT_TOKENS * 0.25) * 4 // 25% for system
      const promptBudget = Math.floor(CEREBRAS_MAX_INPUT_TOKENS * 0.75) * 4 // 75% for user prompt
      if (finalSystem.length > systemBudget) {
        finalSystem = finalSystem.slice(0, systemBudget) + '\n\n[Instructions truncated for context limit. Follow the rules above.]'
      }
      if (finalPrompt.length > promptBudget) {
        // Find the end of the JD section and truncate after it, keeping the output format
        const outputFormatIdx = finalPrompt.indexOf('## OUTPUT FORMAT')
        if (outputFormatIdx > 0) {
          // Keep everything up to OUTPUT FORMAT plus the format spec, truncate the middle instructions
          const beforeFormat = finalPrompt.slice(0, outputFormatIdx)
          const fromFormat = finalPrompt.slice(outputFormatIdx)
          const availableForBefore = promptBudget - fromFormat.length
          if (availableForBefore > 0) {
            finalPrompt = beforeFormat.slice(0, availableForBefore) + '\n\n' + fromFormat
          } else {
            finalPrompt = finalPrompt.slice(0, promptBudget) + jsonSuffix
          }
        } else {
          finalPrompt = finalPrompt.slice(0, promptBudget) + jsonSuffix
        }
      }
      console.log(`[cerebras] Truncated — system: ${finalSystem.length} chars, prompt: ${finalPrompt.length} chars`)
    }

    result = await callCerebrasAPI(apiKey, targetModel, finalSystem, finalPrompt, temperature)
  }

  if (!result.rawText.trim()) {
    console.error('[cerebras] Model returned empty response after retries. finish_reason:', result.finishReason)
    throw new Error(
      'Cerebras returned an empty response even after prompt compression. ' +
      'This usually means the prompt (resume + job description) is too large for the model. ' +
      'Try using Gemini instead, or shorten your job description.'
    )
  }

  console.log(`[cerebras] Response received (${result.rawText.length} chars, finish_reason: ${result.finishReason})`)

  // Strip markdown code fences if the model wrapped its output
  return result.rawText
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim()
}
