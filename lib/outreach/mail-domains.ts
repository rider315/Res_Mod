/**
 * What an email address's domain says: a throwaway service, a mistyped big
 * provider, a free provider anyone can sign up to, or, failing all three, most
 * likely the recruiter's employer.
 *
 * Client-safe, so the composer can tell up front whether there is a company
 * website to read. lib/outreach/email-check.ts uses the same lists when an
 * address is added.
 */

export const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', '10minutemail.com',
  '10minutemail.net', 'tempmail.com', 'temp-mail.org', 'throwawaymail.com', 'yopmail.com', 'getnada.com',
  'trashmail.com', 'maildrop.cc', 'mailnesia.com', 'dispostable.com', 'fakeinbox.com', 'mintemail.com',
  'mohmal.com', 'tempinbox.com', 'spamgourmet.com', 'mailcatch.com', 'tempmailo.com', 'emailondeck.com',
  'mail-temp.com', 'discard.email', 'spam4.me', 'grr.la', 'guerrillamailblock.com', 'inboxkitten.com',
  'nada.email', 'tmpmail.org', 'moakt.com', 'fakemail.net', 'burnermail.io', 'mailsac.com', 'tempr.email',
])

/**
 * Providers anyone can get an address at. They certainly take mail, and an
 * address there says nothing about who the recruiter works for.
 */
export const FREE_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'ymail.com', 'rocketmail.com', 'hotmail.com',
  'hotmail.co.in', 'outlook.com', 'outlook.in', 'live.com', 'live.in', 'msn.com', 'icloud.com', 'me.com',
  'mac.com', 'aol.com', 'protonmail.com', 'proton.me', 'pm.me', 'zoho.com', 'zohomail.in', 'rediffmail.com',
  'gmx.com', 'gmx.net', 'mail.com', 'yandex.com', 'tutanota.com', 'fastmail.com', 'hey.com',
])

/** Well-known misspellings of the big providers, and what was meant. */
export const TYPOS: Record<string, string> = {
  'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com', 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com',
  'gmaill.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.om': 'gmail.com',
  'gmail.comm': 'gmail.com', 'yahoo.con': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com',
  'hotmail.con': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com',
  'outlook.con': 'outlook.com', 'outlok.com': 'outlook.com', 'iclould.com': 'icloud.com', 'icloud.con': 'icloud.com',
}

/**
 * The domain of the recruiter's employer, read from their address: the part
 * after the @, unless it belongs to a free, throwaway or mistyped provider.
 * Null when the address can't say.
 */
export function employerDomain(email: string): string | null {
  const domain = String(email ?? '').trim().toLowerCase().split('@')[1] ?? ''
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return null
  if (FREE_PROVIDERS.has(domain) || DISPOSABLE.has(domain) || TYPOS[domain]) return null
  return domain
}
