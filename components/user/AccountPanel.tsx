'use client'
import { useState } from 'react'
import { signOut } from 'next-auth/react'
import { readApiError } from '@/components/user/billing-client'
import { dangerButton, errorBox, inputClass, backLinkClass } from '@/components/user/shared'
import { ArrowLeft } from '@/components/brand/Icons'
import ExtensionKeys from '@/components/user/ExtensionKeys'
import { clearLocalAppData } from '@/lib/settings-storage'

/** The signed-in account: who it is, where its data lives, and deleting it. */

interface AccountPanelProps {
  email: string
  onBack: () => void
  onOpenHistory: () => void
}

const CONFIRM_WORD = 'DELETE'
const card = 'nb-card rounded-[10px] p-5'

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
    <div className="space-y-8 anim-page-enter max-w-3xl">
      <div>
        <button onClick={onBack} disabled={deleting} className={backLinkClass}>
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="mt-3 text-4xl sm:text-5xl font-black tracking-tight">
          Your <span className="nb-highlight">account</span>
        </h1>
        <p className="mt-5 text-lg text-[var(--color-text-muted)]">Signed in with Google{email ? ` as ${email}` : ''}.</p>
      </div>

      <section className={card}>
        <h2 className="text-xl font-black">Your data</h2>
        <ul className="mt-3 space-y-1.5 text-sm text-[var(--color-text-muted)] list-disc pl-5">
          <li>
            Your saved resumes and your{' '}
            <button onClick={onOpenHistory} className="font-bold text-[var(--color-text)] underline underline-offset-4">
              tailoring history
            </button>
            , with its cover letters, are stored with your account.
          </li>
          <li>So are the recruiters you add and the emails you write to them. A connected mailbox’s app password is stored encrypted.</li>
          <li>Job descriptions you check in the keyword finder aren&apos;t saved.</li>
          <li>Payments are handled by Razorpay; Chills keeps only the payment records.</li>
        </ul>
        <p className="text-xs text-[var(--color-text-muted)] mt-3">
          The{' '}
          <a href="/privacy" className="font-bold underline underline-offset-4 hover:text-[var(--color-text)]">
            privacy policy
          </a>{' '}
          has the details.
        </p>
      </section>

      <ExtensionKeys />

      <section className="nb-card rounded-[10px] p-5 space-y-3 bg-[var(--color-error-highlight)]">
        <h2 className="text-xl font-black text-[var(--color-error)]">Delete your account</h2>
        <p className="text-sm text-[var(--color-text)]">
          This deletes your saved resumes, your tailoring history and cover letters, your recruiters and emails, your
          connected mailbox, and your name and email, then signs you out. It can&apos;t be undone.
        </p>
        <ul className="text-sm text-[var(--color-text)] list-disc pl-5 space-y-1">
          <li>Unused credits are lost.</li>
          <li>A Pro plan is cancelled and won&apos;t renew. The current month isn&apos;t refunded.</li>
          <li>Payment records are kept for accounting, and so are usage counts, so deleting doesn&apos;t give you free tailorings again.</li>
        </ul>
        <label className="block">
          <span className="block text-sm font-bold mb-1.5">Type {CONFIRM_WORD} to confirm</span>
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
