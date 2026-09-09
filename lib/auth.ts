import { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'

/**
 * Sign-in only.
 *
 * This app used to read and copy the user's Google Docs, which meant asking for
 * the Drive and Documents scopes and keeping a refreshable access token around.
 * The resume is now a .tex file in this repository, so none of that is needed:
 * Google is here purely to identify who is signed in, and the app requests the
 * minimum scopes that allows.
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
}
