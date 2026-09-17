import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/require-auth'
import { AIProvider } from '@/types/resume'
import { getProvider, PROVIDER_ORDER } from '@/lib/providers'
import { generateAIResponse } from '@/lib/ai-provider'
import { extractJdKeywords } from '@/lib/tailor/keywords'
import { scoreKeywords } from '@/lib/tailor/keyword-finder'
import { aiFailureMessage, chooseAi } from '@/lib/billing/ai-access'

export const maxDuration = 120

const schema = z.object({
  jobDescription: z
    .string()
    .trim()
    .min(80, 'Paste the whole job description.')
    .max(20_000, 'That job description is longer than 20,000 characters.'),
  /** The owner's own AI settings. Everyone else always runs on Chills AI, and these are ignored. */
  provider: z.enum(PROVIDER_ORDER as [AIProvider, ...AIProvider[]]).optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
})

/**
 * The keyword finder: the keywords a job description screens for, scored. It
 * costs no tailoring, only one request of the daily allowance, and the job
 * description is not stored.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }
  const { jobDescription, provider } = parsed.data
  if (auth.role === 'owner' && provider && getProvider(provider).clientSide) {
    return NextResponse.json({ error: 'Puter runs in the browser, not through this route.' }, { status: 400 })
  }

  const ai = await chooseAi(auth, parsed.data, 'free')
  if (!ai.ok) return ai.response

  try {
    const found = await extractJdKeywords({
      jobDescription,
      generate: ({ systemInstruction, prompt, temperature }) =>
        generateAIResponse({ provider: ai.provider, apiKey: ai.apiKey, systemInstruction, prompt, temperature, model: ai.model }),
    })
    return NextResponse.json({
      jobTitle: found.jobTitle,
      company: found.company,
      keywords: scoreKeywords(jobDescription, found.keywords),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[keywords]', message)
    return NextResponse.json(
      { error: aiFailureMessage(auth.role, message) },
      { status: /429|rate limit/i.test(message) ? 429 : 400 }
    )
  }
}
