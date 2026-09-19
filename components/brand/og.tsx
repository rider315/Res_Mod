/* eslint-disable @next/next/no-img-element */

/**
 * The card that appears when a Chills link is pasted into WhatsApp, LinkedIn or
 * anywhere else that reads Open Graph tags.
 *
 * Drawn in JSX and rendered to a PNG by next/og, so it stays in the repo next to
 * the pages it describes rather than being a file somebody has to remember to
 * re-export. That means it is Satori, not a browser: no CSS variables, no
 * classes, no gap on a block element, and every colour written out in full.
 * Anything with children needs an explicit `display: flex`.
 */

export const OG_SIZE = { width: 1200, height: 630 }

const INK = '#0a0a0a'
const ACCENT = '#75fa92'
const YELLOW = '#ffdf20'
const WHITE = '#ffffff'
const MUTED = '#364153'

/** Chills's mark, as components/brand/Logo.tsx draws it, at card scale. */
function Mark({ size = 84 }: { size?: number }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        background: ACCENT,
        border: `4px solid ${INK}`,
        borderRadius: 16,
        boxShadow: `7px 7px 0 0 ${INK}`,
      }}
    >
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none">
        <path
          d="M5 3.5h9l4 4V20a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 5 20z"
          fill={WHITE}
          stroke={INK}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M14 3.5v4h4" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8 11h6M8 14.5h4" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M19.8 11.2l1.6 1.6-6.6 6.6-2.4.8.8-2.4z" fill={YELLOW} stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

/**
 * One card. `highlight` is the part of the headline that gets the marker pen
 * behind it, and it has to appear in `title` for that to work.
 */
export function OgCard({
  title,
  highlight,
  lines,
  chip,
}: {
  title: string
  highlight?: string
  /** Two or three short claims along the bottom. */
  lines: string[]
  /** The small label above the headline. */
  chip?: string
}) {
  const [before, after] = highlight && title.includes(highlight) ? title.split(highlight) : [title, '']

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#faf6fb',
        padding: 64,
        // The same hard edge every card in the product has.
        borderBottom: `20px solid ${ACCENT}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Mark />
          <div style={{ display: 'flex', fontSize: 52, fontWeight: 800, color: INK, marginLeft: 22, letterSpacing: -1 }}>Chills</div>
        </div>
        {chip && (
          <div
            style={{
              display: 'flex',
              fontSize: 26,
              fontWeight: 700,
              color: INK,
              background: YELLOW,
              border: `3px solid ${INK}`,
              borderRadius: 999,
              padding: '10px 26px',
            }}
          >
            {chip}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', fontSize: 78, fontWeight: 800, color: INK, lineHeight: 1.12, letterSpacing: -2 }}>
        <span>{before}</span>
        {highlight && (
          <span
            style={{
              display: 'flex',
              background: ACCENT,
              border: `4px solid ${INK}`,
              borderRadius: 12,
              padding: '0 16px',
              marginRight: 12,
            }}
          >
            {highlight}
          </span>
        )}
        <span>{after}</span>
      </div>

      {/* The claims take what room they need and the domain keeps its own, so a
          long line can never end up printed against "chills.pro". */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 1, paddingRight: 40 }}>
          {lines.slice(0, 2).map((line, i) => (
            <div key={line} style={{ display: 'flex', alignItems: 'center' }}>
              {i > 0 && <div style={{ display: 'flex', color: '#9aa3af', fontSize: 28, margin: '0 16px' }}>·</div>}
              <div style={{ display: 'flex', fontSize: 28, fontWeight: 600, color: MUTED }}>{line}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexShrink: 0, fontSize: 30, fontWeight: 800, color: INK }}>chills.pro</div>
      </div>
    </div>
  )
}
