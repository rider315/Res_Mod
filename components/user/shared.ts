import { sanitizeFileName } from '@/lib/resume-filename'

/** Pieces shared by the regular-user screens. */

export interface ResumeSummary {
  id: string
  title: string
  sourceFormat: string
  updatedAt: string
}

export const primaryButton =
  'py-2.5 px-5 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-sm hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-all'

export const secondaryButton =
  'py-2 px-3.5 rounded-xl border border-[var(--color-border)] text-[var(--color-text)] font-medium text-sm hover:bg-[var(--color-surface-offset)] disabled:opacity-50 disabled:cursor-not-allowed transition-all'

export const dangerButton =
  'py-2 px-3.5 rounded-xl border border-[var(--color-border)] text-[var(--color-text-muted)] font-medium text-sm hover:text-[var(--color-error)] hover:border-[var(--color-error)] disabled:opacity-50 disabled:cursor-not-allowed transition-all'

export const inputClass =
  'w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-all'

export const errorBox =
  'rounded-xl border border-[var(--color-error)] bg-[var(--color-error-highlight)] p-3 text-sm text-[var(--color-error)] whitespace-pre-wrap'

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
async function compileAndDownload(body: Record<string, unknown>, name: string): Promise<void> {
  const fileName = resumeFileBase(name)
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
