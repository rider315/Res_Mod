import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { applyChangesToDocument, renameDocument } from '@/lib/googleDocs'

const schema = z.object({
  documentId: z.string().min(1),
  changes: z.array(
    z.object({
      id: z.string(),
      sectionTitle: z.string().optional(),
      original: z.string(),
      proposed: z.string(),
      approved: z.boolean().nullable(),
    })
  ),
  companyName: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken)
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const { documentId, changes, companyName } = parsed.data
  const approved = changes
    .filter((c) => c.approved === true)
    .map((c) => ({ original: c.original, proposed: c.proposed, sectionTitle: c.sectionTitle }))

  if (approved.length === 0)
    return NextResponse.json({ error: 'No approved changes to apply' }, { status: 400 })

  try {
    await applyChangesToDocument(session.accessToken, documentId, approved)
    
    // Rename document if companyName is provided
    if (companyName && companyName !== 'Company') {
      const newName = `Gaurav Chaudhary Resume_${companyName}`
      await renameDocument(session.accessToken, documentId, newName)
    }

    return NextResponse.json({
      success: true,
      appliedCount: approved.length,
      docUrl: `https://docs.google.com/document/d/${documentId}/edit`,
    })
  } catch (err: unknown) {
    console.error('[apply]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}