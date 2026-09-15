import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AIProvider } from '@/types/resume'
import { requireOwner } from '@/lib/require-auth'
import { getProvider, PROVIDER_ORDER } from '@/lib/providers'
import { resolveModel } from '@/lib/ai-provider'
import { checkConnection } from '@/lib/ai-connection'
import { decryptSecret } from '@/lib/secrets'
import { resolveStoredPlatformAi } from '@/lib/billing/config'
import {
  clearPlatformAi,
  getPlatformAiStatus,
  PlatformAiSettingError,
  savePlatformAi,
  storedSettingFor,
} from '@/lib/billing/platform-ai'

export const dynamic = 'force-dynamic'

const schema = z.object({
  provider: z.enum(PROVIDER_ORDER as [AIProvider, ...AIProvider[]]),
  model: z.string().trim().max(200).default(''),
  apiKey: z.string().trim().max(500).default(''),
})

const failed = (route: string, err: unknown) => {
  console.error(`[admin/platform-ai] ${route}:`, err instanceof Error ? err.message : err)
  return NextResponse.json({ error: 'ResMod AI could not be updated right now. Try again in a moment.' }, { status: 500 })
}

/** ResMod AI as it is set now. Owner only, and the key itself is never sent. */
export async function GET() {
  const auth = await requireOwner()
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json(await getPlatformAiStatus())
  } catch (err) {
    return failed('read', err)
  }
}

/**
 * Make a provider, model and key from AI settings the ResMod AI that regular
 * accounts run on. The connection is checked first, without spending tokens, so
 * a mistyped key can't switch paid runs on.
 */
export async function PUT(req: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.response

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { provider, model, apiKey } = parsed.data
  const config = getProvider(provider)

  if (config.clientSide) {
    return NextResponse.json(
      { error: `${config.label} runs in each person's browser, so it can't power ResMod AI. Pick another provider.` },
      { status: 400 }
    )
  }
  if (provider === 'ollama' && process.env.VERCEL_ENV) {
    return NextResponse.json({ error: "Ollama runs on your own computer, which the hosted app can't reach." }, { status: 400 })
  }

  let stored
  try {
    stored = storedSettingFor(provider, model, apiKey)
    const resolved = resolveStoredPlatformAi(stored, process.env, decryptSecret)
    if (!resolved) return NextResponse.json({ error: `There is no usable ${config.label} key.` }, { status: 400 })
    await checkConnection(provider, resolved.apiKey, resolveModel(provider, model))
  } catch (err) {
    // The provider's own words about the key or model, or why the choice can't be saved.
    const message = err instanceof Error ? err.message : String(err)
    if (!(err instanceof PlatformAiSettingError)) console.warn('[admin/platform-ai] connection check failed:', message)
    return NextResponse.json({ error: message }, { status: 400 })
  }

  try {
    await savePlatformAi(stored, auth.userId)
    return NextResponse.json(await getPlatformAiStatus())
  } catch (err) {
    return failed('save', err)
  }
}

/** Switch ResMod AI off. Buying runs switches off with it. */
export async function DELETE() {
  const auth = await requireOwner()
  if (!auth.ok) return auth.response
  try {
    await clearPlatformAi()
    return NextResponse.json(await getPlatformAiStatus())
  } catch (err) {
    return failed('clear', err)
  }
}
