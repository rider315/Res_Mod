import Link from 'next/link'
import PolicyPage, { PolicySection } from '@/components/PolicyPage'
import { supportEmail } from '@/lib/contact'
import { getPlatformAi } from '@/lib/billing/platform-ai'
import { getProvider } from '@/lib/providers'

export const metadata = {
  title: 'Privacy Policy | Chills',
}

// The page names the provider Chills AI runs on, which the owner can change at any time.
export const dynamic = 'force-dynamic'

const LAST_UPDATED = '17 September 2026'

export default async function PrivacyPolicy() {
  const platform = await getPlatformAi()
  const platformProvider = platform ? getProvider(platform.provider).label : null

  return (
    <PolicyPage title="Privacy Policy" updated={LAST_UPDATED}>
      <PolicySection title="1. What this covers">
        <p>
          Chills is an online service that tailors resumes to job descriptions. This policy explains what Chills
          stores, why, who else handles it, and how you delete it. Questions, and any request about your own data,
          go to{' '}
          <a href={`mailto:${supportEmail()}`} className="text-[var(--color-primary)] hover:underline">
            {supportEmail()}
          </a>
          , also on the <Link href="/contact" className="text-[var(--color-primary)] hover:underline">Contact</Link>{' '}
          page.
        </p>
      </PolicySection>

      <PolicySection title="2. What we collect">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong className="text-[var(--color-text)]">Your Google sign-in.</strong> Your name, email address and
            Google account ID. Chills asks only for the <code>openid</code>, <code>email</code> and{' '}
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
            <strong className="text-[var(--color-text)]">Recruiter outreach.</strong> The recruiters you add (their name, email address, company and job
            title), the emails you write and send to them, the replies you paste in with what the AI made of them, and,
            if you leave open tracking on, when and how often each email was opened.
          </li>
          <li>
            <strong className="text-[var(--color-text)]">Your connected mailbox.</strong> If you connect one, its address, the mail server it uses and the
            app password you give. The app password is encrypted before it is stored, is never shown again, and is used
            only to send the emails you choose to send.
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
          Only to run Chills: to show and tailor your resumes, write and send the emails you ask for, count your
          usage, take payments and prevent abuse. Chills never emails anyone unless you press Send. Chills does not sell your data, show advertising, or use your resumes to train AI models.
        </p>
      </PolicySection>

      <PolicySection title="4. Who else handles it">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong className="text-[var(--color-text)]">An AI provider.</strong> Resume text and job descriptions
            go to the AI provider Chills AI runs on{platformProvider ? `, currently ${platformProvider}` : ''}, to
            import and tailor your resumes, find a job&apos;s keywords, write cover letters and recruiter emails, and
            read the recruiter replies you paste in. It handles that data under its own terms.
          </li>
          <li>
            <strong className="text-[var(--color-text)]">Your email provider</strong>, such as Google or Microsoft, sends the recruiter emails you send from
            your connected mailbox, with the resume you chose attached, under its own terms.
          </li>
          <li>
            <strong className="text-[var(--color-text)]">The recruiters you email</strong> receive what you send them. When open tracking is on, each email
            carries a tiny image; when a recipient&apos;s mail app loads it, Chills records that the email was opened
            and nothing else about the recipient. Some mail apps load images on their own, so an open is a hint rather
            than proof.
          </li>
          <li>
            <strong className="text-[var(--color-text)]">Razorpay</strong> processes payments. Your card, UPI or bank
            details go to Razorpay, never to Chills.
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
          Resumes, tailored copies, cover letters, recruiters and emails stay until you delete them, and a connected
          mailbox until you disconnect it. You can delete any of them at any time, or delete
          your whole account from Account in the dashboard.
        </p>
        <p>
          Deleting your account deletes your resumes, your tailoring history and cover letters, your recruiters,
          emails and replies, your connected mailbox, and your name and email, and forfeits unused credits. We keep payment records, which accounting requires, and your anonymous account ID with its
          usage counts, so that deleting an account cannot be used to get free tailorings again.
        </p>
      </PolicySection>

      <PolicySection title="6. The people you email">
        <p>
          You add recruiters&apos; contact details yourself and decide whom to email. Only add people you have a
          legitimate reason to contact about a job, and remove anyone who asks not to be contacted: in Chills,
          removing a recruiter deletes their details and the emails to them.
        </p>
      </PolicySection>

      <PolicySection title="7. Cookies and browser storage">
        <p>
          Chills sets a cookie to keep you signed in. Razorpay Checkout sets its own cookies when you pay. Chills
          uses no advertising or analytics cookies.
        </p>
      </PolicySection>

      <PolicySection title="8. Security">
        <p>
          Connections are encrypted with HTTPS, and every request for a resume or a tailored copy is checked against
          the account that is signed in, so no account can reach another&apos;s data. Mail is sent only over encrypted
          connections, and only to known email providers or to public mail servers you name.
        </p>
      </PolicySection>

      <PolicySection title="9. Changes to this policy">
        <p>When this policy changes, the date at the top changes with it.</p>
      </PolicySection>
    </PolicyPage>
  )
}
