'use client'
import { useState } from 'react'
import Link from 'next/link'
import AdminOverview from '@/components/AdminOverview'

/**
 * The owner's links: between the resume profiles and the workspace every other
 * account uses, and to the Business overview.
 */

const link =
  'h-8 px-2 inline-flex items-center rounded-lg text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-offset)] transition-all'

export default function OwnerNav({ inUserWorkspace = false }: { inUserWorkspace?: boolean }) {
  const [showBusiness, setShowBusiness] = useState(false)

  return (
    <>
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
