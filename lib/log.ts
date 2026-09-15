/**
 * Resume text, job descriptions and model replies are personal data, so they
 * stay out of production logs: there a snippet is replaced by its length.
 * Running locally, the text itself is shown, for debugging.
 *
 * Client-safe: Next inlines NODE_ENV into the browser bundle.
 */
export function logSnippet(text: string, max = 500): string {
  if (process.env.NODE_ENV === 'production') return `[${text.length} characters not logged]`
  return text.slice(0, max)
}
