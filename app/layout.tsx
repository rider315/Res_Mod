import type { Metadata } from 'next'
import { DM_Sans } from 'next/font/google'
import './globals.css'
import AuthProvider from '@/components/AuthProvider'
import Analytics from '@/components/Analytics'
import ConfirmProvider from '@/components/ConfirmProvider'

const sans = DM_Sans({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })

/** Where the site lives, so a shared link's picture has a full address: APP_URL when set, else the production domain. */
function siteUrl(): URL {
  try {
    return new URL(process.env.APP_URL?.trim() || 'https://chills.pro')
  } catch {
    return new URL('https://chills.pro')
  }
}

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: 'Chills — Tailor your resume and email the recruiter',
  description:
    'Tailor your resume to any job, with every required ATS keyword covered and every change approved by you, then email the recruiter with it attached.',
  applicationName: 'Chills',
  // The picture comes from app/opengraph-image.tsx. Titles and descriptions stay each page's
  // own: WhatsApp, LinkedIn and X read those when a page sets no og: ones.
  openGraph: { type: 'website', siteName: 'Chills', locale: 'en_IN' },
  twitter: { card: 'summary_large_image' },
  verification: {
    google: 'LPHid01QwGiUuOYs8wcALwDnimdPSWkz8fE6YuIajj8',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body>
        <AuthProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </AuthProvider>
        <Analytics />
      </body>
    </html>
  )
}
