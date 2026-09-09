'use client'
import { useState } from 'react'

/**
 * A collapsible view of the .tex source, with copy-to-clipboard.
 *
 * The whole point of moving off Google Docs is that the resume is now source
 * code the user owns, so the app should never hide it: this is how you check
 * what actually got written before pasting it into Overleaf.
 */
export default function LatexPreview({
  latex,
  title,
  defaultOpen = false,
}: {
  latex: string
  title: string
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(latex)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard can be blocked; the textarea below is still selectable.
    }
  }

  const lineCount = latex.split('\n').length

  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)] hover:text-[var(--color-primary)] transition-colors"
          aria-expanded={open}
        >
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          {title}
          <span className="text-xs font-normal text-[var(--color-text-faint)]">
            {lineCount} lines
          </span>
        </button>
        <button
          onClick={copy}
          className="text-xs px-2.5 py-1 rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-offset)] transition-all"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {open && (
        <textarea
          readOnly
          value={latex}
          spellCheck={false}
          rows={20}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full px-4 py-3 border-t border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-xs font-mono leading-relaxed resize-y focus:outline-none"
        />
      )}
    </div>
  )
}
