import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOwner } from '@/lib/require-auth'
import { AIProvider } from '@/types/resume'
import { getProvider, PROVIDER_ORDER } from '@/lib/providers'
import { resolveApiKey, resolveModel } from '@/lib/ai-provider'
import { checkConnection } from '@/lib/ai-connection'

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
  // AI settings belong to the owner: everyone else runs on the AI the owner chose.
  const auth = await requireOwner()
  if (!auth.ok) return auth.response

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
    const key = resolveApiKey(config.id, apiKey, { allowServerKey: true })
    const usingServerKey = config.needsKey && !apiKey?.trim()
    const detail = await checkConnection(config.id, key, resolveModel(config.id, model))
    return NextResponse.json({ ok: true, detail, usingServerKey })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[ai/test]', config.id, message)
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
