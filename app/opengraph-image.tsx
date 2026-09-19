import { ImageResponse } from 'next/og'
import { OgCard, OG_SIZE } from '@/components/brand/og'

/** The card every Chills link falls back to, and the one the home page uses. */
export const alt = 'Chills — tailor your resume and email the recruiter'
export const size = OG_SIZE
export const contentType = 'image/png'

export default async function Image() {
  return new ImageResponse(
    (
      <OgCard
        title="Tailor your resume. Email the recruiter."
        highlight="resume."
        lines={['Every ATS keyword covered', 'Sent from your own mailbox', '3 free to start']}
      />
    ),
    size
  )
}
