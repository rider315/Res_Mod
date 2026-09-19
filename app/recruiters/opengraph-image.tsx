import { ImageResponse } from 'next/og'
import { OgCard, OG_SIZE } from '@/components/brand/og'
import { LIMITS } from '@/lib/outreach/model'

/**
 * The recruiter list has its own card, because it is the link that gets shared:
 * a post about "this week's hiring contacts" shouldn't preview as a résumé tool.
 */
export const alt = 'Chills — a fresh list of recruiters every week'
export const size = OG_SIZE
export const contentType = 'image/png'

export default async function Image() {
  return new ImageResponse(
    (
      <OgCard
        chip="New every week"
        title="A fresh list of recruiters every week"
        highlight="recruiters"
        lines={[`Take up to ${LIMITS.directoryPerWeek} a week`, 'Checked before it goes up', 'Each email written for you']}
      />
    ),
    size
  )
}
