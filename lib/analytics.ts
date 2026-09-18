/**
 * Google Ads conversion tracking.
 *
 * Google Ads bids on conversions, not clicks, so it has to be told which visits
 * turned into something. Three moments are worth reporting, and they say
 * different things: a signup means the ad reached someone willing to make an
 * account, a first tailoring means they actually used it, and a payment is the
 * only one that pays for the click.
 *
 * All of it is dormant until the ids are set, so nothing loads and nothing is
 * sent for anyone until a campaign is actually running. Client-safe.
 */

/** The account's id from Google Ads, like "AW-123456789". */
export const GOOGLE_ADS_ID = (process.env.NEXT_PUBLIC_GOOGLE_ADS_ID ?? '').trim()

/**
 * The label Google Ads gives each conversion action, the part after the slash
 * in its snippet. One per action, so they can be counted and bid on separately.
 */
const LABELS = {
  signup: (process.env.NEXT_PUBLIC_ADS_SIGNUP_LABEL ?? '').trim(),
  tailoring: (process.env.NEXT_PUBLIC_ADS_TAILORING_LABEL ?? '').trim(),
  purchase: (process.env.NEXT_PUBLIC_ADS_PURCHASE_LABEL ?? '').trim(),
} as const

export type ConversionName = keyof typeof LABELS

export const adsConfigured = () => GOOGLE_ADS_ID.length > 0

type Gtag = (command: string, target: string, params?: Record<string, unknown>) => void

function gtag(): Gtag | null {
  if (typeof window === 'undefined') return null
  const fn = (window as unknown as { gtag?: Gtag }).gtag
  return typeof fn === 'function' ? fn : null
}

export interface ConversionDetail {
  /** What it was worth, for a payment. In rupees, not paise. */
  value?: number
  currency?: string
  /** The order or subscription id, so Google can drop duplicates if this fires twice. */
  id?: string
}

/**
 * Report one conversion. Does nothing at all when the campaign isn't set up, the
 * label is missing, or the tag was blocked — which is why a payment should never
 * depend on this having worked.
 */
export function reportConversion(name: ConversionName, detail: ConversionDetail = {}): void {
  const label = LABELS[name]
  const send = gtag()
  if (!GOOGLE_ADS_ID || !label || !send) return
  try {
    send('event', 'conversion', {
      send_to: `${GOOGLE_ADS_ID}/${label}`,
      ...(detail.value !== undefined ? { value: detail.value, currency: detail.currency ?? 'INR' } : {}),
      ...(detail.id ? { transaction_id: detail.id } : {}),
    })
  } catch {
    // Tracking must never break the thing it is tracking.
  }
}
