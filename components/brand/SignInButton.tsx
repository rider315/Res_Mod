'use client'
import { useRouter } from 'next/navigation'
import { signIn, useSession } from 'next-auth/react'
import { ArrowRight } from '@/components/brand/Icons'

/**
 * Sign-in buttons. ResMod signs in with Google only, so every "start" button on
 * the public pages goes to Google and then on to the dashboard, or straight to
 * the dashboard for someone already signed in.
 */

function useStart(to: string) {
  const { status } = useSession()
  const router = useRouter()
  return () => (status === 'authenticated' ? router.push(to) : signIn('google', { callbackUrl: to }))
}

function GoogleG() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

/** The main call to action: blue, big, with an arrow. `to` is where it lands after sign-in. */
export function StartButton({
  label = 'Tailor my resume',
  to = '/dashboard',
  className = '',
}: {
  label?: string
  to?: string
  className?: string
}) {
  const start = useStart(to)
  return (
    <button onClick={start} className={`nb-btn nb-btn-primary px-7 py-4 text-lg ${className}`}>
      {label} <ArrowRight size={20} />
    </button>
  )
}

/** "Continue with Google", for the sign-in card. */
export function GoogleButton({ className = '' }: { className?: string }) {
  const start = useStart('/dashboard')
  return (
    <button onClick={start} className={`nb-btn nb-btn-accent w-full px-6 py-3.5 text-lg ${className}`}>
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white border-[1.6px] border-[#0a0a0a]">
        <GoogleG />
      </span>
      Continue with Google
    </button>
  )
}

/** The header's quieter "Log in". */
export function LoginButton() {
  const start = useStart('/dashboard')
  return (
    <button onClick={start} className="nb-btn nb-btn-sm px-5 py-2 text-sm">
      Log in
    </button>
  )
}

/** Notes about signing in, hidden once the visitor is known to be signed in. */
export function SignedOutOnly({ children }: { children: React.ReactNode }) {
  const { status } = useSession()
  return status === 'authenticated' ? null : <>{children}</>
}
