import Dead from '@/components/brand/Dead'

export const metadata = {
  title: 'Page not found | Chills',
  robots: { index: false, follow: true },
}

/** A URL that isn't here: a mistyped address, or a week nothing was published in. */
export default function NotFound() {
  return (
    <Dead
      code="404"
      title="That page isn’t here"
      body="The link may be mistyped, or it may have been a week when nothing was published. Everything else is where it was."
    />
  )
}
