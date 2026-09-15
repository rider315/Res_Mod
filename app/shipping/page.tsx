import Link from 'next/link'
import PolicyPage, { PolicySection } from '@/components/PolicyPage'

export const metadata = {
  title: 'Shipping and Delivery Policy | ResMod',
}

export default function Shipping() {
  return (
    <PolicyPage title="Shipping and Delivery Policy" updated="15 September 2026">
      <PolicySection title="Nothing is shipped">
        <p>ResMod is an online service. It sells no physical goods, so nothing is shipped and there are no delivery charges.</p>
      </PolicySection>

      <PolicySection title="Runs and Pro">
        <p>
          Credit packs and Pro are added to your ResMod account as soon as Razorpay confirms the payment, usually within a
          minute. If they have not appeared within an hour, write to the address on the{' '}
          <Link href="/contact" className="text-[var(--color-primary)] hover:underline">Contact</Link> page with the Razorpay
          payment ID, and they will be added or the payment refunded.
        </p>
      </PolicySection>

      <PolicySection title="Your tailored resumes">
        <p>
          Tailored resumes are delivered in the app, as PDF or LaTeX downloads or an Overleaf project, and are kept in your
          history so you can download them again.
        </p>
      </PolicySection>
    </PolicyPage>
  )
}
