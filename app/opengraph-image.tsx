import { ImageResponse } from 'next/og'
import { LogoGlyph } from '@/components/brand/Logo'

/**
 * The picture a shared link to Chills shows in WhatsApp, LinkedIn, X or Slack:
 * the logo, the home page's promise, and the address, in the site's own style
 * of hard black outlines and offset shadows. Every page inherits it.
 *
 * Drawn once at build time. DM Sans, the site's typeface, is fetched from
 * Google Fonts for just the letters drawn; if it can't be fetched, the picture
 * is drawn in the renderer's own font rather than not at all.
 */

export const alt = 'Chills: tailor your resume and email it to the recruiter'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const INK = '#0a0a0a'
const PAGE = '#faf6fb'
const DOT = '#e4dde8'
const MINT = '#75fa92'
const YELLOW = '#ffdf20'
const SKY = '#bedbff'

const NAME = 'Chills'
const PROMISE = 'Tailor your resume'
const PROMISE_REST = 'and email it to the recruiter'
const ADDRESS = 'chills.pro'

/** One weight of DM Sans, cut down to `text`. Null when Google Fonts can't be reached. */
async function dmSans(weight: 700 | 900, text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=DM+Sans:wght@${weight}&text=${encodeURIComponent(text)}`
    ).then((res) => res.text())
    const source = /src: url\((.+?)\) format\('(?:opentype|truetype)'\)/.exec(css)?.[1]
    if (!source) return null
    const font = await fetch(source)
    return font.ok ? await font.arrayBuffer() : null
  } catch (err) {
    console.warn('[opengraph-image] DM Sans could not be fetched:', err instanceof Error ? err.message : err)
    return null
  }
}

export default async function OpengraphImage() {
  const letters = `${NAME}${PROMISE}${PROMISE_REST}${ADDRESS}`
  const [black, bold] = await Promise.all([dmSans(900, letters), dmSans(700, letters)])
  const fonts = [
    ...(black ? [{ name: 'DM Sans', data: black, weight: 900 as const, style: 'normal' as const }] : []),
    ...(bold ? [{ name: 'DM Sans', data: bold, weight: 700 as const, style: 'normal' as const }] : []),
  ]

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: PAGE,
          // The renderer wants a unit on every stop: "transparent 0" fails to parse.
          backgroundImage: `radial-gradient(circle at 4px 4px, ${DOT} 6%, transparent 0%)`,
          backgroundSize: '44px 44px',
          color: INK,
          fontFamily: 'DM Sans',
        }}
      >
        {/* Two shapes in the corners, half off the edge, for the site's color and nothing to read. */}
        <div
          style={{
            position: 'absolute',
            top: -70,
            right: -60,
            width: 230,
            height: 230,
            backgroundColor: YELLOW,
            border: `6px solid ${INK}`,
            borderRadius: 999,
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: -90,
            left: -70,
            width: 250,
            height: 250,
            backgroundColor: SKY,
            border: `6px solid ${INK}`,
            borderRadius: 44,
            transform: 'rotate(14deg)',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 30 }}>
          <div
            style={{
              width: 128,
              height: 128,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: MINT,
              border: `6px solid ${INK}`,
              borderRadius: 28,
              boxShadow: `10px 10px 0 0 ${INK}`,
            }}
          >
            <LogoGlyph size={80} />
          </div>
          <div style={{ display: 'flex', fontSize: 116, fontWeight: 900, letterSpacing: -4, lineHeight: 1 }}>{NAME}</div>
        </div>

        <div
          style={{
            display: 'flex',
            marginTop: 64,
            fontSize: 70,
            fontWeight: 900,
            letterSpacing: -2,
            lineHeight: 1.1,
            backgroundColor: MINT,
            border: `5px solid ${INK}`,
            borderRadius: 18,
            boxShadow: `8px 8px 0 0 ${INK}`,
            padding: '4px 30px 12px',
            transform: 'rotate(-2deg)',
          }}
        >
          {PROMISE}
        </div>
        <div style={{ display: 'flex', marginTop: 22, fontSize: 70, fontWeight: 900, letterSpacing: -2, lineHeight: 1.1 }}>
          {PROMISE_REST}
        </div>

        <div
          style={{
            display: 'flex',
            marginTop: 48,
            fontSize: 34,
            fontWeight: 700,
            backgroundColor: '#ffffff',
            border: `4px solid ${INK}`,
            borderRadius: 999,
            boxShadow: `6px 6px 0 0 ${INK}`,
            padding: '8px 34px 12px',
          }}
        >
          {ADDRESS}
        </div>
      </div>
    ),
    { ...size, fonts }
  )
}
