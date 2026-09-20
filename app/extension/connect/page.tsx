import type { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import SiteFooter from '@/components/brand/SiteFooter'
import SiteHeader from '@/components/brand/SiteHeader'
import { StartButton } from '@/components/brand/SignInButton'
import { allowedExtensionIds, connectTarget } from '@/lib/extension/connect'
import ConnectPanel from '@/components/extension/ConnectPanel'

/**
 * Where the browser extension is given a key to an account.
 *
 * The flow is Chrome's own: the extension opens this page through
 * `chrome.identity.launchWebAuthFlow`, the user signs in here if they are not
 * already, and the key is delivered to the extension's callback address. It is
 * never shown as a string to copy — a key on a clipboard is a key in a
 * screenshot, a chat window, and eventually a support thread.
 *
 * The address it will be sent to is checked before this page offers anything
 * (lib/extension/connect.ts). An unrecognised one gets an explanation and no
 * button, because that case is either a broken build or somebody phishing.
 */

export const metadata: Metadata = {
  title: 'Connect the Chills extension',
  description: 'Give the Chills browser extension access to your account.',
  robots: { index: false, follow: false },
}

interface PageProps {
  searchParams: { redirect_uri?: string; state?: string; label?: string }
}

export default async function ConnectPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions)
  const target = connectTarget(searchParams.redirect_uri, searchParams.state, allowedExtensionIds())

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-surface)] text-[var(--color-text)]">
      <SiteHeader />
      <main className="flex-1 px-4 sm:px-6 py-16">
        <div className="max-w-xl mx-auto">
          {!target ? (
            <div className="nb-card p-6 bg-[var(--color-surface)]">
              <h1 className="text-2xl font-black">This link doesn&apos;t come from the extension</h1>
              <p className="mt-3 text-[var(--color-text-muted)] leading-relaxed">
                Chills only hands an extension key to a Chrome extension&apos;s own callback address, and this link asks for it to be
                sent somewhere else. Nothing has been given out.
              </p>
              <p className="mt-3 text-[var(--color-text-muted)] leading-relaxed">
                Open the Chills extension and press <strong>Connect</strong> there instead. If you did press it there and still see
                this, the extension needs updating.
              </p>
            </div>
          ) : !session?.user?.email ? (
            <div className="nb-card p-6 bg-[var(--color-surface)]">
              <h1 className="text-2xl font-black">Sign in to connect the extension</h1>
              <p className="mt-3 text-[var(--color-text-muted)] leading-relaxed">
                The extension works on the account you sign in with. Sign in and this page will offer to connect it.
              </p>
              <div className="mt-6">
                <StartButton label="Sign in with Google" />
              </div>
            </div>
          ) : (
            <ConnectPanel
              email={session.user.email}
              extensionId={target.extensionId}
              redirectUri={target.redirectUri}
              state={target.state}
              label={(searchParams.label ?? '').slice(0, 80)}
            />
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
