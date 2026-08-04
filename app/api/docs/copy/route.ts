import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { extractDocumentId, getDocument, copyDocument } from '@/lib/googleDocs'
import { requireGoogleAuth } from '@/lib/require-auth'

const schema = z.object({ url: z.string().url() })

export async function POST(req: NextRequest) {
  const auth = await requireGoogleAuth()
  if (!auth.ok) return auth.response

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })

  const docId = extractDocumentId(parsed.data.url)
  if (!docId)
    return NextResponse.json(
      { error: 'Could not extract document ID. Make sure it is a valid Google Docs link.' },
      { status: 400 }
    )

  try {
    const original = await getDocument(auth.accessToken, docId)
    const copy = await copyDocument(auth.accessToken, docId, original.title ?? 'Resume')
    return NextResponse.json({
      originalId: docId,
      copiedId: copy.id,
      copiedDocUrl: copy.url,
      title: original.title,
    })
  } catch (err: unknown) {
    console.error('[copy]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}