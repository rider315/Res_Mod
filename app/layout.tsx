import type { Metadata } from 'next'
import './globals.css'
import AuthProvider from '@/components/AuthProvider'

export const metadata: Metadata = {
  title: 'ResMod — AI Resume Optimizer',
  description: 'Optimize your resume for any job description using Google Docs and Gemini AI — with full control over every change.',
  verification: {
    google: 'LPHid01QwGiUuOYs8wcALwDnimdPSWkz8fE6YuIajj8',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}