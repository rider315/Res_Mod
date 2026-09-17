import Link from 'next/link'
import PolicyPage, { PolicySection } from '@/components/PolicyPage'
import { getPlatformAi } from '@/lib/billing/platform-ai'
import { getProvider } from '@/lib/providers'

export const metadata = {
  title: 'Privacy Policy | ResMod',
}

// The page names the provider ResMod AI runs on, which the owner can change at any time.
export const dynamic = 'force-dynamic'

const LAST_UPDATED = '17 September 2026'

export default async function PrivacyPolicy() {
  const platform = await getPlatformAi()
  const platformProvider = platform ? getProvider(platform.provider).label : null

  return (
    <PolicyPage title="Privacy Policy" updated={LAST_UPDATED}>
      <PolicySection title="1. What this covers">
        <p>
          ResMod is an online service that tailors resumes to job descriptions. This policy explains what ResMod
          stores, why, who else handles it, and how you delete it. Questions go to the address on the{' '}
          <Link href="/contact" className="text-[var(--color-primary)] hover:underline">Contact</Link> page.
        </p>
      </PolicySection>

      <PolicySection title="2. What we collect">
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
            keep the tailored copy with its job description, the changes you approved and its keyword score, and any
            cover letters you write for it, so you can download them again. Your latest 50 are kept.
          </li>
          <li>
            <strong className="text-[var(--color-text)]">Keyword finder checks.</strong> A job description you paste
            into the keyword finder is used to find its keywords and is not saved.
          </li>
          <li>
            <strong className="text-[var(--color-text)]">Usage and payments.</strong> How many tailorings and imports you
            have used, your credits and plan, and for each payment the Razorpay order, payment or subscription ID,
            amount and status.
          </li>
        </ul>
      </PolicySection>

      <PolicySection title="3. How we use it">
        <p>
          Only to run ResMod: to show and tailor your resumes, count your tailorings, take payments and prevent
          abuse. ResMod does not sell your data, show advertising, or use your resumes to train AI models.
        </p>
      </PolicySection>

      <PolicySection title="4. Who else handles it">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong className="text-[var(--color-text)]">An AI provider.</strong> Resume text and job descriptions
            go to the AI provider ResMod AI runs on{platformProvider ? `, currently ${platformProvider}` : ''}, to
            import and tailor your resumes, find a job&apos;s keywords and write cover letters. It handles that data
            under its own terms.
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
            <strong className="text-[var(--color-text)]">texlive.net and Overleaf</strong> receive a resume or cover
            letter only when you download it as a PDF or open it in Overleaf.
          </li>
          <li>
            <strong className="text-[var(--color-text)]">Google</strong> handles sign-in.
          </li>
        </ul>
      </PolicySection>

      <PolicySection title="5. How long we keep it, and deleting it">
        <p>
          Resumes, tailored copies and their cover letters stay until you delete them. You can delete any of them at any time, or delete
          your whole account from Account in the dashboard.
        </p>
        <p>
          Deleting your account deletes your resumes, your tailoring history and cover letters, and your name and
          email, and forfeits unused credits. We keep payment records, which accounting requires, and your anonymous account ID with its
          usage counts, so that deleting an account cannot be used to get free tailorings again.
        </p>
      </PolicySection>

      <PolicySection title="6. Cookies and browser storage">
        <p>
          ResMod sets a cookie to keep you signed in. Razorpay Checkout sets its own cookies when you pay. ResMod
          uses no advertising or analytics cookies.
        </p>
      </PolicySection>

      <PolicySection title="7. Security">
        <p>
          Connections are encrypted with HTTPS, and every request for a resume or a tailored copy is checked against
          the account that is signed in, so no account can reach another&apos;s data.
        </p>
      </PolicySection>

      <PolicySection title="8. Changes to this policy">
        <p>When this policy changes, the date at the top changes with it.</p>
      </PolicySection>
    </PolicyPage>
  )
}
