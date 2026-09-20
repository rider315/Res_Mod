'use client'
import { useState } from 'react'
import { CheckCircle, Shield } from '@/components/brand/Icons'
import { cardClass, errorBox, primaryButton } from '@/components/user/shared'

/**
 * The consent step: what the extension will be able to do, and the one button
 * that grants it.
 *
 * The key is delivered by navigating to the extension's callback address, which
 * only Chrome can serve and only to the extension that asked. So the user never
 * handles the key, and there is nothing on screen worth a screenshot.
 */

interface ConnectPanelProps {
  email: string
  extensionId: string
  redirectUri: string
  state: string
  label: string
}

const CAN = [
  'Read the job posting on the page you are looking at',
  'See your saved resumes, and score them against that job',
  'Save jobs to your list, and start a tailoring in Chills',
]

const CANNOT = [
  'Change your plan, or pay for anything',
  'Send an email to anybody',
  'Delete your account or your resumes',
]

export default function ConnectPanel({ email, extensionId, redirectUri, state, label }: ConnectPanelProps) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function connect() {
    setWorking(true)
    setError(null)
    try {
      const res = await fetch('/api/extension/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirectUri, state, label: label || 'Chrome extension' }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.redirectTo) throw new Error(data?.error ?? 'That key could not be made.')
      // Chrome is watching this navigation; it takes the key and closes the window.
      window.location.replace(data.redirectTo)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setWorking(false)
    }
  }

  return (
    <div className={`${cardClass} p-6 bg-[var(--color-surface)]`}>
      <span className="nb-badge w-11 h-11 bg-[var(--color-accent)]">
        <Shield size={20} />
      </span>
      <h1 className="mt-4 text-2xl font-black">Connect the Chills extension</h1>
      <p className="mt-2 text-[var(--color-text-muted)]">
        It will work on <strong className="text-[var(--color-text)]">{email}</strong>.
      </p>

      {error && <div className={`${errorBox} mt-5`}>{error}</div>}

      <div className="mt-6 space-y-5">
        <div>
          <h2 className="font-extrabold text-sm uppercase tracking-wide">It will be able to</h2>
          <ul className="mt-2 space-y-1.5">
            {CAN.map((line) => (
              <li key={line} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 shrink-0 text-[var(--color-accent-ink,inherit)]">
                  <CheckCircle size={16} />
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="font-extrabold text-sm uppercase tracking-wide">It will not be able to</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-[var(--color-text-muted)]">
            {CANNOT.map((line) => (
              <li key={line} className="flex items-start gap-2">
                <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)]" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <button onClick={connect} disabled={working} className={`${primaryButton} mt-7 w-full justify-center`}>
        {working ? 'Connecting…' : 'Connect'}
      </button>

      <p className="mt-4 text-xs text-[var(--color-text-muted)] leading-relaxed">
        Extension <code className="font-mono">{extensionId}</code>. You can disconnect it at any time from your account
        settings, and it stops working immediately.
      </p>
    </div>
  )
}
