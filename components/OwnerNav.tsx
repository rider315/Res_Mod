'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import AdminOverview from '@/components/AdminOverview'
import { PLATFORM_AI_CHANGED } from '@/components/PlatformAiSection'
import type { PlatformAiStatus } from '@/lib/billing/types'

/**
 * The owner's links: between the resume profiles and the workspace every other
 * account uses, and to the Business overview.
 *
 * While Chills AI is off, every other account can't import or tailor at all, so
 * that is flagged here, on every owner screen, until it is set. So is Chills AI
 * failing in a way only the owner can fix, such as a key the provider rejects:
 * users see only a short notice, so without this nobody who can fix it finds out.
 */

/** A failure only the owner can fix, this recent, flags Chills AI as failing. */
const FAILING_WINDOW_MS = 24 * 60 * 60 * 1000

const link =
  'inline-flex items-center px-3 py-1.5 text-sm font-bold rounded-[8px] border-[1.6px] border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-ink)] transition-all'

interface OwnerNavProps {
  inUserWorkspace?: boolean
  /** Opens AI settings at the Chills AI section. */
  onOpenAiSettings?: () => void
}

export default function OwnerNav({ inUserWorkspace = false, onOpenAiSettings }: OwnerNavProps) {
  const [showBusiness, setShowBusiness] = useState(false)
  const [platform, setPlatform] = useState<{ issue: 'off' | 'failing'; detail: string } | null>(null)

  const checkPlatformAi = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/platform-ai', { cache: 'no-store' })
      if (!res.ok) return
      const status: PlatformAiStatus = await res.json()
      const latest = status.recentFailures[0]
      if (!status.working && !status.overriddenByEnv) {
        setPlatform({ issue: 'off', detail: "Every other account can't import or tailor until you choose the AI they run on." })
      } else if (latest?.kind === 'setup' && Date.now() - Date.parse(latest.at) < FAILING_WINDOW_MS) {
        setPlatform({ issue: 'failing', detail: `Your users' requests are being refused: ${latest.message}` })
      } else {
        setPlatform(null)
      }
    } catch {
      // Not knowing isn't worth a warning; the Business overview checks it too.
    }
  }, [])

  useEffect(() => {
    checkPlatformAi()
    window.addEventListener(PLATFORM_AI_CHANGED, checkPlatformAi)
    return () => window.removeEventListener(PLATFORM_AI_CHANGED, checkPlatformAi)
  }, [checkPlatformAi])

  return (
    <>
      {platform && onOpenAiSettings && (
        <button
          onClick={onOpenAiSettings}
          title={platform.detail}
          className="nb-btn nb-btn-sm nb-btn-yellow px-3 py-1.5 text-xs"
        >
          <span aria-hidden>⚠</span> {platform.issue === 'off' ? 'Set up Chills AI' : 'Chills AI is failing'}
        </button>
      )}
      <Link
        href={inUserWorkspace ? '/dashboard' : '/dashboard?workspace=user'}
        className={link}
        title={inUserWorkspace ? 'Back to your resume profiles' : 'Import and tailor resumes the way your users do'}
      >
        {inUserWorkspace ? 'Owner tools' : 'User workspace'}
      </Link>
      <button onClick={() => setShowBusiness(true)} className={link}>
        Business
      </button>
      {showBusiness && <AdminOverview onClose={() => setShowBusiness(false)} />}
    </>
  )
}
