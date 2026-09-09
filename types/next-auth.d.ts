import { DefaultSession } from 'next-auth'

// Google is used for sign-in only — the app holds no access token, because it
// no longer calls any Google API.
declare module 'next-auth' {
  interface Session {
    user: {
      id: string
    } & DefaultSession['user']
  }
}
