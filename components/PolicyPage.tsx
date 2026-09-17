import SiteFooter from '@/components/brand/SiteFooter'
import SiteHeader from '@/components/brand/SiteHeader'

/** The shared frame of the public pricing, policy and contact pages. */

export default function PolicyPage({
  title,
  updated,
  intro,
  wide = false,
  children,
}: {
  title: string
  updated?: string
  /** A line under the title. */
  intro?: React.ReactNode
  /** Room for cards, as on the pricing page, instead of one column of text. */
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
      <SiteHeader />
      <main className="flex-1 px-4 sm:px-6 py-14">
        <div className={`${wide ? 'max-w-5xl' : 'max-w-3xl'} mx-auto`}>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight">{title}</h1>
          {intro && <p className="mt-4 text-lg text-[var(--color-text-muted)] leading-relaxed">{intro}</p>}
          {updated && (
            <p className="mt-4 inline-flex nb-chip bg-[var(--color-yellow)] text-[#0a0a0a]">Last updated: {updated}</p>
          )}
          <div
            className={
              wide
                ? 'mt-10 space-y-8 text-[15px] leading-relaxed text-[var(--color-text-muted)]'
                : 'nb-card mt-8 p-6 sm:p-10 space-y-8 text-[15px] leading-relaxed text-[var(--color-text-muted)] [&_a]:font-semibold [&_a]:text-[var(--color-primary)]'
            }
          >
            {children}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}

export function PolicySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-extrabold text-[var(--color-text)]">{title}</h2>
      {children}
    </section>
  )
}
