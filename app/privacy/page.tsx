import Link from 'next/link'

export const metadata = {
  title: 'Privacy Policy | ResMod',
}

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] py-12 px-6">
      <div className="max-w-3xl mx-auto space-y-8 text-[var(--color-text)]">
        <div className="space-y-2">
          <Link href="/" className="text-[var(--color-primary)] hover:underline text-sm font-medium">← Back to home</Link>
          <h1 className="text-3xl font-bold">Privacy Policy</h1>
          <p className="text-[var(--color-text-muted)]">Last updated: {new Date().toLocaleDateString()}</p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-[var(--color-text-muted)]">
          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-[var(--color-text)]">1. Information We Collect</h2>
            <p>ResMod uses Google OAuth to authenticate users. When you sign in, we access:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Your basic profile information (name and email address).</li>
              <li>Your Google Drive and Google Docs files, specifically the resume documents you choose to optimize.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-[var(--color-text)]">2. How We Use Your Data</h2>
            <p>We use your data solely to provide the ResMod service:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>To create a copy of your selected Google Doc resume.</li>
              <li>To read the contents of the copied resume for AI optimization via Google Gemini.</li>
              <li>To write the proposed AI optimizations back to the copied document.</li>
            </ul>
            <p><strong>We do not modify your original documents.</strong> All modifications are made to a newly created copy.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-[var(--color-text)]">3. Data Storage and Retention</h2>
            <p>ResMod operates entirely as a pass-through service. We do not store your resume data, job descriptions, or AI outputs on our servers. Your documents remain securely in your Google Drive account.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-[var(--color-text)]">4. Third-Party Sharing</h2>
            <p>We share your resume content and job descriptions with Google Gemini API solely for the purpose of generating resume optimizations. We do not sell or share your data with any other third parties.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-[var(--color-text)]">5. Your Rights</h2>
            <p>You can revoke ResMod&apos;s access to your Google account at any time by visiting your Google Account security settings.</p>
          </section>
        </div>
      </div>
    </div>
  )
}
