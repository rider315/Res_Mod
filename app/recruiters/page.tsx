import SiteFooter from '@/components/brand/SiteFooter'
import SiteHeader from '@/components/brand/SiteHeader'
import { SignedOutOnly, StartButton } from '@/components/brand/SignInButton'
import { CheckCircle, ChevronDown, Mail, Users } from '@/components/brand/Icons'
import { LIMITS } from '@/lib/outreach/model'
import { directoryFields, directoryStats, latestBatch } from '@/lib/db/directory'

/**
 * The weekly recruiter list, for people who haven't signed up yet.
 *
 * It exists because it is the one thing Chills gives away that nobody else
 * does, and because "I don't know who to email" is where most cold outreach
 * stops — long before the writing of the email is the problem.
 *
 * NOTHING ON THIS PAGE MAY IDENTIFY A RECRUITER. No address, no name, no
 * employer. Only counts, fields and the week the batch went up. These are real
 * people's work addresses: publishing them here would hand the list to scrapers,
 * burn it for the accounts that earned it, and be a plain breach of the trust
 * the addresses were collected under. The numbers are read live, so the page is
 * evidence rather than a claim, but they are aggregates and must stay that way.
 */

export const metadata = {
  title: 'A fresh list of recruiters every week | Chills',
  description:
    'Chills publishes a new list of hiring contacts every week. Take the ones that fit, and send each a résumé tailored to the job with an email written from it.',
}

/** The counts change as the week's batch is taken, so nothing here may be cached. */
export const dynamic = 'force-dynamic'

const OUTREACH = '/dashboard?open=outreach'

interface Published {
  batch: string | null
  open: number
  batches: number
  fields: Array<{ field: string; open: number }>
}

/**
 * What is published right now. A database that can't be reached must not take
 * the page down with it: the page then reads as the description it always was,
 * with no numbers on it.
 */
async function published(): Promise<Published | null> {
  try {
    const [batch, stats, fields] = await Promise.all([latestBatch(), directoryStats(), directoryFields()])
    if (stats.total === 0) return null
    return { batch, open: stats.open, batches: stats.batches, fields: fields.slice(0, 8) }
  } catch (err) {
    console.warn('[recruiters] the published counts could not be read:', err instanceof Error ? err.message : err)
    return null
  }
}

const weekOf = (batch: string | null): string => {
  if (!batch) return ''
  const when = new Date(batch)
  return Number.isNaN(when.getTime()) ? '' : when.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })
}

const HOW: Array<[string, string]> = [
  ['A new batch every week', 'Hiring contacts at companies that are actually recruiting, checked so the address exists before it goes up.'],
  [
    `Take up to ${LIMITS.directoryPerWeek} a week`,
    'Pick the ones that fit what you do. They land in your own list, and nobody else can take one that has been taken too often.',
  ],
  [
    'Chills writes each email',
    "It reads the company's own website, so the email says something true about them, and it can tailor your résumé to the role first.",
  ],
  ['Sent from your own mailbox', 'Replies come to you, and a copy sits in your Sent folder. Chills never sends from a shared address.'],
]

const FAQ: Array<[string, string]> = [
  [
    'What is actually in the list?',
    'Hiring contacts — recruiters and hiring managers at companies that are taking applications. Each entry has the person’s role, their company and the field they hire for, so you can tell whether they are worth writing to before you take them.',
  ],
  [
    'How many can I take?',
    `Up to ${LIMITS.directoryPerWeek} a week. Each contact can only be taken by ${LIMITS.directoryTakesPerRecruiter} accounts in total, and then it comes off the list — the point is that the person you write to has not already had the same email from a hundred people.`,
  ],
  [
    'Does it cost anything?',
    'No. The list comes with every free account, along with three résumé tailorings and ten AI-written emails a month.',
  ],
  [
    'Do you send the emails for me?',
    'No. Every email waits as a draft for you to read, edit and send, and it goes from your own mailbox, not from Chills. You decide what goes out under your name.',
  ],
  [
    'Where do the addresses come from?',
    'Public sources: careers pages, company sites and public professional profiles. Nothing is bought, scraped from a private service, or guessed at from a pattern.',
  ],
  [
    'I am a recruiter and I do not want to be on this list.',
    'Write to us from the address you want removed and it comes off at once and can never be taken again, by anyone. No account keeps it.',
  ],
]

export default async function RecruitersPage() {
  const live = await published()
  const week = weekOf(live?.batch ?? null)

  return (
    <div className="min-h-screen bg-[var(--color-surface)] text-[var(--color-text)]">
      <SiteHeader />

      <section className="px-4 sm:px-6 pt-16 pb-16 bg-[var(--color-accent-soft)] border-b-[1.6px] border-[var(--color-ink)]">
        <div className="max-w-4xl mx-auto text-center">
          {week && <span className="nb-chip bg-[var(--color-yellow)] text-[#0a0a0a]">This week’s list went up on {week}</span>}
          <h1 className="mt-5 text-[2.4rem] leading-[1.2] sm:text-6xl sm:leading-[1.2] font-black tracking-tight">
            A fresh list of <span className="nb-highlight">recruiters</span> every week
          </h1>
          <p className="mt-7 text-lg sm:text-xl text-[var(--color-text-muted)] leading-relaxed">
            Most cold outreach stops long before the email is the problem: you don’t know who to write to. Chills publishes a new
            batch of hiring contacts every week, and writes each email from your résumé and the company’s own website.
          </p>
          <div className="mt-9 flex flex-col items-center gap-3">
            <StartButton label="See this week’s list" to={OUTREACH} />
            <SignedOutOnly>
              <p className="text-sm font-bold text-[var(--color-text-muted)]">Sign in with Google · Free · No card needed</p>
            </SignedOutOnly>
          </div>

          {live && (
            <dl className="mt-12 grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
              <Stat value={live.open} label={live.open === 1 ? 'contact open now' : 'contacts open right now'} />
              <Stat value={live.batches} label={live.batches === 1 ? 'weekly batch published' : 'weekly batches published'} />
              <Stat value={LIMITS.directoryPerWeek} label="you can take each week" />
            </dl>
          )}
        </div>
      </section>

      <section className="px-4 sm:px-6 py-20">
        <div className="max-w-5xl mx-auto grid gap-10 lg:grid-cols-2 items-start">
          <div className="space-y-6">
            <h2 className="text-3xl sm:text-4xl font-black">How it works</h2>
            <ul className="space-y-4">
              {HOW.map(([title, text]) => (
                <li key={title} className="flex items-start gap-3">
                  <span className="nb-badge w-9 h-9 shrink-0 bg-[var(--color-accent)]">
                    <CheckCircle size={18} />
                  </span>
                  <div>
                    <p className="font-extrabold">{title}</p>
                    <p className="text-[var(--color-text-muted)]">{text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="nb-card rounded-[10px] p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-black text-lg flex items-center gap-2">
                <Users size={18} /> What the list covers
              </p>
              {week && <span className="nb-chip bg-[var(--color-yellow)] text-[#0a0a0a] whitespace-nowrap">{week}</span>}
            </div>

            {live && live.fields.length > 0 ? (
              <>
                <ul className="space-y-2">
                  {live.fields.map((entry) => (
                    <li
                      key={entry.field}
                      className="flex items-center justify-between gap-3 rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-surface-offset)] px-3.5 py-2.5"
                    >
                      <span className="font-bold capitalize">{entry.field}</span>
                      <span className="nb-badge px-2.5 py-0.5 text-xs bg-[var(--color-accent)] tabular-nums">{entry.open} open</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Names, companies and addresses are shown inside your account, to the people who take them. They are real people’s
                  work addresses, so they are not published on a page anyone can scrape.
                </p>
              </>
            ) : (
              <p className="text-[var(--color-text-muted)]">
                The next batch goes up shortly. Make a free account and it will be waiting in Outreach when it does — along with the
                three résumé tailorings and ten AI-written emails every account gets.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="px-4 sm:px-6 py-20 bg-[var(--color-bg)] border-t-[1.6px] border-[var(--color-ink)]">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-black text-center flex items-center justify-center gap-3">
            <Mail size={28} /> Questions
          </h2>
          <div className="mt-10 space-y-4">
            {FAQ.map(([question, answer], i) => (
              <details key={question} open={i === 0} className="group nb-card nb-rounded bg-[var(--color-accent-soft)] px-5 py-4">
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none font-bold text-lg">
                  {question}
                  <ChevronDown size={20} className="shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-3 text-[var(--color-text-muted)] leading-relaxed">
                  {answer}
                  {i === FAQ.length - 1 && (
                    <>
                      {' '}
                      <a href="/contact" className="underline font-semibold">
                        Contact us
                      </a>
                      .
                    </>
                  )}
                </p>
              </details>
            ))}
          </div>
          <div className="mt-12 flex justify-center">
            <StartButton label="See this week’s list" to={OUTREACH} />
          </div>
        </div>
      </section>

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
