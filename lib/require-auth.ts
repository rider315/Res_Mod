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

// The filename helpers live in their own module so the browser and the pure
// tests can use them without pulling in next-auth.
export { sanitizeFileName, buildResumeFileName } from '@/lib/resume-filename'
