import Link from 'next/link'

export const metadata = {
  title: 'Contact | ResMod',
}

/** The contact address comes from CONTACT_EMAIL, so no address is published until one is chosen. */
export default function Contact() {
  const email = process.env.CONTACT_EMAIL?.trim()

  return (
    <div className="min-h-screen bg-[var(--color-bg)] py-12 px-6">
      <div className="max-w-3xl mx-auto space-y-8 text-[var(--color-text)]">
        <div className="space-y-2">
          <Link href="/" className="text-[var(--color-primary)] hover:underline text-sm font-medium">← Back to home</Link>
          <h1 className="text-3xl font-bold">Contact</h1>
        </div>

        <div className="space-y-4 text-sm leading-relaxed text-[var(--color-text-muted)]">
          <p>For questions about ResMod, a payment, a refund or your data, email:</p>
          {email ? (
            <p>
              <a href={`mailto:${email}`} className="text-lg font-semibold text-[var(--color-primary)] hover:underline">
                {email}
              </a>
            </p>
          ) : (
            <p className="text-[var(--color-text)]">The contact address has not been published yet.</p>
          )}
          <p>
            About a payment, include the email address of your ResMod account and the Razorpay payment ID from your
            receipt, so it can be found quickly.
          </p>
          <p>
            See also the <Link href="/privacy" className="text-[var(--color-primary)] hover:underline">Privacy Policy</Link>{' '}
            and the <Link href="/terms" className="text-[var(--color-primary)] hover:underline">Terms of Service</Link>.
          </p>
        </div>
      </div>
    </div>
  )
}
