import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { OPENROUTER_BASE_URL } from '@/lib/openrouter-models'

export interface CatalogModel {
  id: string
  name: string
  contextLength: number
  free: boolean
  /** USD per 1M prompt tokens, already scaled for display. */
  promptPricePerM: number
}

/**
 * Proxy for OpenRouter's public model catalogue so the settings modal can offer
 * an always-current model list instead of a hard-coded one.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/models`, {
      // The catalogue changes rarely — cache it for an hour.
      next: { revalidate: 3600 },
    })
    if (!res.ok) {
      const body = await res.text()
      console.error('[ai/models] OpenRouter returned', res.status, body.slice(0, 300))
      return NextResponse.json(
        { error: `Could not load the OpenRouter model list (${res.status}).` },
        { status: 502 }
      )
    }

    const data = await res.json()
    const models: CatalogModel[] = (data.data ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((m: any) => {
        const promptPrice = parseFloat(m.pricing?.prompt ?? '0') || 0
        const completionPrice = parseFloat(m.pricing?.completion ?? '0') || 0
        return {
          id: m.id as string,
          name: (m.name as string) ?? m.id,
          contextLength: Number(m.context_length) || 0,
          free: (promptPrice === 0 && completionPrice === 0) || String(m.id).endsWith(':free'),
          promptPricePerM: promptPrice * 1_000_000,
        }
      })
      .filter((m: CatalogModel) => Boolean(m.id))
      .sort((a: CatalogModel, b: CatalogModel) => a.name.localeCompare(b.name))

    return NextResponse.json({ models })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[ai/models]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
