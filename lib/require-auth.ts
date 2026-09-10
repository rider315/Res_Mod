import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getAccess, Role } from '@/lib/access'

interface AuthSuccess {
  ok: true
  role: Role
  /** Google's stable account id. */
  userId: string
  email: string
  /** Signed-in user's display name. Not used for file naming — see below. */
  userName: string
}

interface AuthFailure {
  ok: false
  response: NextResponse
}

/**
 * Shared guard for the API routes: someone must be signed in with an email.
 *
 * The role is re-derived from the session email here rather than read from the
 * session object, so a route never acts on a stale or tampered role.
 *
 * Note the exported file name comes from the resume *profile*, never from
 * `userName` — otherwise Himanshu's resume downloads under whoever is logged in.
 */
export async function requireAuth(): Promise<AuthSuccess | AuthFailure> {
  const session = await getServerSession(authOptions)
  const access = getAccess(session)

  if (!session?.user || !access) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    }
  }

  return { ok: true, ...access, userName: session.user.name ?? '' }
}

/**
 * Owner-only routes: the resume profiles, their .tex files, and the server-side
 * provider keys behind them.
 */
export async function requireOwner(): Promise<AuthSuccess | AuthFailure> {
  const auth = await requireAuth()
  if (!auth.ok) return auth

  if (auth.role !== 'owner') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'This part of ResMod is only available to the account owner.' },
        { status: 403 }
      ),
    }
  }
  return auth
}

// The filename helpers live in their own module so the browser and the pure
// tests can use them without pulling in next-auth.
export { sanitizeFileName, buildResumeFileName } from '@/lib/resume-filename'
