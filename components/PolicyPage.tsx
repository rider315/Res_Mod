import Link from 'next/link'

/** The shared frame of the public pricing and policy pages. */

const LINKS: Array<[string, string]> = [
  ['/pricing', 'Pricing'],
  ['/terms', 'Terms of Service'],
  ['/privacy', 'Privacy Policy'],
  ['/refunds', 'Cancellation and Refunds'],
  ['/shipping', 'Shipping and Delivery'],
  ['/contact', 'Contact'],
]

export default function PolicyPage({
  title,
  updated,
  children,
}: {
  title: string
  updated?: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] py-12 px-6">
      <div className="max-w-3xl mx-auto space-y-8 text-[var(--color-text)]">
        <div className="space-y-2">
          <Link href="/" className="text-[var(--color-primary)] hover:underline text-sm font-medium">← Back to home</Link>
          <h1 className="text-3xl font-bold">{title}</h1>
          {updated && <p className="text-[var(--color-text-muted)]">Last updated: {updated}</p>}
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-[var(--color-text-muted)]">{children}</div>

        <nav className="flex flex-wrap gap-x-4 gap-y-1 pt-4 border-t border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} className="hover:text-[var(--color-primary)] hover:underline">
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  )
}

export function PolicySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-[var(--color-text)]">{title}</h2>
      {children}
    </section>
  )
}
