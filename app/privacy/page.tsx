import Link from 'next/link'
import { getPlatformAi } from '@/lib/billing/platform-ai'
import { getProvider } from '@/lib/providers'

export const metadata = {
  title: 'Privacy Policy | ResMod',
}

// The page names the provider ResMod AI runs on, which the owner can change at any time.
export const dynamic = 'force-dynamic'

const LAST_UPDATED = '16 September 2026'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-[var(--color-text)]">{title}</h2>
      {children}
    </section>
  )
}

export default async function PrivacyPolicy() {
  const platform = await getPlatformAi()
  const platformProvider = platform ? getProvider(platform.provider).label : null

  return (
    <div className="min-h-screen bg-[var(--color-bg)] py-12 px-6">
      <div className="max-w-3xl mx-auto space-y-8 text-[var(--color-text)]">
        <div className="space-y-2">
          <Link href="/" className="text-[var(--color-primary)] hover:underline text-sm font-medium">← Back to home</Link>
          <h1 className="text-3xl font-bold">Privacy Policy</h1>
          <p className="text-[var(--color-text-muted)]">Last updated: {LAST_UPDATED}</p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-[var(--color-text-muted)]">
          <Section title="1. What this covers">
            <p>
              ResMod is an online service that tailors resumes to job descriptions. This policy explains what ResMod
              stores, why, who else handles it, and how you delete it. Questions go to the address on the{' '}
              <Link href="/contact" className="text-[var(--color-primary)] hover:underline">Contact</Link> page.
            </p>
          </Section>

          <Section title="2. What we collect">
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="text-[var(--color-text)]">Your Google sign-in.</strong> Your name, email address and
                Google account ID. ResMod asks only for the <code>openid</code>, <code>email</code> and{' '}
                <code>profile</code> scopes, so it cannot see your Google Drive, Docs, Gmail or anything else in your
                Google account.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Your resumes.</strong> A file you import is read on our
                server to extract its text, and the file itself is not kept. We store the resume you save: the text in
                its fields and the LaTeX generated from it.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Your tailoring history.</strong> When you apply changes, we
                keep the tailored copy with its job description, the changes you approved and its keyword score, so you
                can download it again. Your latest 50 are kept.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Usage and payments.</strong> How many tailorings and imports you
                have used, your credits and plan, and for each payment the Razorpay order, payment or subscription ID,
                amount and status.
              </li>
            </ul>
          </Section>

          <Section title="3. How we use it">
            <p>
              Only to run ResMod: to show and tailor your resumes, count your tailorings, take payments and prevent
              abuse. ResMod does not sell your data, show advertising, or use your resumes to train AI models.
            </p>
          </Section>

          <Section title="4. Who else handles it">
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="text-[var(--color-text)]">An AI provider.</strong> Resume text and job descriptions
                go to the AI provider ResMod AI runs on{platformProvider ? `, currently ${platformProvider}` : ''}, to
                import and tailor your resumes. It handles that data under its own terms.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Razorpay</strong> processes payments. Your card, UPI or bank
                details go to Razorpay, never to ResMod.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Vercel</strong> hosts the app and{' '}
                <strong className="text-[var(--color-text)]">Neon</strong> hosts its database, in Singapore.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">texlive.net and Overleaf</strong> receive a resume only
                when you click Download PDF or Open in Overleaf.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Google</strong> handles sign-in.
              </li>
            </ul>
          </Section>

          <Section title="5. How long we keep it, and deleting it">
            <p>
              Resumes and tailored copies stay until you delete them. You can delete any of them at any time, or delete
              your whole account from Account in the dashboard.
            </p>
            <p>
              Deleting your account deletes your resumes, your tailoring history, and your name and email, and forfeits
              unused credits. We keep payment records, which accounting requires, and your anonymous account ID with its
              usage counts, so that deleting an account cannot be used to get free tailorings again.
            </p>
          </Section>

          <Section title="6. Cookies and browser storage">
            <p>
              ResMod sets a cookie to keep you signed in. Razorpay Checkout sets its own cookies when you pay. ResMod
              uses no advertising or analytics cookies.
            </p>
          </Section>

          <Section title="7. Security">
            <p>
              Connections are encrypted with HTTPS, and every request for a resume or a tailored copy is checked against
              the account that is signed in, so no account can reach another&apos;s data.
            </p>
          </Section>

          <Section title="8. Changes to this policy">
            <p>When this policy changes, the date at the top changes with it.</p>
          </Section>
        </div>
      </div>
    </div>
  )
}
