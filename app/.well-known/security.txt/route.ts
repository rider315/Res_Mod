import { NextResponse } from 'next/server'

/**
 * Where to report a security problem with Chills, in the standard place
 * (RFC 9116). Served once CONTACT_EMAIL is set, like the contact page; until
 * then there is no address to publish.
 */

export const dynamic = 'force-dynamic'

export function GET() {
  const email = process.env.CONTACT_EMAIL?.trim()
  if (!email) return new NextResponse('Not found', { status: 404 })
  // The standard asks for an expiry under a year away, so a stale file is noticed.
  const expires = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString()
  const body = [`Contact: mailto:${email}`, `Expires: ${expires}`, 'Preferred-Languages: en, hi', ''].join('\n')
  return new NextResponse(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
