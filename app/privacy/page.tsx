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
            </ul>
            <p>
              That is the full extent of it. ResMod requests only the <code>openid</code>, <code>email</code> and{' '}
              <code>profile</code> scopes — it does <strong>not</strong> request or receive access to your Google
              Drive, Google Docs, or any other Google service. Your resume is a LaTeX file stored with the
              application itself, not in your Google account.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-[var(--color-text)]">2. How We Use Your Data</h2>
            <p>We use your data solely to provide the ResMod service:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>To read the LaTeX resume file you selected and split it into sections.</li>
              <li>To send those sections, with your job description, to your chosen AI provider for optimization.</li>
              <li>To write the changes you approve into a tailored copy of the LaTeX, which you then download.</li>
            </ul>
            <p><strong>We do not modify your original resume file.</strong> The <code>.tex</code> source is read only; every optimization produces a separate copy.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-[var(--color-text)]">3. Data Storage and Retention</h2>
            <p>ResMod operates entirely as a pass-through service. We do not store your resume data, job descriptions, or AI outputs on our servers. The optimized resume exists only in your browser until you download it.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-[var(--color-text)]">4. Third-Party Sharing</h2>
            <p>We share your resume content and job descriptions with the AI provider you select in Settings, solely for the purpose of generating resume optimizations.</p>
            <p>
              Separately, the optional <strong>Compile PDF</strong> and <strong>Open in Overleaf</strong> buttons
              send your resume to an external LaTeX typesetting service (texlive.net and overleaf.com respectively).
              Neither runs unless you click it, and downloading the <code>.tex</code> file instead keeps the document
              on your own machine. We do not sell or share your data with any other third parties.
            </p>
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
