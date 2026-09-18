'use client'
import Script from 'next/script'
import { GOOGLE_ADS_ID } from '@/lib/analytics'

/**
 * Google's tag, loaded only when a campaign is running.
 *
 * Without NEXT_PUBLIC_GOOGLE_ADS_ID this renders nothing, so no third-party
 * script reaches anyone's browser until there is a campaign to measure. It
 * loads after the page is interactive, so it can't slow the first paint.
 *
 * conversion_linker is what stores the click id Google sends people in with; a
 * conversion reported later can't be matched to its ad without it.
 */
export default function Analytics() {
  if (!GOOGLE_ADS_ID) return null
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`} strategy="afterInteractive" />
      <Script id="google-ads-tag" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GOOGLE_ADS_ID}', { conversion_linker: true });`}
      </Script>
    </>
  )
}
