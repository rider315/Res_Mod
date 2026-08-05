import { NextRequest, NextResponse } from 'next/server'
import { exportDocAsPdf } from '@/lib/googleDocs'
import { requireGoogleAuth, sanitizeFileName, buildResumeFileName } from '@/lib/require-auth'
import { getProfile } from '@/lib/profiles'

export async function GET(req: NextRequest) {
  const auth = await requireGoogleAuth()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const documentId = searchParams.get('documentId')
  if (!documentId)
    return NextResponse.json({ error: 'Missing documentId' }, { status: 400 })

  // The client may pass a name, but it is untrusted input that lands in a
  // Content-Disposition header — sanitize it. The fallback is named after the
  // resume's owner (from the profile), not whoever is signed in.
  const requested = sanitizeFileName(searchParams.get('filename') ?? '')
  const profile = getProfile(searchParams.get('profileId') ?? undefined)
  const filename = requested || buildResumeFileName(profile.personName, 'Company')

  try {
    const pdfBuffer = await exportDocAsPdf(auth.accessToken, documentId)
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}.pdf"`,
      },
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
