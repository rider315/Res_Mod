import { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import { roleForEmail } from '@/lib/access'

/**
 * Google sign-in, used only to identify who is signed in.
 *
 * The app requests the minimum scopes that allows (openid, email, profile) and
 * never calls a Google API. Identity decides access: the owner's email unlocks
 * the resume profiles and server keys (lib/access.ts), so an unverified address
 * is refused outright rather than trusted.
 */
export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: ['openid', 'email', 'profile'].join(' '),
        },
      },
    }),
  ],
  pages: {
    signIn: '/',
  },
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== 'google') return false
      return (profile as { email_verified?: boolean } | undefined)?.email_verified === true
    },
    // The role is worked out on every read instead of being frozen into the JWT,
    // so a change to OWNER_EMAILS applies without anyone signing out.
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? ''
        session.user.role = roleForEmail(session.user.email)
      }
      return session
    },
  },
}
