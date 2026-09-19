import Link from 'next/link'

/**
 * The page and pencil inside the mark. Plain SVG with no classes, so the link
 * preview and the home-screen icon (app/opengraph-image.tsx, app/apple-icon.tsx)
 * draw the same one.
 */
export function LogoGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 3.5h9l4 4V20a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 5 20z" fill="#ffffff" stroke="#0a0a0a" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M14 3.5v4h4" stroke="#0a0a0a" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8 11h6M8 14.5h4" stroke="#0a0a0a" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M19.8 11.2l1.6 1.6-6.6 6.6-2.4.8.8-2.4z" fill="#ffdf20" stroke="#0a0a0a" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

/** Chills's mark: a page with a pencil, on a mint tile with a hard shadow. */
export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center bg-[var(--color-accent)] border-[1.6px] border-[#0a0a0a] shadow-[3px_3px_0_0_#0a0a0a] rounded-[8px] shrink-0"
      style={{ width: size, height: size }}
    >
      <LogoGlyph size={size * 0.62} />
    </span>
  )
}

export default function Logo({ href = '/', size = 40 }: { href?: string | null; size?: number }) {
  const content = (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="text-xl font-black tracking-tight text-[var(--color-text)]">Chills</span>
    </span>
  )
  return href ? (
    <Link href={href} aria-label="Chills home" className="inline-flex">
      {content}
    </Link>
  ) : (
    content
  )
}
