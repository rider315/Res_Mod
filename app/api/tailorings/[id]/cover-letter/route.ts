import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/require-auth'
import { AIProvider } from '@/types/resume'
import { getProvider, PROVIDER_ORDER } from '@/lib/providers'
import { generateAIResponse } from '@/lib/ai-provider'
import { aiFailureMessage, chooseAi } from '@/lib/billing/ai-access'
import { getTailoring } from '@/lib/db/tailorings'
import { getResume } from '@/lib/db/resumes'
import { latestCoverLetter, saveCoverLetter } from '@/lib/db/cover-letters'
import { ResumeDocSchema } from '@/lib/resume-doc'
import {
  COVER_LETTER_LENGTHS,
  COVER_LETTER_TONES,
  MAX_COVER_LETTERS_PER_TAILORING,
  resumeTextFromLatex,
  writeCoverLetter,
} from '@/lib/cover-letter'

export const maxDuration = 120

type Params = { params: { id: string } }

const schema = z.object({
  tone: z.enum(COVER_LETTER_TONES).default('professional'),
  length: z.enum(COVER_LETTER_LENGTHS).default('standard'),
  recipient: z.string().trim().max(120).default(''),
  notes: z.string().trim().max(600).default(''),
  /** The owner's own AI settings. Everyone else always runs on ResMod AI, and these are ignored. */
  provider: z.enum(PROVIDER_ORDER as [AIProvider, ...AIProvider[]]).optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
})

const shape = (letter: { id: string; tone: string; body: string; updatedAt: Date } | null) =>
  letter ? { id: letter.id, tone: letter.tone, body: letter.body, updatedAt: letter.updatedAt.toISOString() } : null

/** The newest cover letter for a tailored copy, and how many more can be written. */
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const { letter, written } = await latestCoverLetter(auth.userId, params.id)
  return NextResponse.json({ letter: shape(letter), written, max: MAX_COVER_LETTERS_PER_TAILORING })
}

/**
 * Write a cover letter for a tailored copy, from the tailored resume itself and
 * the job it was tailored to. Up to three per copy; it uses no tailoring, only
 * one request of the day's allowance.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }
  const { tone, length, recipient, notes, provider } = parsed.data
  if (auth.role === 'owner' && provider && getProvider(provider).clientSide) {
    return NextResponse.json(
      { error: 'Puter runs in the browser, so it can’t write cover letters here. Pick another provider in AI settings.' },
      { status: 400 }
    )
  }

  const tailoring = await getTailoring(auth.userId, params.id)
  if (!tailoring) return NextResponse.json({ error: 'Tailored resume not found' }, { status: 404 })

  const { written } = await latestCoverLetter(auth.userId, params.id)
  if (written >= MAX_COVER_LETTERS_PER_TAILORING) {
    return NextResponse.json(
      {
        error: `You've written ${MAX_COVER_LETTERS_PER_TAILORING} cover letters for this tailored resume. Edit the latest one instead.`,
        code: 'cover_letter_limit',
      },
      { status: 429 }
    )
  }

  // The name on the letter comes from the resume it was tailored from, when that still exists.
  let candidateName = tailoring.resumeTitle
  if (tailoring.resumeId) {
    const row = await getResume(auth.userId, tailoring.resumeId).catch(() => null)
    const doc = row ? ResumeDocSchema.safeParse(row.doc) : null
    if (doc?.success) candidateName = doc.data.name
  }

  const ai = await chooseAi(auth, parsed.data, 'free')
  if (!ai.ok) return ai.response

  try {
    const body = await writeCoverLetter({
      input: {
        resumeText: resumeTextFromLatex(tailoring.latex),
        jobDescription: tailoring.jobDescription,
        jobTitle: tailoring.jobTitle,
        company: tailoring.company,
        candidateName,
        tone,
        length,
        recipient,
        notes,
      },
      generate: ({ systemInstruction, prompt, temperature }) =>
        generateAIResponse({ provider: ai.provider, apiKey: ai.apiKey, systemInstruction, prompt, temperature, model: ai.model }),
    })
    const letter = await saveCoverLetter(auth.userId, { tailoringId: tailoring.id, tone, body })
    return NextResponse.json({ letter: shape(letter), written: written + 1, max: MAX_COVER_LETTERS_PER_TAILORING })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cover-letter]', message)
    return NextResponse.json(
      { error: aiFailureMessage(auth.role, message) },
      { status: /429|rate limit/i.test(message) ? 429 : 400 }
    )
  }
}
