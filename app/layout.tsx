import type { Metadata } from 'next'
import { DM_Sans } from 'next/font/google'
import './globals.css'
import AuthProvider from '@/components/AuthProvider'
import Analytics from '@/components/Analytics'
import ConfirmProvider from '@/components/ConfirmProvider'
import { siteUrl } from '@/lib/seo'

const sans = DM_Sans({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: 'Chills — Tailor your resume and email the recruiter',
  description:
    'Tailor your resume to any job, with every required ATS keyword covered and every change approved by you, then email the recruiter with it attached.',
  applicationName: 'Chills',
  // './' resolves against each page's own path, so every page declares itself
  // the original. A page that needs a different one still sets its own.
  alternates: { canonical: './' },
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
