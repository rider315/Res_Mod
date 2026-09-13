import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/require-auth'
import { AIProvider } from '@/types/resume'
import { getProvider, PROVIDER_ORDER } from '@/lib/providers'
import { generateAIResponse, resolveApiKey, resolveModel } from '@/lib/ai-provider'
import { GenerateFn, runOptimization } from '@/lib/run-optimization'
import { extractJdKeywords } from '@/lib/tailor/keywords'
import { TAILOR_LEVELS } from '@/lib/tailor/levels'
import { standardProfile } from '@/lib/profiles/standard'
import { getResume } from '@/lib/db/resumes'
import { ResumeDocSchema } from '@/lib/resume-doc'
import { renderCheckedResume } from '@/lib/import/render'

// Keyword extraction, the level's passes and the keyword pass are several model calls.
export const maxDuration = 300

const schema = z.object({
  jobDescription: z
    .string()
    .trim()
    .min(80, 'Paste the whole job description.')
    .max(20_000, 'That job description is longer than 20,000 characters.'),
  level: z.enum(TAILOR_LEVELS),
  /** What the candidate says must not change. */
  instructions: z.string().max(2_000).default(''),
  provider: z.enum(PROVIDER_ORDER as [AIProvider, ...AIProvider[]]),
  apiKey: z.string().optional(),
  model: z.string().optional(),
})

type Params = { params: { id: string } }

/**
 * Tailor one of the signed-in user's saved resumes to a job description.
 *
 * Returns the proposed changes with the job's keywords and the starting coverage,
 * plus the parsed resume, so the review screen can score the approved changes
 * live. Nothing is saved: applying happens separately, and only for the changes
 * the user approves.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  if (!auth.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }

  const { jobDescription, level, instructions, provider, apiKey, model } = parsed.data
  if (getProvider(provider).clientSide) {
    return NextResponse.json({ error: 'Puter runs in the browser, not through this route.' }, { status: 400 })
  }

  let row
  try {
    row = await getResume(auth.userId, params.id)
  } catch (err) {
    console.error('[resumes/:id/tailor] load failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'The resume could not be loaded right now.' }, { status: 500 })
  }
  const doc = row ? ResumeDocSchema.safeParse(row.doc) : null
  if (!doc?.success) return NextResponse.json({ error: 'Resume not found' }, { status: 404 })

  const rendered = renderCheckedResume(doc.data)
  if (!rendered.ok) return NextResponse.json({ error: rendered.problems.join(' ') }, { status: 422 })

  try {
    const key = resolveApiKey(provider, apiKey, { allowServerKey: auth.role === 'owner' })
    const generate: GenerateFn = ({ systemInstruction, prompt, temperature }) =>
      generateAIResponse({ provider, apiKey: key, systemInstruction, prompt, temperature, model })

    const keywords = await extractJdKeywords({ jobDescription, generate })
    const result = await runOptimization({
      mode: 'optimize',
      level,
      keywords,
      profile: standardProfile(level),
      resume: rendered.parsed.resume,
      jobDescription,
      hardInstructions: instructions,
      softInstructions: '',
      provider,
      model: resolveModel(provider, model),
      generate,
    })

    return NextResponse.json({ result, resume: rendered.parsed.resume })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[resumes/:id/tailor]', message)
    return NextResponse.json({ error: message }, { status: /429|rate limit/i.test(message) ? 429 : 400 })
  }
}
