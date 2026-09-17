import Link from 'next/link'
import PolicyPage, { PolicySection } from '@/components/PolicyPage'

export const metadata = {
  title: 'Cancellation and Refund Policy | Chills',
}

export default function Refunds() {
  return (
    <PolicyPage title="Cancellation and Refund Policy" updated="16 September 2026">
      <PolicySection title="Pro subscription">
        <ul className="list-disc pl-5 space-y-1">
          <li>You can cancel Pro at any time from Plans in your dashboard.</li>
          <li>After you cancel, Pro stays active, with its tailorings, until the end of the month you have paid for, and it does not renew.</li>
          <li>A payment for a month that has already started is not refunded.</li>
        </ul>
      </PolicySection>

      <PolicySection title="Credit packs">
        <ul className="list-disc pl-5 space-y-1">
          <li>A credit pack can be refunded within 7 days of purchase if none of its credits have been used.</li>
          <li>Credits do not expire, so unused credits are not refunded after that.</li>
        </ul>
      </PolicySection>

      <PolicySection title="Charges made in error">
        <p>If you are charged twice, or a payment does not add tailorings or Pro to your account, the payment is refunded in full.</p>
      </PolicySection>

      <PolicySection title="Failed tailorings">
        <p>A tailoring that fails without producing any changes is not counted, so there is nothing to refund.</p>
      </PolicySection>

      <PolicySection title="Deleting your account">
        <p>Deleting your account forfeits unused credits and ends Pro, without a refund for the current month.</p>
      </PolicySection>

      <PolicySection title="How to ask for a refund">
        <p>
          Write to the address on the <Link href="/contact" className="text-[var(--color-primary)] hover:underline">Contact</Link>{' '}
          page with the email address of your Chills account and the Razorpay payment ID from your receipt. Approved refunds
          go back to the original payment method through Razorpay, usually within 5–7 working days, depending on your bank.
        </p>
      </PolicySection>
    </PolicyPage>
  )
}
