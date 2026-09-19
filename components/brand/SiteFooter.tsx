import Link from 'next/link'
import Logo from '@/components/brand/Logo'

/** The public pages' footer. */

const GROUPS: Array<[string, Array<[string, string]>]> = [
  ['Product', [['/#how-it-works', 'How it works'], ['/recruiters', 'Weekly recruiter list'], ['/keyword-finder', 'Keyword finder'], ['/pricing', 'Pricing']]],
  ['Policies', [['/terms', 'Terms of Service'], ['/privacy', 'Privacy Policy'], ['/refunds', 'Cancellation and Refunds'], ['/shipping', 'Shipping and Delivery']]],
  ['Help', [['/#faq', 'FAQ'], ['/contact', 'Contact']]],
]

export default function SiteFooter() {
  return (
    <footer className="bg-[var(--color-surface-offset)] border-t-[1.6px] border-[var(--color-ink)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 grid gap-10 sm:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="space-y-3">
          <Logo size={34} />
          <p className="text-sm text-[var(--color-text-muted)] max-w-xs">
            Tailor your resume to every job, without losing what makes it yours.
          </p>
        </div>
        {GROUPS.map(([title, links]) => (
          <div key={title} className="space-y-3">
            <p className="text-xs font-black uppercase tracking-wider text-[var(--color-text)]">{title}</p>
            <ul className="space-y-2">
              {links.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:underline underline-offset-4">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-[var(--color-divider)]">
        <p className="max-w-6xl mx-auto px-4 sm:px-6 py-5 text-xs text-[var(--color-text-faint)]">
          © {new Date().getFullYear()} Chills. Google is used for sign-in only; payments are handled by Razorpay.
        </p>
      </div>
    </footer>
  )
}
