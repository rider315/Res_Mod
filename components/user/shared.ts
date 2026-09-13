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

export function resumeFileBase(name: string): string {
  return `${sanitizeFileName(name) || 'Resume'}_Resume`
}

/** Build a saved resume into a PDF and download it. Throws with the compiler's reason. */
export async function downloadResumePdf(resumeId: string, name: string): Promise<void> {
  const fileName = resumeFileBase(name)
  const res = await fetch('/api/resume/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resumeId, fileName }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.log ? `${data.error}\n\n${data.log}` : data.error ?? 'The PDF could not be built.')
  }
  downloadBlob(await res.blob(), `${fileName}.pdf`)
}
