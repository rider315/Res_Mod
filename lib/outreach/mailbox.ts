import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import nodemailer from 'nodemailer'
import { MAIL_PROVIDERS, MailProviderId, SMTP_PORTS } from '@/lib/outreach/model'

/**
 * Sending recruiter emails from the user's own mailbox, over SMTP. Server-only.
 *
 * Emails go out as the user, from their real address, so replies land in their
 * inbox and a copy sits in their Sent folder. The password is an app password
 * the user made for ResMod; it is decrypted only here, for the length of one
 * connection.
 *
 * The server only ever connects to a known provider, or to a custom server whose
 * every address is public, on a mail submission port, over TLS. So a mailbox
 * setting can't be used to make the server reach into a private network.
 * OUTREACH_SMTP_ALLOW_LOCAL=true lets a local, unencrypted stand-in be used by
 * the local checks, and is ignored in production.
 */

export interface SmtpTarget {
  /** What to connect to: a provider's host name, or a custom server's checked address. */
  connectHost: string
  port: number
  /** TLS from the first byte (port 465); otherwise STARTTLS is required. */
  secure: boolean
  /** The name the server's certificate must carry. */
  servername: string
  /** The local stand-in only: no TLS at all. */
  plain: boolean
}

/** A problem with the mailbox or the send, in words the user can act on. */
export class MailboxError extends Error {
  constructor(
    message: string,
    readonly kind: 'settings' | 'auth' | 'connection' | 'rejected'
  ) {
    super(message)
    this.name = 'MailboxError'
  }
}

const allowLocal = () => process.env.NODE_ENV !== 'production' && process.env.OUTREACH_SMTP_ALLOW_LOCAL === 'true'

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

function ipv4Parts(ip: string): number[] {
  return ip.split('.').map(Number)
}

/** Whether an IP address is on the public internet: not private, loopback, link-local, reserved or multicast. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) {
    const [a, b, c] = ipv4Parts(ip)
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false
    if (a === 100 && b >= 64 && b <= 127) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false
    if (a === 198 && (b === 18 || b === 19)) return false
    if (a === 198 && b === 51 && c === 100) return false
    if (a === 203 && b === 0 && c === 113) return false
    return true
  }
  if (family === 6) {
    const lower = ip.toLowerCase()
    const mapped = /^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower) ?? /^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
    if (mapped) return isPublicAddress(mapped[1])
    if (lower === '::' || lower === '::1') return false
    // Prefixes that carry an IPv4 address inside (NAT64, 6to4, Teredo) could hide a private one.
    if (lower.startsWith('64:ff9b:') || lower.startsWith('2002:') || /^2001:0*:/.test(lower)) return false
    const first = parseInt(lower.split(':')[0] || '0', 16)
    if ((first & 0xfe00) === 0xfc00) return false // unique local fc00::/7
    if ((first & 0xffc0) === 0xfe80) return false // link-local fe80::/10
    if ((first & 0xff00) === 0xff00) return false // multicast
    if (lower.startsWith('2001:db8:') || lower.startsWith('2001:0db8:')) return false // documentation
    if (lower.startsWith('::')) return false // other embedded or reserved forms
    return true
  }
  return false
}

/** Where to connect for a mailbox setting, after checking it is somewhere the server may connect to. */
export async function resolveSmtpTarget(setting: { provider: MailProviderId; host: string; port: number }): Promise<SmtpTarget> {
  if (setting.provider !== 'custom') {
    const preset = MAIL_PROVIDERS[setting.provider]
    return { connectHost: preset.host, port: preset.port, secure: preset.port === 465, servername: preset.host, plain: false }
  }

  const host = setting.host.trim().toLowerCase()
  if (allowLocal() && (host === 'localhost' || host === '127.0.0.1')) {
    return { connectHost: '127.0.0.1', port: setting.port, secure: false, servername: host, plain: true }
  }
  if (!HOSTNAME.test(host)) {
    throw new MailboxError('Enter the SMTP server as a name, such as smtp.example.com.', 'settings')
  }
  if (!(SMTP_PORTS as readonly number[]).includes(setting.port)) {
    throw new MailboxError(`Use port ${SMTP_PORTS.join(', ')}: those are the ports for sending mail securely.`, 'settings')
  }

  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(host, { all: true, verbatim: true })
  } catch {
    throw new MailboxError(`The server ${host} couldn’t be found. Check its name.`, 'settings')
  }
  if (addresses.length === 0 || !addresses.every(({ address }) => isPublicAddress(address))) {
    throw new MailboxError(`${host} isn’t a public mail server, so ResMod can’t send through it.`, 'settings')
  }
  // Connecting to the address just checked, so the name can't be pointed somewhere else in between.
  return { connectHost: addresses[0].address, port: setting.port, secure: setting.port === 465, servername: host, plain: false }
}

function transport(target: SmtpTarget, auth: { user: string; pass: string }) {
  return nodemailer.createTransport({
    host: target.connectHost,
    port: target.port,
    secure: target.secure,
    requireTLS: !target.secure && !target.plain,
    ignoreTLS: target.plain,
    servername: target.servername,
    tls: { servername: target.servername, minVersion: 'TLSv1.2' },
    auth,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    dnsTimeout: 10_000,
    // Messages are built from strings and buffers only; never let one read a file or fetch a URL.
    disableFileAccess: true,
    disableUrlAccess: true,
  })
}

interface SmtpFailure {
  code?: string
  responseCode?: number
  response?: string
  message?: string
}

/** A mail server's refusal, in words. The server's own first line is kept: it usually says what to fix. */
export function explainSmtpError(err: unknown): MailboxError {
  const failure = (err ?? {}) as SmtpFailure
  const code = failure.code ?? ''
  const status = failure.responseCode ?? 0
  const serverSays = (failure.response ?? '').split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 200)

  if (code === 'EAUTH' || status === 535 || status === 534) {
    return new MailboxError(
      'The mailbox refused the sign-in. Check the address, and use an app password rather than your normal password.',
      'auth'
    )
  }
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED', 'ECONNRESET', 'ETLS', 'EPROTOCOL'].includes(code)) {
    return new MailboxError('ResMod couldn’t connect to the mail server. Check the provider settings, then try again.', 'connection')
  }
  if (code === 'EENVELOPE' || (status >= 450 && status < 600)) {
    return new MailboxError(`The mail server didn’t accept the email${serverSays ? `: “${serverSays}”` : '.'}`, 'rejected')
  }
  return new MailboxError('The email couldn’t be sent just now. Try again in a moment.', 'connection')
}

export interface MailboxLogin {
  provider: MailProviderId
  host: string
  port: number
  address: string
  password: string
}

/** Sign in to the mailbox without sending anything. Throws a MailboxError saying what went wrong. */
export async function verifyMailbox(login: MailboxLogin): Promise<void> {
  const target = await resolveSmtpTarget(login)
  const mailer = transport(target, { user: login.address, pass: login.password })
  try {
    await mailer.verify()
  } catch (err) {
    throw explainSmtpError(err)
  } finally {
    mailer.close()
  }
}

export interface OutgoingEmail {
  fromName: string
  to: { name: string; address: string }
  subject: string
  text: string
  html: string
  attachment: { filename: string; content: Buffer } | null
  /** For a follow-up: the message it follows, so it lands in the same conversation. */
  inReplyTo: string | null
}

export async function sendFromMailbox(login: MailboxLogin, email: OutgoingEmail): Promise<{ messageId: string }> {
  const target = await resolveSmtpTarget(login)
  const mailer = transport(target, { user: login.address, pass: login.password })
  try {
    const info = await mailer.sendMail({
      // Structured addresses: nothing here is parsed out of a string a user typed.
      from: { name: email.fromName.replace(/[\r\n"<>]/g, ' ').trim().slice(0, 80), address: login.address },
      to: { name: email.to.name.replace(/[\r\n"<>]/g, ' ').trim().slice(0, 80), address: email.to.address },
      subject: email.subject.replace(/[\r\n]+/g, ' '),
      text: email.text,
      html: email.html,
      attachments: email.attachment
        ? [{ filename: email.attachment.filename, content: email.attachment.content, contentType: 'application/pdf' }]
        : [],
      ...(email.inReplyTo ? { inReplyTo: email.inReplyTo, references: [email.inReplyTo] } : {}),
    })
    return { messageId: String(info.messageId ?? '') }
  } catch (err) {
    throw explainSmtpError(err)
  } finally {
    mailer.close()
  }
}

// ─── The message ─────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/**
 * The HTML part: the plain text, escaped, with its paragraphs kept and its web
 * addresses made clickable, and the open-tracking image when there is one.
 */
export function emailHtml(body: string, trackingUrl: string | null): string {
  const paragraphs = body
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => escapeHtml(block.trim()))
    .filter(Boolean)
    .map((block) => block.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (url) => `<a href="${url}">${url}</a>`).replace(/\n/g, '<br>'))
    .map((block) => `<p style="margin:0 0 14px 0">${block}</p>`)
    .join('')
  const pixel = trackingUrl
    ? `<img src="${escapeHtml(trackingUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">`
    : ''
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#111111">${paragraphs}${pixel}</div>`
}
