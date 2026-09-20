/**
 * The address people write to.
 *
 * It used to be published only when CONTACT_EMAIL was set, so that a page could
 * never print an address nobody was reading. There is a real one now, and the
 * cost of that caution had flipped: a site that takes payments and holds
 * people's résumés must always show somewhere to write, and a policy page
 * saying the address "has not been published yet" is worse than one that is a
 * deploy out of date.
 *
 * So the address is the default and the variable is the override — for a
 * preview deployment, or the day the address changes and the code has not
 * caught up.
 *
 * Client-safe: no imports, no database. NEXT_PUBLIC_ is deliberately not used;
 * every page that shows this renders on the server.
 */

export const DEFAULT_SUPPORT_EMAIL = 'support@chills.pro'

export function supportEmail(raw: string | undefined = process.env.CONTACT_EMAIL): string {
  const chosen = (raw ?? '').trim()
  // A value that isn't an address is a misconfiguration, not an instruction to
  // publish nonsense on the privacy policy.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(chosen) ? chosen : DEFAULT_SUPPORT_EMAIL
}
