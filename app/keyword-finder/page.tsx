import SiteFooter from '@/components/brand/SiteFooter'
import SiteHeader from '@/components/brand/SiteHeader'
import { SignedOutOnly, StartButton } from '@/components/brand/SignInButton'
import { CheckCircle, ChevronDown, Search, Target } from '@/components/brand/Icons'
import { DAILY_AI_REQUESTS } from '@/lib/billing/quota'

export const metadata = {
  title: 'Job description keyword finder | ResMod',
  description:
    'Find the keywords a job description screens for, scored and split into must-haves and nice-to-haves, and check your resume against them.',
}

const EXAMPLE: Array<{ term: string; score: number; where: string; required: boolean }> = [
  { term: 'Kubernetes', score: 10, where: 'Your skills line, and a bullet where you used it', required: true },
  { term: 'Terraform', score: 9, where: 'Your skills line, and a bullet where you used it', required: true },
  { term: 'Incident response', score: 8, where: 'Experience bullets that describe this work', required: true },
  { term: 'Kafka', score: 5, where: 'Your skills line, and a bullet where you used it', required: false },
]

const FAQ: Array<[string, string]> = [
  [
    'What does the keyword finder do?',
    'It reads a job description and lists the terms an applicant tracking system screens it for: skills, tools, certifications and the work the role involves. Each gets a score from 1 to 10 and a note on where it belongs on a resume.',
  ],
  [
    'How are the keywords scored?',
    'Must-have keywords score 5 to 10 and nice-to-haves 1 to 6. Terms the job description leads with, and comes back to more often, score higher.',
  ],
  [
    'Is it free?',
    `Yes, with a free ResMod account. Finding keywords uses no tailoring, only one of the ${DAILY_AI_REQUESTS} AI requests every account can make each day.`,
  ],
  [
    'Can it check my resume?',
    'Yes. Pick one of your saved resumes and see which keywords it already has, which appear only in your skills, and which are missing, with a match score.',
  ],
  [
    'Is my job description saved?',
    'No. The job description is used to find the keywords and is not stored. It is saved only if you go on to tailor a resume to it and apply the changes.',
  ],
]

/** The dashboard, opened on the keyword finder. */
const FINDER = '/dashboard?open=keywords'

export default function KeywordFinderPage() {
  return (
    <div className="min-h-screen bg-[var(--color-surface)] text-[var(--color-text)]">
      <SiteHeader />

      <section className="px-4 sm:px-6 pt-16 pb-16 bg-[var(--color-accent-soft)] border-b-[1.6px] border-[var(--color-ink)]">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-[2.4rem] leading-[1.2] sm:text-6xl sm:leading-[1.2] font-black tracking-tight">
            Job description <span className="nb-highlight">keyword finder</span>
          </h1>
          <p className="mt-7 text-lg sm:text-xl text-[var(--color-text-muted)] leading-relaxed">
            Paste a job post and see the keywords it screens for, scored and split into must-haves and nice-to-haves, so you know
            exactly what your resume needs.
          </p>
          <div className="mt-9 flex flex-col items-center gap-3">
            <StartButton label="Find keywords free" to={FINDER} />
            <SignedOutOnly>
              <p className="text-sm font-bold text-[var(--color-text-muted)]">Sign in with Google · No card needed</p>
            </SignedOutOnly>
          </div>
        </div>
      </section>

      <section className="px-4 sm:px-6 py-20">
        <div className="max-w-5xl mx-auto grid gap-10 lg:grid-cols-2 items-start">
          <div className="space-y-6">
            <h2 className="text-3xl sm:text-4xl font-black">What you get in seconds</h2>
            <ul className="space-y-4">
              {[
                ['Must-have keywords', 'The terms to place first, in your summary and your strongest bullets.'],
                ['Nice-to-have keywords', 'Extra terms that strengthen the match without stuffing.'],
                ['A score and a place for each', 'How much the job leans on it, and where on your resume it belongs.'],
                ['A match check', 'See how one of your saved resumes scores against the job, then tailor it in one click.'],
              ].map(([title, text]) => (
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
                <Search size={18} /> Senior Platform Engineer
              </p>
              <span className="nb-chip bg-[var(--color-yellow)]">Example</span>
            </div>
            <div className="flex items-center gap-4 rounded-[10px] border-[1.6px] border-[var(--color-ink)] p-3 bg-[var(--color-surface-offset)]">
              <span className="nb-badge w-16 h-16 text-xl bg-[var(--color-yellow)]">64%</span>
              <div>
                <p className="font-black flex items-center gap-1.5">
                  <Target size={16} /> Keyword match
                </p>
                <p className="text-sm text-[var(--color-text-muted)]">4 of 7 must-haves in your resume</p>
              </div>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {EXAMPLE.map((keyword) => (
                <li key={keyword.term} className="rounded-[10px] border-[1.6px] border-[var(--color-ink)] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-extrabold">{keyword.term}</p>
                    <span
                      className={`nb-badge px-2 py-0.5 text-xs ${
                        keyword.score >= 8 ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-yellow)]'
                      }`}
                    >
                      {keyword.score}/10
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{keyword.where}</p>
                  <p className="mt-2 text-[11px] font-black uppercase tracking-wide text-[var(--color-text-faint)]">
                    {keyword.required ? 'Must-have' : 'Nice to have'}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="px-4 sm:px-6 py-20 bg-[var(--color-bg)] border-t-[1.6px] border-[var(--color-ink)]">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-black text-center">Questions about the keyword finder</h2>
          <div className="mt-10 space-y-4">
            {FAQ.map(([question, answer], i) => (
              <details key={question} open={i === 0} className="group nb-card nb-rounded bg-[var(--color-accent-soft)] px-5 py-4">
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none font-bold text-lg">
                  {question}
                  <ChevronDown size={20} className="shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-3 text-[var(--color-text-muted)] leading-relaxed">{answer}</p>
              </details>
            ))}
          </div>
          <div className="mt-12 flex justify-center">
            <StartButton label="Find keywords free" to={FINDER} />
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
