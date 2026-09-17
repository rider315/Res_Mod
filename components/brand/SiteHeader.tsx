'use client'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import Logo from '@/components/brand/Logo'
import { LoginButton } from '@/components/brand/SignInButton'

/** The public pages' header: the logo, a few links, and Log in (or the way back to the dashboard). */

const LINKS: Array<[string, string]> = [
  ['/#how-it-works', 'How it works'],
  ['/#outreach', 'Recruiter emails'],
  ['/keyword-finder', 'Keyword finder'],
  ['/pricing', 'Pricing'],
]

export default function SiteHeader() {
  const { status } = useSession()

  return (
    <header className="sticky top-0 z-30 bg-[var(--color-surface)] border-b-[1.6px] border-[var(--color-ink)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-[68px] flex items-center justify-between gap-4">
        <Logo />
        <nav className="flex items-center gap-1 sm:gap-2">
          {LINKS.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="hidden md:inline-flex px-3 py-2 text-sm font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:underline underline-offset-4"
            >
              {label}
            </Link>
          ))}
          {status === 'authenticated' ? (
            <Link href="/dashboard" className="nb-btn nb-btn-sm nb-btn-accent px-5 py-2 text-sm">
              Dashboard
            </Link>
          ) : (
            <LoginButton />
          )}
        </nav>
      </div>
    </header>
  )
}
