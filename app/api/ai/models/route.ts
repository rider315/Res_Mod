import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { AIProvider } from '@/types/resume'
import { getProvider, PROVIDER_ORDER, ProviderConfig } from '@/lib/providers'
import { resolveApiKey, resolveBaseUrl } from '@/lib/ai-provider'

export interface CatalogModel {
  id: string
  name: string
  contextLength: number
  free: boolean
  /** USD per 1M prompt tokens. 0 when free or unknown. */
  promptPricePerM: number
  /** Completion cap, when the provider reports one. Small values risk truncation. */
  maxCompletionTokens: number
}

const schema = z.object({
  provider: z.enum(PROVIDER_ORDER as [AIProvider, ...AIProvider[]]),
  apiKey: z.string().optional(),
})

/**
 * Proxies each provider's model catalogue so the settings picker offers an
 * always-current list rather than a hard-coded one that quietly goes stale.
 *
 * POST rather than GET because most catalogues need the user's API key, which
 * has no business sitting in a query string.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const config = getProvider(parsed.data.provider)
  if (!config.hasModelCatalog) {
    return NextResponse.json({ models: [], static: true })
  }

  try {
    const apiKey = config.catalogNeedsKey ? resolveApiKey(config.id, parsed.data.apiKey) : ''
    const models =
      config.transport === 'gemini'
        ? await fetchGeminiModels(apiKey)
        : await fetchOpenAIStyleModels(config, apiKey)

    return NextResponse.json({ models })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[ai/models]', config.id, message)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

async function fetchOpenAIStyleModels(config: ProviderConfig, apiKey: string): Promise<CatalogModel[]> {
  const baseUrl = resolveBaseUrl(config)
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  let res: Response
  try {
    res = await fetch(`${baseUrl}/models`, {
      headers,
      // Public catalogues change rarely; keyed ones must not be shared between users.
      ...(config.catalogNeedsKey ? { cache: 'no-store' as const } : { next: { revalidate: 3600 } }),
    })
  } catch (err) {
    if (config.id === 'ollama') {
      throw new Error(`Could not reach Ollama at ${baseUrl}. Is "ollama serve" running?`)
    }
    throw new Error(`Could not reach ${config.label}: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${config.label} model list failed (${res.status}): ${body.slice(0, 200)}`)
  }

  const data = await res.json()
  return (data.data ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((m: any): CatalogModel => {
      const promptPrice = parseFloat(m.pricing?.prompt ?? '0') || 0
      const completionPrice = parseFloat(m.pricing?.completion ?? '0') || 0
      // Only OpenRouter mixes free and paid models in one catalogue. Providers
      // like SambaNova publish list prices while still offering a free tier, so
      // their per-model prices would be misleading here.
      const free = config.pricingIsPerModel
        ? (promptPrice === 0 && completionPrice === 0) || String(m.id).endsWith(':free')
        : true
      return {
        id: String(m.id),
        name: String(m.name ?? m.display_name ?? m.id),
        contextLength: Number(m.context_length ?? m.context_window ?? m.max_context_length) || 0,
        free,
        promptPricePerM: config.pricingIsPerModel ? promptPrice * 1_000_000 : 0,
        maxCompletionTokens: Number(m.max_completion_tokens ?? m.max_output_tokens) || 0,
      }
    })
    .filter((m: CatalogModel) => Boolean(m.id))
    .sort((a: CatalogModel, b: CatalogModel) => a.name.localeCompare(b.name))
}

async function fetchGeminiModels(apiKey: string): Promise<CatalogModel[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=100`,
    { cache: 'no-store' }
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Gemini model list failed (${res.status}): ${body.slice(0, 200)}`)
  }

  const data = await res.json()
  return (data.models ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((m: any): CatalogModel => ({
      // The API returns "models/gemini-2.5-pro"; the SDK wants the bare id.
      id: String(m.name).replace(/^models\//, ''),
      name: String(m.displayName ?? m.name),
      contextLength: Number(m.inputTokenLimit) || 0,
      free: true,
      promptPricePerM: 0,
      maxCompletionTokens: Number(m.outputTokenLimit) || 0,
    }))
    .sort((a: CatalogModel, b: CatalogModel) => a.name.localeCompare(b.name))
}
