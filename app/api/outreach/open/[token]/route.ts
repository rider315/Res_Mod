import { NextRequest, NextResponse } from 'next/server'
import { recordOpen } from '@/lib/db/outreach'

export const dynamic = 'force-dynamic'

/** A 1×1 transparent GIF. */
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

type Params = { params: { token: string } }

/**
 * The image inside a sent recruiter email. Loading it marks the email opened.
 * It is public, as a recipient's mail app has no Chills session; the random
 * token is the only thing that identifies the email, and it reveals nothing.
 * The image is always returned, whatever happens, so an email never shows a
 * broken picture.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await recordOpen(params.token)
  } catch (err) {
    console.error('[outreach/open]', err instanceof Error ? err.message : err)
  }
  return new NextResponse(new Uint8Array(PIXEL), {
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(PIXEL.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'X-Robots-Tag': 'noindex',
    },
  })
}
