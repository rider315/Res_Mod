import { lookup } from 'node:dns/promises'
import nodemailer from 'nodemailer'
import { isPublicAddress } from '@/lib/net/public-address'
import { MAIL_PROVIDERS, MailProviderId, SMTP_PORTS } from '@/lib/outreach/model'

// Re-exported: the mailbox checks were its first caller, and the tests reach it here.
export { isPublicAddress }

/**
 * Sending recruiter emails from the user's own mailbox, over SMTP. Server-only.
 *
 * Emails go out as the user, from their real address, so replies land in their
 * inbox and a copy sits in their Sent folder. The password is an app password
 * the user made for Chills; it is decrypted only here, for the length of one
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
    throw new MailboxError(`${host} isn’t a public mail server, so Chills can’t send through it.`, 'settings')
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
    return new MailboxError('Chills couldn’t connect to the mail server. Check the provider settings, then try again.', 'connection')
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
