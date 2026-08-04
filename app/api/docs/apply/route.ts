import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { applyChangesToDocument, renameDocument } from '@/lib/googleDocs'
import { requireGoogleAuth, buildResumeFileName } from '@/lib/require-auth'

const schema = z.object({
  documentId: z.string().min(1),
  changes: z.array(
    z.object({
      id: z.string(),
      sectionTitle: z.string().optional(),
      original: z.string(),
      proposed: z.string(),
      approved: z.boolean().nullable(),
      boldKeywords: z.array(z.string()).optional(),
    })
  ),
  companyName: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const auth = await requireGoogleAuth()
  if (!auth.ok) return auth.response

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const { documentId, changes, companyName } = parsed.data
  const approved = changes
    .filter((c) => c.approved === true)
    .map((c) => ({ original: c.original, proposed: c.proposed, sectionTitle: c.sectionTitle, boldKeywords: c.boldKeywords }))

  if (approved.length === 0)
    return NextResponse.json({ error: 'No approved changes to apply' }, { status: 400 })

  try {
    const result = await applyChangesToDocument(auth.accessToken, documentId, approved)

    // Rename document if companyName is provided
    if (companyName && companyName !== 'Company') {
      await renameDocument(auth.accessToken, documentId, buildResumeFileName(auth.userName, companyName))
    }

    return NextResponse.json({
      success: true,
      appliedCount: result.applied,
      requestedCount: result.requested,
      unmatched: result.unmatched,
      docUrl: `https://docs.google.com/document/d/${documentId}/edit`,
    })
  } catch (err: unknown) {
    console.error('[apply]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
