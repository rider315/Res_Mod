'use client'
import { useEffect } from 'react'

/**
 * The last resort: the root layout itself threw, so there is no layout to render
 * inside and this has to supply its own html and body.
 *
 * That also means no stylesheet and no fonts, so everything here is inline. It
 * should never be seen; when it is, the one thing that matters is that the page
 * isn't blank and there is a way back.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // The visitor is never shown it; the digest is what ties this to the server log.
  useEffect(() => {
    console.error('[layout]', error.digest ?? '', error.message)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#faf6fb',
          color: '#0a0a0a',
          fontFamily: 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Chills is having a moment</h1>
          <p style={{ color: '#364153', lineHeight: 1.6, marginTop: 12 }}>
            Something broke before the page could load. Nothing you did caused it, and nothing you have saved is affected.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 24,
              padding: '12px 28px',
              fontSize: 16,
              fontWeight: 700,
              color: '#0a0a0a',
              background: '#75fa92',
              border: '2px solid #0a0a0a',
              borderRadius: 10,
              boxShadow: '4px 4px 0 0 #0a0a0a',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          <p style={{ marginTop: 20 }}>
            <a href="/" style={{ color: '#0a0a0a', fontWeight: 700 }}>
              Go to chills.pro
            </a>
          </p>
        </div>
      </body>
    </html>
  )
}
