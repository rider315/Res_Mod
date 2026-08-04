import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

interface AuthSuccess {
  ok: true
  accessToken: string
  /** Signed-in user's display name, used for the exported file name. */
  userName: string
}

interface AuthFailure {
  ok: false
  response: NextResponse
}

/**
 * Shared guard for the Google Docs routes.
 *
 * Beyond checking for a session, this surfaces RefreshAccessTokenError. Without
 * it an expired refresh token produced confusing 401s straight from the Google
 * API instead of telling the user to sign in again.
 */
export async function requireGoogleAuth(): Promise<AuthSuccess | AuthFailure> {
  const session = await getServerSession(authOptions)

  if (!session?.accessToken) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    }
  }

  if (session.error === 'RefreshAccessTokenError') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Your Google session expired. Please sign out and sign in again to reconnect Google Docs.' },
        { status: 401 }
      ),
    }
  }

  return {
    ok: true,
    accessToken: session.accessToken,
    userName: session.user?.name ?? '',
  }
}

/**
 * Drive names and download filenames choke on these. Control characters matter
 * most: this value ends up in a Content-Disposition header, where a stray CRLF
 * would let a caller inject headers.
 */
export function sanitizeFileName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .trim()
      .slice(0, 150)
  )
}

/** "<User> Resume_<Company>", falling back gracefully when the name is unavailable. */
export function buildResumeFileName(userName: string, companyName: string): string {
  const who = sanitizeFileName(userName)
  const company = sanitizeFileName(companyName) || 'Company'
  return who ? `${who} Resume_${company}` : `Resume_${company}`
}
