import { AIProvider } from '@/types/resume'
import { getProvider, ProviderConfig } from '@/lib/providers'
import { providerErrorMessage, readProviderJson, resolveBaseUrl } from '@/lib/ai-provider'
import { describeClaudeModel } from '@/lib/claude'

/**
 * Checking that a key works, and where possible that the model exists, without
 * spending a token. Used by the "Test connection" button in AI settings, and
 * before the owner's choice of Chills AI is saved. Throws with a message the
 * user can act on; returns a one-line description when all is well.
 */
export async function checkConnection(providerId: AIProvider, key: string, model: string): Promise<string> {
  const config = getProvider(providerId)
  if (config.transport === 'puter') {
    return 'Puter runs in your browser — use the Sign in to Puter button below to verify access.'
  }
  if (config.id === 'openrouter') return testOpenRouter(config, key, model)
  if (config.transport === 'gemini') return testGemini(key, model)
  if (config.transport === 'anthropic') return testClaude(key, model)
  return testOpenAIStyle(config, key, model)
}

/** Generic check: list models with the key, then confirm the chosen id is there. */
async function testOpenAIStyle(config: ProviderConfig, key: string, model: string): Promise<string> {
  const baseUrl = resolveBaseUrl(config)
  const headers: Record<string, string> = {}
  if (key) headers.Authorization = `Bearer ${key}`

  let res: Response
  try {
    res = await fetch(`${baseUrl}/models`, { headers, cache: 'no-store' })
  } catch (err) {
    if (config.id === 'ollama') {
      throw new Error(`Could not reach Ollama at ${baseUrl}. Start it with "ollama serve".`)
    }
    throw new Error(`Could not reach ${config.label}: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!res.ok) throw new Error(providerErrorMessage(config, res.status, await res.text(), model))

  const data = await readProviderJson(config, res, 'the model catalogue')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ids: string[] = (data.data ?? []).map((m: any) => String(m.id))
  const parts = [`${ids.length} model${ids.length === 1 ? '' : 's'} available`]

  if (model && ids.length > 0) {
    if (!ids.includes(model)) {
      throw new Error(
        `Key works, but model "${model}" is not available on ${config.label}. ` +
        `Pick one of: ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? '…' : ''}`
      )
    }
    parts.push(`· "${model}" ready`)
  }
  return parts.join(' ')
}

/**
 * OpenRouter's /key endpoint reports quota without spending anything, which is
 * more useful than a bare model list.
 */
async function testOpenRouter(config: ProviderConfig, key: string, model: string): Promise<string> {
  const baseUrl = resolveBaseUrl(config)
  const keyRes = await fetch(`${baseUrl}/key`, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' })
  if (!keyRes.ok) throw new Error(providerErrorMessage(config, keyRes.status, await keyRes.text(), model))

  const info = (await keyRes.json())?.data ?? {}
  const parts: string[] = [info.label ? `Key "${info.label}"` : 'Key valid']

  if (typeof info.usage === 'number') {
    parts.push(
      info.limit == null
        ? `· $${info.usage.toFixed(3)} used (no spend limit)`
        : `· $${info.usage.toFixed(3)} of $${Number(info.limit).toFixed(2)} used`
    )
  }
  if (info.is_free_tier) parts.push('· free tier')

  const modelsRes = await fetch(`${baseUrl}/models`, { next: { revalidate: 3600 } })
  if (modelsRes.ok) {
    const catalogue = await modelsRes.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exists = (catalogue.data ?? []).some((m: any) => m.id === model)
    if (!exists) throw new Error(`Key is valid, but model "${model}" is not in the OpenRouter catalogue.`)
    parts.push(`· "${model}" available`)
  }

  return parts.join(' ')
}

/**
 * A model lookup on the Claude API: a bad key fails with 401 and an unknown model
 * with 404, and neither costs a token.
 */
async function testClaude(key: string, model: string): Promise<string> {
  const info = await describeClaudeModel(key, model)
  return `Key accepted by the Claude API · "${info.name}" (${model}) ready`
}

async function testGemini(key: string, model: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=100`,
    { cache: 'no-store' }
  )
  if (!res.ok) throw new Error(`Gemini rejected the key (${res.status}).`)

  const data = await res.json()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ids: string[] = (data.models ?? []).map((m: any) => String(m.name).replace(/^models\//, ''))
  if (model && ids.length > 0 && !ids.includes(model)) {
    throw new Error(`Key works, but model "${model}" is not available to this key.`)
  }
  return `Key accepted by Google AI · "${model}" ready`
}
