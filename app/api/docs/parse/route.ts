import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDocument } from '@/lib/googleDocs'
import { parseDocument } from '@/lib/parser'
import { requireGoogleAuth } from '@/lib/require-auth'

const schema = z.object({ documentId: z.string().min(1) })

export async function POST(req: NextRequest) {
  const auth = await requireGoogleAuth()
  if (!auth.ok) return auth.response

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: 'Missing documentId' }, { status: 400 })

  try {
    const doc = await getDocument(auth.accessToken, parsed.data.documentId)
    const resume = parseDocument(doc)

    if (resume.sections.length === 0) {
      return NextResponse.json(
        { error: 'No content found in that document. Make sure it is a text resume, not an image or PDF.' },
        { status: 400 }
      )
    }

    return NextResponse.json({ resume })
  } catch (err: unknown) {
    console.error('[parse]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
