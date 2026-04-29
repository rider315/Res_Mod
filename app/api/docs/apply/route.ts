import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { applyChangesToDocument } from '@/lib/googleDocs'

const schema = z.object({
  documentId: z.string().min(1),
  changes: z.array(
    z.object({
      id: z.string(),
      original: z.string(),
      proposed: z.string(),
      approved: z.boolean().nullable(),
    })
  ),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken)
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const { documentId, changes } = parsed.data
  const approved = changes
    .filter((c) => c.approved === true)
    .map((c) => ({ original: c.original, proposed: c.proposed }))

  if (approved.length === 0)
    return NextResponse.json({ error: 'No approved changes to apply' }, { status: 400 })

  try {
    await applyChangesToDocument(session.accessToken, documentId, approved)
    return NextResponse.json({
      success: true,
      appliedCount: approved.length,
      docUrl: `https://docs.google.com/document/d/${documentId}/edit`,
    })
  } catch (err: any) {
    console.error('[apply]', err?.message)
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}