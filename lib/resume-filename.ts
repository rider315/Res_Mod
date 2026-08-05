/**
 * Naming for the exported resume.
 *
 * Kept free of server imports so both the API routes and the browser can use the
 * same logic — the download link and the Drive rename must agree.
 */

/**
 * Drive names and download filenames choke on these. Control characters matter
 * most: this value ends up in a Content-Disposition header, where a stray CRLF
 * would let a caller inject headers.
 */
export function sanitizeFileName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .trim()
      .slice(0, 150)
  )
}

/**
 * "<Owner> Resume_<Company>".
 *
 * The owner comes from the resume profile, not the signed-in Google account —
 * otherwise every export is named after whoever happens to be logged in, which
 * meant Himanshu's resume downloaded under Gaurav's name.
 */
export function buildResumeFileName(personName: string, companyName: string): string {
  const who = sanitizeFileName(personName)
  const company = sanitizeFileName(companyName) || 'Company'
  return who ? `${who} Resume_${company}` : `Resume_${company}`
}
