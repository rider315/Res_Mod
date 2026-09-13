import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/require-auth'
import { AIProvider } from '@/types/resume'
import { getProvider, PROVIDER_ORDER } from '@/lib/providers'
import { generateAIResponse, resolveApiKey } from '@/lib/ai-provider'
import { structureResume } from '@/lib/import/structure'
import { MAX_RESUME_TEXT } from '@/lib/resume-doc'

// A long resume plus a possible retry can take a while on a slower model.
export const maxDuration = 300

const schema = z.object({
  text: z.string().trim().min(40, 'That is too little text to be a resume.').max(MAX_RESUME_TEXT),
  provider: z.enum(PROVIDER_ORDER as [AIProvider, ...AIProvider[]]),
  apiKey: z.string().optional(),
  model: z.string().optional(),
})

/**
 * Turn a resume's text into a structured resume with the user's chosen model.
 * Regular users bring their own key; only the owner falls back to server keys.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }

  const { text, provider, apiKey, model } = parsed.data
  if (getProvider(provider).clientSide) {
    return NextResponse.json({ error: 'Puter runs in the browser, not through this route.' }, { status: 400 })
  }

  try {
    const key = resolveApiKey(provider, apiKey, { allowServerKey: auth.role === 'owner' })
    const doc = await structureResume({
      text,
      generate: ({ systemInstruction, prompt, temperature }) =>
        generateAIResponse({ provider, apiKey: key, systemInstruction, prompt, temperature, model }),
    })
    return NextResponse.json({ doc })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[import/structure]', message)
    return NextResponse.json({ error: message }, { status: /429|rate limit/i.test(message) ? 429 : 400 })
  }
}
