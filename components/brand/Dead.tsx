import Link from 'next/link'
import { LogoMark } from '@/components/brand/Logo'

/**
 * What a visitor sees when a page isn't there or has fallen over.
 *
 * Both cases used to land on Next's own black-and-white page: no mark, no
 * header, and no way on except the back button. That is a dead end at the worst
 * moment, and an expensive one on a page reached from an ad.
 *
 * So it says what happened in one line and offers the three places worth going,
 * and it is deliberately plain — an error page that needs the app to work isn't
 * one.
 */
export default function Dead({
  code,
  title,
  body,
  action,
}: {
  code: string
  title: string
  body: string
  /** A retry, for the errors that are worth one. */
  action?: React.ReactNode
}) {
  return (
    <main className="min-h-screen bg-[var(--color-surface)] text-[var(--color-text)] flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg text-center">
        <Link href="/" aria-label="Chills home" className="inline-flex">
          <LogoMark size={56} />
        </Link>

        <p className="mt-8 text-sm font-black uppercase tracking-[0.2em] text-[var(--color-text-faint)]">{code}</p>
        <h1 className="mt-3 text-3xl sm:text-4xl font-black tracking-tight">{title}</h1>
        <p className="mt-4 text-[var(--color-text-muted)] leading-relaxed">{body}</p>

        {action && <div className="mt-8 flex justify-center">{action}</div>}

        <nav className="mt-10 grid gap-3 sm:grid-cols-3 text-left">
          {[
            ['/', 'Home', 'What Chills does'],
            ['/recruiters', 'Recruiter list', 'A fresh batch weekly'],
            ['/pricing', 'Pricing', 'Free to start'],
          ].map(([href, label, note]) => (
            <Link
              key={href}
              href={href}
              className="nb-card rounded-[10px] px-4 py-3 hover:bg-[var(--color-accent-soft)] transition-colors"
            >
              <span className="block font-bold">{label}</span>
              <span className="block text-xs text-[var(--color-text-muted)] mt-0.5">{note}</span>
            </Link>
          ))}
        </nav>
      </div>
    </main>
  )
}
