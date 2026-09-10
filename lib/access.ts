/**
 * Who is signed in, and what they may do.
 *
 * There are two roles. The owner runs the original single-person workflow: the
 * resume profiles, their .tex files, and the server-side provider keys that are
 * billed to the platform. Everyone else is a regular user and can reach none of
 * those.
 *
 * Owners are listed in OWNER_EMAILS (comma-separated). When it is unset or
 * blank, the account the platform was built for is the only owner. The email
 * comes from the signed session, and Google sign-in is refused unless the
 * address is verified (lib/auth.ts), so nobody can claim an owner's address.
 *
 * Kept free of next-auth imports so it runs in the browser-free test harness.
 */

export type Role = 'owner' | 'user'

const DEFAULT_OWNER_EMAILS = ['gaurav.chaudhary.865022@gmail.com']

/** The owner list from an OWNER_EMAILS value, falling back to the default owner. */
export function parseOwnerEmails(raw: string | undefined): string[] {
  const listed = (raw ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
  return listed.length > 0 ? listed : DEFAULT_OWNER_EMAILS
}

export function roleForEmail(
  email: string | null | undefined,
  owners: string[] = parseOwnerEmails(process.env.OWNER_EMAILS)
): Role {
  if (!email) return 'user'
  return owners.includes(email.trim().toLowerCase()) ? 'owner' : 'user'
}

export interface Access {
  role: Role
  /** Google's stable account id (`sub`). */
  userId: string
  email: string
}

interface SessionLike {
  user?: { id?: string | null; email?: string | null } | null
}

/** Null when there is no signed-in account with an email to decide the role by. */
export function getAccess(session: SessionLike | null | undefined): Access | null {
  const email = session?.user?.email?.trim().toLowerCase()
  if (!email) return null
  return { role: roleForEmail(email), userId: session?.user?.id ?? '', email }
}
