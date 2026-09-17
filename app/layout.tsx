import type { Metadata } from 'next'
import { DM_Sans } from 'next/font/google'
import './globals.css'
import AuthProvider from '@/components/AuthProvider'

const sans = DM_Sans({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })

export const metadata: Metadata = {
  title: 'ResMod — Tailor your resume to every job',
  description:
    'Upload your resume in any format and tailor it to any job description, with every required ATS keyword covered and every change reviewed by you.',
  verification: {
    google: 'LPHid01QwGiUuOYs8wcALwDnimdPSWkz8fE6YuIajj8',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
