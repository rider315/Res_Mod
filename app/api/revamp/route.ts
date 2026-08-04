import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { AIProvider } from '@/types/resume'
import { revampResume } from '@/lib/revamper'

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
  provider: z.enum(['openrouter', 'gemini', 'cerebras']).optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session)
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })

  try {
    const result = await revampResume(
      parsed.data.resume,
      parsed.data.jobDescription,
      parsed.data.hardInstructions,
      parsed.data.softInstructions,
      parsed.data.provider as AIProvider,
      parsed.data.apiKey,
      parsed.data.model
    )
    return NextResponse.json({ result })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[revamp]', message)

    // Surface rate-limit errors with a 429 so the client can show a retry message
    if (message.includes('429') || message.includes('rate limit') || message.includes('too_many_tokens')) {
      return NextResponse.json({ error: message }, { status: 429 })
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
