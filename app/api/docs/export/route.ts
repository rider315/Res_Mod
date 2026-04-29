import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { exportDocAsPdf } from '@/lib/googleDocs'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken)
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const documentId = searchParams.get('documentId')
  if (!documentId)
    return NextResponse.json({ error: 'Missing documentId' }, { status: 400 })

  try {
    const pdfBuffer = await exportDocAsPdf(session.accessToken, documentId)
    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="optimized-resume.pdf"',
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 })
  }
}