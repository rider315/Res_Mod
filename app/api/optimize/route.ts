import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOwner } from '@/lib/require-auth'
import { AIProvider } from '@/types/resume'
import { generateAIResponse, resolveApiKey, resolveModel } from '@/lib/ai-provider'
import { runOptimization } from '@/lib/run-optimization'
import { PROVIDER_ORDER } from '@/lib/providers'
import { DEFAULT_PROFILE_ID, getProfile, PROFILE_ORDER, ResumeProfileId } from '@/lib/profiles'

// An optimize run makes up to three sequential model calls, and a thinking model
// can spend over a minute on each. Pin the limit to the Hobby maximum under Fluid
// compute (300s, also its default) so a lowered project default can't cut a run
// short — Vercel kills an over-time function and returns an HTML error page.
export const maxDuration = 300

const schema = z.object({
  resume: z.object({
    documentId: z.string(),
    title: z.string(),
    sections: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        content: z.array(z.string()),
      })
    ),
  }),
  jobDescription: z.string().min(10),
  hardInstructions: z.string(),
  softInstructions: z.string(),
  provider: z.enum(PROVIDER_ORDER as [AIProvider, ...AIProvider[]]).optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  profileId: z.enum(PROFILE_ORDER as [ResumeProfileId, ...ResumeProfileId[]]).optional(),
})

export async function POST(req: NextRequest) {
  // Tailoring still runs on the owner's resume profiles, so it is owner-only
  // until regular users have resumes of their own to tailor.
  const auth = await requireOwner()
  if (!auth.ok) return auth.response

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })

  const { resume, jobDescription, hardInstructions, softInstructions, apiKey, model } = parsed.data
  const provider = (parsed.data.provider ?? 'openrouter') as AIProvider

  try {
    const key = resolveApiKey(provider, apiKey, { allowServerKey: auth.role === 'owner' })

    const result = await runOptimization({
      mode: 'optimize',
      profile: getProfile(parsed.data.profileId ?? DEFAULT_PROFILE_ID),
      resume,
      jobDescription,
      hardInstructions,
      softInstructions,
      provider,
      model: resolveModel(provider, model),
      generate: ({ systemInstruction, prompt, temperature }) =>
        generateAIResponse({ provider, apiKey: key, systemInstruction, prompt, temperature, model }),
    })

    return NextResponse.json({ result })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[optimize]', message)

    // Surface rate-limit errors with a 429 so the client can show a retry message
    if (message.includes('429') || message.includes('rate limit') || message.includes('too_many_tokens')) {
      return NextResponse.json({ error: message }, { status: 429 })
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
