/**
 * Structured data for one page.
 *
 * It goes in as a script tag because that is the only way Google reads it. The
 * JSON is built on the server from the page's own content (lib/seo.ts), never
 * from anything a user typed, and `<` is escaped so a stray closing tag in the
 * data can't end the script early.
 */
export default function JsonLd({ data }: { data: object | object[] }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
}
