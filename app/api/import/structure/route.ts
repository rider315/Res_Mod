import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/require-auth'
import { AIProvider } from '@/types/resume'
import { getProvider, PROVIDER_ORDER } from '@/lib/providers'
import { generateAIResponse } from '@/lib/ai-provider'
import { structureResume } from '@/lib/import/structure'
import { MAX_RESUME_TEXT } from '@/lib/resume-doc'
import { chooseAi, settleAiFailure } from '@/lib/billing/ai-access'
import { checkRateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/security/rate-limit'

// A long resume plus a possible retry can take a while on a slower model.
export const maxDuration = 300

const schema = z.object({
  text: z.string().trim().min(40, 'That is too little text to be a resume.').max(MAX_RESUME_TEXT),
  /** The owner's own AI settings. Everyone else always runs on Chills AI, and these are ignored. */
  provider: z.enum(PROVIDER_ORDER as [AIProvider, ...AIProvider[]]).optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  /** The owner only: run on Chills AI instead. */
  usePlatform: z.boolean().optional(),
})

/**
 * Turn a resume's text into a structured resume. Regular accounts run on Chills
 * AI, counted against the month's import allowance; the owner uses their own AI
 * settings.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const limited = await checkRateLimit(RATE_LIMITS.aiLight, auth.userId)
  if (!limited.ok) return tooManyRequests(limited, 'Too many resumes were imported in a short time.')

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }

  const { text, provider, usePlatform } = parsed.data
  if (auth.role === 'owner' && !usePlatform && provider && getProvider(provider).clientSide) {
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
    const failure = await settleAiFailure('Resume import', auth.role, ai, err)
    return NextResponse.json({ error: failure.message }, { status: failure.status })
  }
}
