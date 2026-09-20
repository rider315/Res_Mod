import Link from 'next/link'
import PolicyPage from '@/components/PolicyPage'
import { supportEmail } from '@/lib/contact'

export const metadata = {
  title: 'Contact | Chills',
}

/** CONTACT_EMAIL overrides it; see lib/contact.ts for why there is a default. */
export default function Contact() {
  const email = supportEmail()

  return (
    <PolicyPage title="Contact" intro="Questions about Chills, a payment, a refund or your data? Get in touch.">
      <div className="space-y-4">
        <p>For questions about Chills, a payment, a refund or your data, email:</p>
        <p>
          <a href={`mailto:${email}`} className="text-lg font-semibold text-[var(--color-primary)] hover:underline">
            {email}
          </a>
        </p>
        <p>
          About a payment, include the email address of your Chills account and the Razorpay payment ID from your
          receipt, so it can be found quickly.
        </p>
        <p>
          See also the <Link href="/privacy" className="text-[var(--color-primary)] hover:underline">Privacy Policy</Link>{' '}
          and the <Link href="/terms" className="text-[var(--color-primary)] hover:underline">Terms of Service</Link>.
        </p>
      </div>
    </PolicyPage>
  )
}
