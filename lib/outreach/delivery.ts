import { createHash, randomBytes } from 'node:crypto'
import { compileLatexToPdf } from '@/lib/latex/compile'
import { sanitizeFileName } from '@/lib/resume-filename'

/**
 * What goes out with a recruiter email besides its text: the resume as a PDF,
 * and the image that tells Chills the email was opened. Server-only.
 */

/** Built PDFs, by the LaTeX they came from, so a batch of emails with one resume builds it once. */
const pdfCache = new Map<string, Buffer>()
const PDF_CACHE_SIZE = 8

/** The PDF of a resume's LaTeX, built by the same service as downloads (lib/latex/compile.ts). */
export async function resumePdf(latex: string): Promise<Buffer> {
  const key = createHash('sha256').update(latex).digest('hex')
  const cached = pdfCache.get(key)
  if (cached) {
    pdfCache.delete(key)
    pdfCache.set(key, cached)
    return cached
  }
  const result = await compileLatexToPdf(latex)
  if (!result.ok) {
    console.error('[outreach] resume PDF failed to build:', result.log.slice(0, 300))
    throw new Error('Your resume PDF couldn’t be built just now, so nothing was sent. Try again in a moment.')
  }
  pdfCache.set(key, result.pdf)
  if (pdfCache.size > PDF_CACHE_SIZE) pdfCache.delete(pdfCache.keys().next().value as string)
  return result.pdf
}

/** "Riya Patel Resume.pdf". */
export function attachmentName(candidateName: string): string {
  return `${sanitizeFileName(candidateName) || 'My'} Resume.pdf`
}

/** An unguessable id for one email's open-tracking image. */
export function newTrackingToken(): string {
  return randomBytes(24).toString('base64url')
}

/**
 * The public address of this deployment, for links inside emails: APP_URL when
 * set, else Vercel's production address, else the address the request came in
 * on. Only https is used in production, so a recipient's mail app never loads
 * an insecure image; running locally, the local address is fine for the checks.
 */
export function publicOrigin(requestUrl: string): string | null {
  const vercel =
    process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : ''
  const candidate = process.env.APP_URL?.trim() || vercel || requestUrl
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  if (url.protocol === 'https:') return url.origin
  return process.env.NODE_ENV === 'production' ? null : url.origin
}

export function trackingUrl(origin: string, token: string): string {
  return `${origin}/api/outreach/open/${token}`
}
