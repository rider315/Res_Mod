import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { optimizeResume } from '@/lib/optimizer'

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
    const result = await optimizeResume(
      parsed.data.resume,
      parsed.data.jobDescription,
      parsed.data.hardInstructions,
      parsed.data.softInstructions
    )
    return NextResponse.json({ result })
  } catch (err: any) {
    console.error('[optimize]', err?.message)
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}