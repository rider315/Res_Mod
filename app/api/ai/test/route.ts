import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { resolveApiKey, resolveOpenRouterModel, openRouterErrorMessage } from '@/lib/ai-provider'
import { OPENROUTER_BASE_URL } from '@/lib/openrouter-models'

const schema = z.object({
  provider: z.enum(['openrouter', 'gemini', 'cerebras']),
  apiKey: z.string().optional(),
  model: z.string().optional(),
})

/**
 * Validates the configured key (and, for OpenRouter, the selected model) without
 * burning a full optimization run. Powers the "Test connection" button in Settings.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const { provider, apiKey, model } = parsed.data

  try {
    const key = resolveApiKey(provider, apiKey)
    const usingServerKey = !apiKey?.trim()

    if (provider === 'openrouter') {
      const detail = await testOpenRouter(key, model)
      return NextResponse.json({ ok: true, detail, usingServerKey })
    }

    if (provider === 'cerebras') {
      const res = await fetch('https://api.cerebras.ai/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      })
      if (!res.ok) throw new Error(`Cerebras rejected the key (${res.status}).`)
      const data = await res.json()
      const count = (data.data ?? []).length
      return NextResponse.json({ ok: true, detail: `${count} model${count === 1 ? '' : 's'} available.`, usingServerKey })
    }

    // Gemini
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`
    )
    if (!res.ok) throw new Error(`Gemini rejected the key (${res.status}).`)
    return NextResponse.json({ ok: true, detail: 'Key accepted by Google AI.', usingServerKey })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[ai/test]', message)
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}

/**
 * Checks the key against OpenRouter's /key endpoint (free, no tokens spent) and
 * confirms the chosen model id actually exists in the catalogue.
 */
async function testOpenRouter(key: string, model?: string): Promise<string> {
  const keyRes = await fetch(`${OPENROUTER_BASE_URL}/key`, {
    headers: { Authorization: `Bearer ${key}` },
  })
  if (!keyRes.ok) {
    throw new Error(openRouterErrorMessage(keyRes.status, await keyRes.text(), resolveOpenRouterModel(model)))
  }

  const keyData = await keyRes.json()
  const info = keyData?.data ?? {}
  const parts: string[] = []
  if (info.label) parts.push(`Key "${info.label}"`)
  else parts.push('Key valid')

  if (typeof info.usage === 'number') {
    const limit = info.limit
    parts.push(
      limit == null
        ? `· $${info.usage.toFixed(3)} used (no spend limit)`
        : `· $${info.usage.toFixed(3)} of $${Number(limit).toFixed(2)} used`
    )
  }
  if (info.is_free_tier) parts.push('· free tier')

  const targetModel = resolveOpenRouterModel(model)
  const modelsRes = await fetch(`${OPENROUTER_BASE_URL}/models`, { next: { revalidate: 3600 } })
  if (modelsRes.ok) {
    const catalogue = await modelsRes.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exists = (catalogue.data ?? []).some((m: any) => m.id === targetModel)
    if (!exists) throw new Error(`Key is valid, but model "${targetModel}" is not in the OpenRouter catalogue.`)
    parts.push(`· model "${targetModel}" available`)
  }

  return parts.join(' ')
}
