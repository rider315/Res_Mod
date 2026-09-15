'use client'
import { useState } from 'react'
import { signOut } from 'next-auth/react'
import { readApiError } from '@/components/user/billing-client'
import { dangerButton, errorBox, inputClass } from '@/components/user/shared'
import { clearLocalAppData } from '@/lib/settings-storage'

/** The signed-in account: who it is, where its data lives, and deleting it. */

interface AccountPanelProps {
  email: string
  onBack: () => void
  onOpenHistory: () => void
}

const CONFIRM_WORD = 'DELETE'
const card = 'bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-5'

export default function AccountPanel({ email, onBack, onOpenHistory }: AccountPanelProps) {
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function deleteAccount() {
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: CONFIRM_WORD }),
      })
      if (!res.ok) throw await readApiError(res, 'Your account could not be deleted.')
      clearLocalAppData()
      await signOut({ callbackUrl: '/?deleted=1' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6 anim-page-enter">
      <div>
        <button
          onClick={onBack}
          disabled={deleting}
          className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50 transition-colors"
        >
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-[var(--color-text)] mt-2">Your account</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">Signed in with Google{email ? ` as ${email}` : ''}.</p>
      </div>

      <section className={card}>
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Your data</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-[var(--color-text-muted)] list-disc pl-5">
          <li>
            Your saved resumes and your{' '}
            <button onClick={onOpenHistory} className="text-[var(--color-primary)] hover:underline">
              tailoring history
            </button>{' '}
            are stored with your account.
          </li>
          <li>API keys you add in AI settings stay in this browser. ResMod&apos;s servers never store them.</li>
          <li>Payments are handled by Razorpay; ResMod keeps only the payment records.</li>
        </ul>
        <p className="text-xs text-[var(--color-text-muted)] mt-3">
          The{' '}
          <a href="/privacy" className="underline hover:text-[var(--color-text)]">
            privacy policy
          </a>{' '}
          has the details.
        </p>
      </section>

      <section className="rounded-2xl border border-[var(--color-error)] p-5 space-y-3">
        <h2 className="text-sm font-semibold text-[var(--color-error)]">Delete your account</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          This deletes your saved resumes, your tailoring history, and your name and email, then signs you out. It can&apos;t
          be undone.
        </p>
        <ul className="text-sm text-[var(--color-text-muted)] list-disc pl-5 space-y-1">
          <li>Unused credits are lost.</li>
          <li>A Pro plan is cancelled and won&apos;t renew. The current month isn&apos;t refunded.</li>
          <li>Payment records are kept for accounting, and so are usage counts, so deleting doesn&apos;t reset free runs.</li>
        </ul>
        <label className="block">
          <span className="block text-xs text-[var(--color-text-muted)] mb-1.5">Type {CONFIRM_WORD} to confirm</span>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={deleting}
            autoComplete="off"
            spellCheck={false}
            className={`${inputClass} max-w-xs`}
          />
        </label>
        {error && <div className={errorBox}>{error}</div>}
        <button onClick={deleteAccount} disabled={deleting || confirmText.trim() !== CONFIRM_WORD} className={dangerButton}>
          {deleting ? 'Deleting…' : 'Delete my account'}
        </button>
      </section>
    </div>
  )
}
