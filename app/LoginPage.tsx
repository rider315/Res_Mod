'use client'

import { signIn } from 'next-auth/react'

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8 text-center anim-page-enter">
        <div className="flex justify-center">
          <div className="relative">
            <svg width="52" height="52" viewBox="0 0 52 52" fill="none" aria-label="ResMod">
              <rect width="52" height="52" rx="14" fill="var(--color-primary)" />
              <path d="M14 14h16a8 8 0 010 16H14V14z" fill="white" opacity="0.9" />
              <path d="M14 30h20" stroke="white" strokeWidth="3" strokeLinecap="round" />
              <path d="M14 38h14" stroke="white" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-[var(--color-success)] rounded-full border-2 border-[var(--color-bg)] anim-pulse-dot" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-[var(--color-text)]">ResMod</h1>
          <p className="text-sm text-[var(--color-text-muted)] max-w-xs mx-auto">
            AI-powered resume optimization. Paste a job description, review every change, and export — all through Google Docs.
          </p>
        </div>

        <ul className="text-left space-y-3 bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-5">
          {[
            ['Non-destructive', 'Creates a copy — original document is never modified'],
            ['Section-aware', 'Parses Experience, Skills, Projects, Education separately'],
            ['Diff review', 'See every proposed change before it is applied'],
            ['Hard constraints', 'Define rules the AI cannot break'],
          ].map(([title, desc]) => (
            <li key={title} className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-[var(--color-primary-highlight)] flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div>
                <span className="text-sm font-semibold text-[var(--color-text)]">{title} </span>
                <span className="text-sm text-[var(--color-text-muted)]">{desc}</span>
              </div>
            </li>
          ))}
        </ul>

        <button
          onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
          className="w-full flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] font-semibold text-sm hover:bg-[var(--color-surface-offset)] transition-all shadow-sm hover:shadow-md"
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>

        <p className="text-xs text-[var(--color-text-faint)]">
          Requires Google Docs and Drive access to read and copy your resume.
        </p>
      </div>
    </main>
  )
}