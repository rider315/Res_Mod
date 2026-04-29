import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { extractDocumentId, getDocument, copyDocument } from '@/lib/googleDocs'

const schema = z.object({ url: z.string().url() })

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken)
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

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
    const original = await getDocument(session.accessToken, docId)
    const copy = await copyDocument(session.accessToken, docId, original.title ?? 'Resume')
    return NextResponse.json({
      originalId: docId,
      copiedId: copy.id,
      copiedDocUrl: copy.url,
      title: original.title,
    })
  } catch (err: any) {
    console.error('[copy]', err?.message)
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}