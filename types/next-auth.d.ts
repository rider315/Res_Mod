import { DefaultSession } from 'next-auth'
import type { Role } from '@/lib/access'

// Google is used for sign-in only — the app holds no access token, because it
// no longer calls any Google API. `role` is derived from the email on each read
// (lib/auth.ts); server routes re-derive it with getAccess rather than trusting it.
declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: Role
    } & DefaultSession['user']
  }
}
