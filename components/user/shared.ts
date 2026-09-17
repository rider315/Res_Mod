import { sanitizeFileName } from '@/lib/resume-filename'

/** Pieces shared by the regular-user screens. */

export interface ResumeSummary {
  id: string
  title: string
  sourceFormat: string
  updatedAt: string
}

/** The main action on a screen: blue, outlined, with a hard shadow. */
export const primaryButton = 'nb-btn nb-btn-primary py-2.5 px-5 text-sm'

/** A positive action that isn't the main one, such as approving. */
export const accentButton = 'nb-btn nb-btn-accent py-2.5 px-5 text-sm'

export const secondaryButton = 'nb-btn nb-btn-sm py-2 px-3.5 text-sm'

export const dangerButton = 'nb-btn nb-btn-sm nb-btn-danger py-2 px-3.5 text-sm'

/** A text link styled as a small underlined action. */
export const linkButton =
  'text-sm font-bold underline underline-offset-4 decoration-2 hover:text-[var(--color-primary)] disabled:opacity-50 transition-colors'

export const inputClass = 'nb-input text-sm'

export const cardClass = 'nb-card rounded-[10px]'

export const errorBox =
  'rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-error-highlight)] p-3 text-sm font-medium text-[var(--color-error)] whitespace-pre-wrap'

export const successBox =
  'rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-success-highlight)] p-3 text-sm font-medium text-[var(--color-text)]'

export const warningBox =
  'rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-yellow-soft)] p-3 text-sm font-medium text-[var(--color-text)]'

/** The fill for a keyword match score: green when strong, yellow when fair, red when weak. */
export function scoreFill(score: number): string {
  return score >= 80 ? 'bg-[var(--color-accent)]' : score >= 50 ? 'bg-[var(--color-yellow)]' : 'bg-[var(--color-error-highlight)]'
}

/** The back link at the top of a screen. */
export const backLinkClass =
  'inline-flex items-center gap-1.5 text-sm font-bold text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50 transition-colors'

/** Hand a file to the browser as a download. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Hand a .tex to Overleaf, which opens it as a new project. Overleaf takes the
 * document as a form field, so this posts a real form: a resume is far too long
 * to survive a URL.
 */
export function openInOverleaf(latex: string): void {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = 'https://www.overleaf.com/docs'
  form.target = '_blank'
  form.rel = 'noopener noreferrer'
  for (const [name, value] of [['snip', latex], ['engine', 'pdflatex']]) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.appendChild(input)
  }
  document.body.appendChild(form)
  form.submit()
  document.body.removeChild(form)
}

export function resumeFileBase(name: string): string {
  return `${sanitizeFileName(name) || 'Resume'}_Resume`
}

/** Compile on the server and download the PDF. Throws with the compiler's reason. */
async function compileAndDownload(body: Record<string, unknown>, name: string, fileBase = resumeFileBase(name)): Promise<void> {
  const fileName = fileBase
  const res = await fetch('/api/resume/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, fileName }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.log ? `${data.error}\n\n${data.log}` : data.error ?? 'The PDF could not be built.')
  }
  downloadBlob(await res.blob(), `${fileName}.pdf`)
}

/** Build a saved resume into a PDF and download it, with any approved tailoring changes spliced in on the server. */
export function downloadResumePdf(
  resumeId: string,
  name: string,
  changes?: Array<{ original: string; proposed: string; approved: boolean | null }>
): Promise<void> {
  return compileAndDownload({ resumeId, changes }, name)
}

/** Build a tailored copy from the history into a PDF, exactly as it was saved, and download it. */
export function downloadTailoringPdf(tailoringId: string, name: string): Promise<void> {
  return compileAndDownload({ tailoringId }, name)
}

/** Set a cover letter on a letter page, build it into a PDF and download it. */
export function downloadCoverLetterPdf(coverLetterId: string, name: string): Promise<void> {
  return compileAndDownload({ coverLetterId }, name, `${sanitizeFileName(name) || 'Cover'}_Cover_Letter`)
}
