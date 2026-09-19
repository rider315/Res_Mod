import { ImageResponse } from 'next/og'
import { LogoGlyph } from '@/components/brand/Logo'

/**
 * The icon a phone shows when the site is saved to its home screen, and some
 * messengers show beside a link: the mark's mint tile, edge to edge, since the
 * phone rounds the corners itself.
 */

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#75fa92' }}>
        <LogoGlyph size={124} />
      </div>
    ),
    size
  )
}
