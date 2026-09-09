import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

interface AuthSuccess {
  ok: true
  /** Signed-in user's display name. Not used for file naming — see below. */
  userName: string
}

interface AuthFailure {
  ok: false
  response: NextResponse
}

/**
 * Shared guard for the resume routes.
 *
 * Only checks that someone is signed in. The routes no longer call any Google
 * API, so there is no access token to validate or refresh.
 *
 * Note the exported file name comes from the resume *profile*, never from
 * `userName` — otherwise Himanshu's resume downloads under whoever is logged in.
 */
export async function requireAuth(): Promise<AuthSuccess | AuthFailure> {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    }
  }

  return { ok: true, userName: session.user.name ?? '' }
}

// The filename helpers live in their own module so the browser and the pure
// tests can use them without pulling in next-auth.
export { sanitizeFileName, buildResumeFileName } from '@/lib/resume-filename'
