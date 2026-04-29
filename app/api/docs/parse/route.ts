import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { getDocument } from '@/lib/googleDocs'
import { parseDocument } from '@/lib/parser'

const schema = z.object({ documentId: z.string().min(1) })

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken)
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: 'Missing documentId' }, { status: 400 })

  try {
    const doc = await getDocument(session.accessToken, parsed.data.documentId)
    const resume = parseDocument(doc)
    return NextResponse.json({ resume })
  } catch (err: unknown) {
    console.error('[parse]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}