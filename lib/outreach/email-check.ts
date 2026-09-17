import { promises as dns } from 'node:dns'

/**
 * Checking recruiter addresses before they are saved, so a mistyped or made-up
 * address never reaches the AI or a mailbox. Server-only.
 *
 * From cheapest to dearest, stopping at the first failure:
 *   1. format    — a practical RFC 5321 shape
 *   2. typo      — well-known misspellings of the big providers (gmail.con)
 *   3. throwaway — known disposable-address domains
 *   4. mail      — the domain has MX records, or an A/AAAA record to fall back on
 *
 * DNS answers are cached per domain, so a list of 500 people at one company
 * looks it up once. A DNS error other than "no such domain" lets the address
 * through: a slow resolver shouldn't reject a real recruiter. There is no
 * SMTP probing: it is slow, often blocked, and gets servers blacklisted.
 *
 * EMAIL_VALIDATION_MX=false skips the DNS step, for working offline.
 */

export const REJECTIONS = {
  empty: 'No email address was given.',
  invalid_format: 'This isn’t a valid email address.',
  likely_typo: 'The domain looks mistyped.',
  disposable: 'This is a throwaway address.',
  invalid_domain: 'This domain can’t receive email.',
} as const

export type RejectionReason = keyof typeof REJECTIONS

export type EmailCheck =
  | { valid: true; email: string }
  | { valid: false; email: string; reason: RejectionReason; message: string; suggestion?: string }

const DNS_TIMEOUT_MS = 4000
const DNS_CACHE_MS = 6 * 60 * 60 * 1000
const CONCURRENCY = 12

const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', '10minutemail.com',
  '10minutemail.net', 'tempmail.com', 'temp-mail.org', 'throwawaymail.com', 'yopmail.com', 'getnada.com',
  'trashmail.com', 'maildrop.cc', 'mailnesia.com', 'dispostable.com', 'fakeinbox.com', 'mintemail.com',
  'mohmal.com', 'tempinbox.com', 'spamgourmet.com', 'mailcatch.com', 'tempmailo.com', 'emailondeck.com',
  'mail-temp.com', 'discard.email', 'spam4.me', 'grr.la', 'guerrillamailblock.com', 'inboxkitten.com',
  'nada.email', 'tmpmail.org', 'moakt.com', 'fakemail.net', 'burnermail.io', 'mailsac.com', 'tempr.email',
])

/** Providers that certainly take mail; their misspellings are caught separately. */
const KNOWN_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'hotmail.com', 'outlook.com', 'live.com',
  'icloud.com', 'aol.com', 'protonmail.com', 'proton.me', 'zoho.com', 'rediffmail.com',
])

const TYPOS: Record<string, string> = {
  'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com', 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com',
  'gmaill.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.om': 'gmail.com',
  'gmail.comm': 'gmail.com', 'yahoo.con': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com',
  'hotmail.con': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com',
  'outlook.con': 'outlook.com', 'outlok.com': 'outlook.com', 'iclould.com': 'icloud.com', 'icloud.con': 'icloud.com',
}

const EMAIL_FORMAT =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

/** The format check alone, with no network: for the browser's first look and for the tests. */
export function hasEmailFormat(email: string): boolean {
  const value = email.trim().toLowerCase()
  const local = value.slice(0, value.lastIndexOf('@'))
  return value.length <= 254 && local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..') && EMAIL_FORMAT.test(value)
}

const dnsCache = new Map<string, { deliverable: boolean; expires: number }>()

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('dns_timeout')), DNS_TIMEOUT_MS)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function hasAddressRecord(domain: string): Promise<boolean> {
  for (const lookup of [() => dns.resolve4(domain), () => dns.resolve6(domain)]) {
    try {
      if ((await withTimeout(lookup())).length > 0) return true
    } catch {
      // try the next record type
    }
  }
  return false
}

/** "yes", "no", or "unknown" when DNS itself failed. */
async function domainTakesMail(domain: string): Promise<'yes' | 'no' | 'unknown'> {
  const cached = dnsCache.get(domain)
  if (cached && cached.expires > Date.now()) return cached.deliverable ? 'yes' : 'no'

  let answer: 'yes' | 'no' | 'unknown'
  try {
    const records = await withTimeout(dns.resolveMx(domain))
    // A "null MX" (RFC 7505: one record pointing at ".") says the domain takes no mail at all.
    const servers = records.filter((record) => record.exchange && record.exchange !== '.')
    answer = servers.length > 0 ? 'yes' : records.length > 0 ? 'no' : (await hasAddressRecord(domain)) ? 'yes' : 'no'
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    answer = code === 'ENOTFOUND' || code === 'ENODATA' ? ((await hasAddressRecord(domain)) ? 'yes' : 'no') : 'unknown'
  }
  if (answer !== 'unknown') dnsCache.set(domain, { deliverable: answer === 'yes', expires: Date.now() + DNS_CACHE_MS })
  return answer
}

function reject(email: string, reason: RejectionReason, suggestion?: string): EmailCheck {
  return { valid: false, email, reason, message: REJECTIONS[reason], ...(suggestion ? { suggestion } : {}) }
}

export async function checkEmail(raw: string, { lookUpDomain = process.env.EMAIL_VALIDATION_MX !== 'false' } = {}): Promise<EmailCheck> {
  const email = String(raw ?? '').trim().toLowerCase()
  if (!email) return reject(email, 'empty')
  if (!hasEmailFormat(email)) return reject(email, 'invalid_format')

  const at = email.lastIndexOf('@')
  const domain = email.slice(at + 1)
  if (TYPOS[domain]) return reject(email, 'likely_typo', `${email.slice(0, at + 1)}${TYPOS[domain]}`)
  if (DISPOSABLE.has(domain)) return reject(email, 'disposable')
  if (lookUpDomain && !KNOWN_PROVIDERS.has(domain) && (await domainTakesMail(domain)) === 'no') {
    return reject(email, 'invalid_domain')
  }
  return { valid: true, email }
}

/** Check many addresses a few at a time, keeping their order. */
export async function checkEmails(emails: string[], options?: { lookUpDomain?: boolean }): Promise<EmailCheck[]> {
  const results = new Array<EmailCheck>(emails.length)
  let next = 0
  const worker = async () => {
    while (next < emails.length) {
      const index = next++
      results[index] = await checkEmail(emails[index], options)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, emails.length) }, worker))
  return results
}
