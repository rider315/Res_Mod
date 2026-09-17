import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/require-auth'
import { updateCoverLetter } from '@/lib/db/cover-letters'
import { MAX_COVER_LETTER_CHARS } from '@/lib/cover-letter'

type Params = { params: { id: string } }

const schema = z.object({
  body: z
    .string()
    .trim()
    .min(40, 'A cover letter needs a little more than that.')
    .max(MAX_COVER_LETTER_CHARS, `Keep the letter under ${MAX_COVER_LETTER_CHARS.toLocaleString('en-IN')} characters.`),
})

/** Save the candidate's edits to a cover letter. */
export async function PUT(req: NextRequest, { params }: Params) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }
  const letter = await updateCoverLetter(auth.userId, params.id, parsed.data.body)
  if (!letter) return NextResponse.json({ error: 'Cover letter not found' }, { status: 404 })
  return NextResponse.json({
    letter: { id: letter.id, tone: letter.tone, body: letter.body, updatedAt: letter.updatedAt.toISOString() },
  })
}
