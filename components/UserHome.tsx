'use client'
import { signOut } from 'next-auth/react'

/**
 * Home for a signed-in account that isn't the owner, until the multi-user
 * import and tailoring flow ships. Nothing owner-specific is loaded here.
 */
export default function UserHome({ name }: { name: string }) {
  const firstName = name.trim().split(/\s+/)[0]

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-3 flex items-center justify-between">
        <span className="font-semibold text-[var(--color-text)] text-base">ResMod</span>
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-colors"
        >
          Sign out
        </button>
      </header>

      <main className="max-w-xl mx-auto px-4 py-16 text-center space-y-4 anim-page-enter">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">
          {firstName ? `Welcome, ${firstName}` : 'Welcome'}
        </h1>
        <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
          You&apos;re early. Soon you&apos;ll be able to upload your resume as a PDF, Word or LaTeX file and
          tailor it to any job description, with every change shown for your review before it&apos;s applied.
        </p>
        <p className="text-xs text-[var(--color-text-faint)]">
          We&apos;ll open this up shortly. Nothing from your account is stored in the meantime.
        </p>
      </main>
    </div>
  )
}
