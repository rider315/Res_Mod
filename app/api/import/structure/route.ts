import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/require-auth'
import { AIProvider } from '@/types/resume'
import { getProvider, PROVIDER_ORDER } from '@/lib/providers'
import { generateAIResponse } from '@/lib/ai-provider'
import { structureResume } from '@/lib/import/structure'
import { MAX_RESUME_TEXT } from '@/lib/resume-doc'
import { chooseAi } from '@/lib/billing/ai-access'
import { releaseReservation } from '@/lib/billing/store'

// A long resume plus a possible retry can take a while on a slower model.
export const maxDuration = 300

const schema = z.object({
  text: z.string().trim().min(40, 'That is too little text to be a resume.').max(MAX_RESUME_TEXT),
  provider: z.enum(PROVIDER_ORDER as [AIProvider, ...AIProvider[]]).optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  /** Run on ResMod AI, counted against the month's import allowance, instead of the account's own key. */
  usePlatform: z.boolean().optional(),
})

/**
 * Turn a resume's text into a structured resume: on ResMod AI, or on the user's
 * own key. Only the owner falls back to the server's provider keys.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }

  const { text, provider, usePlatform } = parsed.data
  if (!usePlatform && provider && getProvider(provider).clientSide) {
    return NextResponse.json({ error: 'Puter runs in the browser, not through this route.' }, { status: 400 })
  }

  const ai = await chooseAi(auth, parsed.data, 'import')
  if (!ai.ok) return ai.response

  try {
    const doc = await structureResume({
      text,
      generate: ({ systemInstruction, prompt, temperature }) =>
        generateAIResponse({ provider: ai.provider, apiKey: ai.apiKey, systemInstruction, prompt, temperature, model: ai.model }),
    })
    return NextResponse.json({ doc })
  } catch (err) {
    if (ai.reservation) await releaseReservation(ai.reservation)
    const message = err instanceof Error ? err.message : String(err)
    console.error('[import/structure]', message)
    return NextResponse.json({ error: message }, { status: /429|rate limit/i.test(message) ? 429 : 400 })
  }
}
