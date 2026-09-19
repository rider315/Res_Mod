import { notFound } from 'next/navigation'
import Link from 'next/link'
import SiteFooter from '@/components/brand/SiteFooter'
import SiteHeader from '@/components/brand/SiteHeader'
import { StartButton } from '@/components/brand/SignInButton'
import { ArrowLeft, CheckCircle, Users } from '@/components/brand/Icons'
import JsonLd from '@/components/brand/JsonLd'
import { absolute, breadcrumbSchema } from '@/lib/seo'
import { LIMITS } from '@/lib/outreach/model'
import { publishedWeek, publishedWeeks } from '@/lib/db/directory'

/**
 * One week of the recruiter list, as its own page.
 *
 * Each batch is a page a search engine can find on its own, which is the only
 * way a weekly thing earns its keep in search: one page that keeps changing
 * looks like one page, and a page per week looks like a publication.
 *
 * The same rule as everywhere else holds and matters more here, because these
 * pages are meant to be found: NO ADDRESS, NO NAME, NO EMPLOYER. Counts and
 * fields, and the week they went up. The contacts themselves are inside an
 * account, to the people who took them.
 */

export const dynamic = 'force-dynamic'

const OUTREACH = '/dashboard?open=outreach'

/** "19 September 2026", or the raw batch when it isn't a date. */
function weekOf(batch: string): string {
  const when = new Date(batch)
  return Number.isNaN(when.getTime()) ? batch : when.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
}

export async function generateMetadata({ params }: { params: { batch: string } }) {
  const week = await publishedWeek(params.batch).catch(() => null)
  if (!week) return { title: 'That week is not published | Chills' }
  const when = weekOf(week.batch)
  return {
    title: `${week.published} hiring contacts, week of ${when} | Chills`,
    description:
      `Chills published ${week.published} hiring contacts in the week of ${when}` +
      `${week.fields.length > 0 ? `, across ${week.fields.join(', ')}` : ''}. ` +
      `${week.open} are still open to new accounts. Take the ones that fit and Chills writes each email from your résumé.`,
    alternates: { canonical: absolute(`/recruiters/week/${week.batch}`) },
  }
}

export default async function WeekPage({ params }: { params: { batch: string } }) {
  const week = await publishedWeek(params.batch).catch(() => null)
  if (!week) notFound()

  const when = weekOf(week.batch)
  const others = (await publishedWeeks(12).catch(() => [])).filter((entry) => entry.batch !== week.batch)

  return (
    <div className="min-h-screen bg-[var(--color-surface)] text-[var(--color-text)]">
      <JsonLd
        data={breadcrumbSchema([
          { name: 'Chills', path: '/' },
          { name: 'Weekly recruiter list', path: '/recruiters' },
          { name: when, path: `/recruiters/week/${week.batch}` },
        ])}
      />
      <SiteHeader />

      <section className="px-4 sm:px-6 pt-14 pb-14 bg-[var(--color-accent-soft)] border-b-[1.6px] border-[var(--color-ink)]">
        <div className="max-w-4xl mx-auto">
          <Link href="/recruiters" className="inline-flex items-center gap-1.5 text-sm font-bold hover:underline">
            <ArrowLeft size={16} /> Every week
          </Link>
          <h1 className="mt-4 text-[2rem] leading-[1.2] sm:text-5xl sm:leading-[1.15] font-black tracking-tight">
            {week.published} hiring contacts, <span className="nb-highlight">week of {when}</span>
          </h1>
          <p className="mt-6 text-lg text-[var(--color-text-muted)] leading-relaxed max-w-3xl">
            Recruiters and hiring managers at companies taking applications that week. Every address was checked before it went up,
            and {week.open === 0 ? 'this batch has now been taken as often as it is open to' : `${week.open} are still open to new accounts`}.
          </p>

          <dl className="mt-10 grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-2xl">
            <Stat value={week.published} label="published this week" />
            <Stat value={week.open} label="still open" />
            <Stat value={LIMITS.directoryPerWeek} label="you can take a week" />
          </dl>
        </div>
      </section>

      <section className="px-4 sm:px-6 py-16">
        <div className="max-w-4xl mx-auto grid gap-10 lg:grid-cols-2 items-start">
          <div className="space-y-5">
            <h2 className="text-2xl sm:text-3xl font-black flex items-center gap-2.5">
              <Users size={24} /> What this week covered
            </h2>
            {week.fields.length > 0 ? (
              <ul className="space-y-2">
                {week.fields.map((field) => (
                  <li
                    key={field}
                    className="flex items-center gap-2.5 rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-surface-offset)] px-3.5 py-2.5 font-bold capitalize"
                  >
                    <CheckCircle size={18} className="text-[var(--color-success)] shrink-0" /> {field}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[var(--color-text-muted)]">Mixed fields.</p>
            )}
            <p className="text-xs text-[var(--color-text-muted)]">
              Names, companies and addresses are shown inside your account, to the people who take them. They are real people’s work
              addresses, so they are not published on a page anyone can scrape.
            </p>
          </div>

          <div className="nb-card rounded-[10px] p-5 sm:p-6 space-y-4">
            <h2 className="text-xl font-black">How to use a batch like this</h2>
            <ol className="space-y-3 text-[var(--color-text-muted)]">
              {[
                'Take the contacts whose field matches what you actually do. Twelve good ones beat forty scattered.',
                'Tailor your résumé to the role first — the email is written from it, so a sharper résumé is a sharper email.',
                'Read every draft before it goes. It is your name on it, and your mailbox it leaves from.',
                'Give it a week before the follow-up. Chills tells you who opened and who answered.',
              ].map((step, i) => (
                <li key={step} className="flex items-start gap-3">
                  <span className="nb-badge w-7 h-7 shrink-0 text-sm bg-[var(--color-yellow)]">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <StartButton label="Open the list" to={OUTREACH} className="w-full justify-center" />
          </div>
        </div>
      </section>

      {others.length > 0 && (
        <section className="px-4 sm:px-6 py-16 bg-[var(--color-bg)] border-t-[1.6px] border-[var(--color-ink)]">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-black">Other weeks</h2>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {others.map((entry) => (
                <li key={entry.batch}>
                  <Link
                    href={`/recruiters/week/${entry.batch}`}
                    className="flex items-center justify-between gap-3 nb-card rounded-[10px] px-4 py-3 hover:bg-[var(--color-accent-soft)]"
                  >
                    <span className="font-bold">{weekOf(entry.batch)}</span>
                    <span className="text-sm text-[var(--color-text-muted)] tabular-nums">{entry.published} contacts</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <SiteFooter />
    </div>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="nb-card rounded-[10px] bg-[var(--color-surface)] px-4 py-5">
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className="block text-4xl font-black tabular-nums">{value}</span>
        <span className="mt-1 block text-xs font-black uppercase tracking-wider text-[var(--color-text-muted)]">{label}</span>
      </dd>
    </div>
  )
}
