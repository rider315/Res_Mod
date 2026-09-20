import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getAccess, Role, roleForEmail } from '@/lib/access'
import { userForToken } from '@/lib/db/extension'

/** How the caller proved who they are. */
export type AuthVia = 'session' | 'extension'

interface AuthSuccess {
  ok: true
  role: Role
  /** Google's stable account id. */
  userId: string
  email: string
  /** Signed-in user's display name. Not used for file naming — see below. */
  userName: string
  via: AuthVia
}

interface AuthFailure {
  ok: false
  response: NextResponse
}

export interface AuthOptions {
  /**
   * Let a browser-extension token stand in for a session on this route.
   *
   * Off by default, and deliberately so. A session cookie rides along with a
   * browser the user is sitting at; an extension token is a bare string on
   * disk that answers for the account until it is revoked. Routes that move
   * money, change a plan, delete an account or reach the owner's controls are
   * never worth that trade, so they simply never pass this — and a test holds
   * them to it.
   */
  allowExtension?: boolean
}

/** `Bearer <token>` from the request, or null. */
function bearerToken(): string | null {
  const header = headers().get('authorization') ?? ''
  const [scheme, value] = header.split(' ')
  if (!value || scheme.toLowerCase() !== 'bearer') return null
  return value.trim() || null
}

/**
 * Shared guard for the API routes: someone must be signed in with an email.
 *
 * The role is re-derived from the email here rather than read from the session
 * object, so a route never acts on a stale or tampered role. That holds for an
 * extension token too: the token says which account, never what it may do.
 *
 * Note the exported file name comes from the resume *profile*, never from
 * `userName` — otherwise Himanshu's resume downloads under whoever is logged in.
 */
export async function requireAuth(options: AuthOptions = {}): Promise<AuthSuccess | AuthFailure> {
  const session = await getServerSession(authOptions)
  const access = getAccess(session)

  if (session?.user && access) {
    return { ok: true, ...access, userName: session.user.name ?? '', via: 'session' }
  }

  if (options.allowExtension) {
    const token = bearerToken()
    const holder = token ? await userForToken(token) : null
    if (holder) {
      return {
        ok: true,
        role: roleForEmail(holder.email),
        userId: holder.userId,
        email: holder.email,
        userName: '',
        via: 'extension',
      }
    }
  }

  return {
    ok: false,
    response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
  }
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
        { error: 'This part of Chills is only available to the account owner.' },
        { status: 403 }
      ),
    }
  }
  return auth
}

// The filename helpers live in their own module so the browser and the pure
// tests can use them without pulling in next-auth.
export { sanitizeFileName, buildResumeFileName } from '@/lib/resume-filename'
