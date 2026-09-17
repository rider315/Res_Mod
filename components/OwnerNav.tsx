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
 * While ResMod AI is off, every other account can't import or tailor at all, so
 * that is flagged here, on every owner screen, until it is set.
 */

const link =
  'inline-flex items-center px-3 py-1.5 text-sm font-bold rounded-[8px] border-[1.6px] border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-ink)] transition-all'

interface OwnerNavProps {
  inUserWorkspace?: boolean
  /** Opens AI settings at the ResMod AI section. */
  onOpenAiSettings?: () => void
}

export default function OwnerNav({ inUserWorkspace = false, onOpenAiSettings }: OwnerNavProps) {
  const [showBusiness, setShowBusiness] = useState(false)
  const [platformOff, setPlatformOff] = useState(false)

  const checkPlatformAi = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/platform-ai', { cache: 'no-store' })
      if (!res.ok) return
      const status: PlatformAiStatus = await res.json()
      setPlatformOff(!status.working && !status.overriddenByEnv)
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
      {platformOff && onOpenAiSettings && (
        <button
          onClick={onOpenAiSettings}
          title="Every other account can't import or tailor until you choose the AI they run on."
          className="nb-btn nb-btn-sm nb-btn-yellow px-3 py-1.5 text-xs"
        >
          <span aria-hidden>⚠</span> Set up ResMod AI
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
