import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { AIProvider } from '@/types/resume'
import { getProvider, PROVIDER_ORDER, ProviderConfig } from '@/lib/providers'
import { resolveApiKey, resolveBaseUrl, resolveModel, providerErrorMessage } from '@/lib/ai-provider'

const schema = z.object({
  provider: z.enum(PROVIDER_ORDER as [AIProvider, ...AIProvider[]]),
  apiKey: z.string().optional(),
  model: z.string().optional(),
})

/**
 * Validates the configured key (and, where possible, the selected model) without
 * burning a full optimization run. Powers the "Test connection" button in Settings.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const { apiKey, model } = parsed.data
  const config = getProvider(parsed.data.provider)

  if (config.transport === 'puter') {
    return NextResponse.json({
      ok: true,
      detail: 'Puter runs in your browser — use the Sign in to Puter button below to verify access.',
      usingServerKey: false,
    })
  }

  try {
    const key = resolveApiKey(config.id, apiKey)
    const usingServerKey = config.needsKey && !apiKey?.trim()
    const targetModel = resolveModel(config.id, model)

    const detail =
      config.id === 'openrouter'
        ? await testOpenRouter(config, key, targetModel)
        : config.transport === 'gemini'
          ? await testGemini(key, targetModel)
          : await testOpenAIStyle(config, key, targetModel)

    return NextResponse.json({ ok: true, detail, usingServerKey })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[ai/test]', config.id, message)
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
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

  const data = await res.json()
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
