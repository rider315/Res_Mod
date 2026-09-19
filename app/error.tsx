'use client'
import { useEffect } from 'react'
import Dead from '@/components/brand/Dead'

/**
 * Something threw while rendering a page. React hands it here rather than
 * showing a blank screen, and `reset` re-renders the part that failed — which
 * is enough for anything passing, such as a query that timed out.
 *
 * The visitor is never shown the error itself: it can carry a query, an id or a
 * connection string. It goes to the console, where the digest ties it to the
 * server log.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[page]', error.digest ?? '', error.message)
  }, [error])

  return (
    <Dead
      code="Something broke"
      title="That didn’t load"
      body="Something went wrong at our end, not yours. Trying again usually works; if it doesn’t, it isn’t you and we can see it."
      action={
        <button onClick={reset} className="nb-btn nb-btn-primary px-7 py-3.5">
          Try again
        </button>
      }
    />
  )
}
