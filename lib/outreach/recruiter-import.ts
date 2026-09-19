import JSZip from 'jszip'
import { LIMITS } from '@/lib/outreach/model'
import { readEntryCapped, ZipTooLargeError } from '@/lib/security/zip'

/**
 * Reading recruiters out of wherever people keep them: a CSV or Excel export, a
 * public Google Sheet, a pasted list, or a PDF table of HR contacts.
 *
 * These only find candidate rows. Which addresses are real is decided by
 * lib/outreach/email-check.ts before anything is saved.
 */

export interface RecruiterRow {
  email: string
  name: string
  company: string
  title: string
}

/** A problem with the file or link itself, worth showing as it is. */
export class RecruiterImportError extends Error {}

const EMAIL_IN_TEXT = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i

const clean = (value: string) => value.replace(/\s+/g, ' ').trim()

// ─── CSV ─────────────────────────────────────────────────────────────────────

/** RFC 4180: quoted fields, doubled quotes, and line breaks inside quotes. */
export function parseCsv(text: string, maxRows = LIMITS.importRows + 1): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const input = text.replace(/^\uFEFF/, '')

  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"' && field === '') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((cell) => cell.trim())) rows.push(row)
      row = []
      if (rows.length >= maxRows) return rows
    } else {
      field += char
    }
  }
  row.push(field)
  if (row.some((cell) => cell.trim())) rows.push(row)
  return rows.slice(0, maxRows)
}

// ─── Tables: CSV, Excel and Google Sheets ────────────────────────────────────

const HEADER = {
  email: /e-?mail/i,
  company: /company|organi[sz]ation|employer|firm|\borg\b|account/i,
  title: /title|designation|position|\brole\b/i,
  firstName: /first\s*name|given\s*name/i,
  lastName: /last\s*name|surname|family\s*name/i,
  name: /name|recruiter|contact|person|\bhr\b/i,
}

function findColumn(headers: string[], pattern: RegExp, taken: Set<number>): number {
  // A cell holding an address is data, not a heading: "priya.email@…" names no column.
  const index = headers.findIndex((header, i) => !taken.has(i) && !header.includes('@') && pattern.test(header))
  if (index >= 0) taken.add(index)
  return index
}

/**
 * Recruiters from a table whose first row names the columns. The email column
 * is required; name, first/last name, company and title are used when present.
 * A table without a recognisable header still works if one column is mostly
 * email addresses.
 */
export function rowsFromTable(table: string[][]): RecruiterRow[] {
  if (table.length === 0) return []
  const headers = table[0].map((cell) => clean(cell))
  const taken = new Set<number>()
  const email = findColumn(headers, HEADER.email, taken)

  if (email < 0) {
    // No header: take the column where most cells are addresses, and read every row.
    const width = Math.max(...table.map((row) => row.length))
    let best = -1
    let bestCount = 0
    for (let column = 0; column < width; column++) {
      const count = table.filter((row) => EMAIL_IN_TEXT.test(row[column] ?? '')).length
      if (count > bestCount) {
        best = column
        bestCount = count
      }
    }
    if (best < 0) {
      throw new RecruiterImportError('No email addresses were found. Put them in a column headed "Email".')
    }
    return table
      .slice(0, LIMITS.importRows)
      .map((row) => ({ email: clean(EMAIL_IN_TEXT.exec(row[best] ?? '')?.[0] ?? ''), name: '', company: '', title: '' }))
      .filter((row) => row.email)
  }

  const company = findColumn(headers, HEADER.company, taken)
  const title = findColumn(headers, HEADER.title, taken)
  const first = findColumn(headers, HEADER.firstName, taken)
  const last = findColumn(headers, HEADER.lastName, taken)
  const name = first < 0 ? findColumn(headers, HEADER.name, taken) : -1
  const cell = (row: string[], index: number) => (index >= 0 ? clean(row[index] ?? '') : '')

  return table
    .slice(1, LIMITS.importRows + 1)
    .map((row) => ({
      email: clean(EMAIL_IN_TEXT.exec(row[email] ?? '')?.[0] ?? cell(row, email)),
      name: first >= 0 ? clean(`${cell(row, first)} ${cell(row, last)}`) : cell(row, name),
      company: cell(row, company),
      title: cell(row, title),
    }))
    .filter((row) => row.email)
}

/** The CSV export address of a Google Sheet the user shared by link. */
export function googleSheetCsvUrl(link: string): string {
  let url: URL
  try {
    url = new URL(link.trim())
  } catch {
    throw new RecruiterImportError('That is not a link. Paste the Google Sheets address from your browser.')
  }
  const id = /\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/.exec(url.pathname)?.[1]
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !id) {
    throw new RecruiterImportError('Use a Google Sheets link, such as https://docs.google.com/spreadsheets/d/…')
  }
  const gid = /(?:^|[#&?])gid=(\d+)/.exec(`${url.search}${url.hash}`)?.[1]
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ''}`
}

// ─── Excel ───────────────────────────────────────────────────────────────────

/** An .xlsx expands to many times its size; past this, a sheet is not a recruiter list. */
const MAX_SHEET_CHARS = 20_000_000

const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }
    return XML_ENTITIES[entity.toLowerCase()] ?? whole
  })
}

/** Every <t> run inside a string item, joined: rich text keeps each styled run separately. */
function textRuns(xml: string): string {
  let text = ''
  for (const match of Array.from(xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g))) text += match[1]
  return decodeXml(text)
}

function attribute(tag: string, name: string): string | null {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null
}

/** "C12" → 2. */
function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/.exec(reference)?.[0] ?? ''
  let index = 0
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64)
  return index - 1
}

async function readPart(zip: JSZip, path: string): Promise<string | null> {
  const entry = zip.file(path)
  if (!entry) return null
  // Inflated as a stream and stopped at the cap: a zip can lie about how large its parts are.
  try {
    return await readEntryCapped(entry, MAX_SHEET_CHARS)
  } catch (err) {
    if (err instanceof ZipTooLargeError) {
      throw new RecruiterImportError('That workbook is too large to read. Keep recruiter lists under a few thousand rows.')
    }
    throw err
  }
}

/** The first sheet of an .xlsx workbook, as rows of cell text. */
export async function readXlsx(bytes: Uint8Array, maxRows = LIMITS.importRows + 1): Promise<string[][]> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new RecruiterImportError('That Excel file could not be opened. Save it again as .xlsx or .csv.')
  }
  const workbook = await readPart(zip, 'xl/workbook.xml')
  if (!workbook) throw new RecruiterImportError('That file is not an Excel workbook. Save it as .xlsx or .csv.')

  const firstSheet = /<sheet\s[^>]*>/.exec(workbook)?.[0] ?? ''
  const relationId = attribute(firstSheet, 'r:id')
  const relations = (await readPart(zip, 'xl/_rels/workbook.xml.rels')) ?? ''
  let target = 'worksheets/sheet1.xml'
  for (const match of Array.from(relations.matchAll(/<Relationship\s[^>]*>/g))) {
    if (relationId && attribute(match[0], 'Id') === relationId) target = attribute(match[0], 'Target') ?? target
  }
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
  const sheet = await readPart(zip, sheetPath)
  if (!sheet) throw new RecruiterImportError('The first sheet of that workbook could not be read.')

  const shared: string[] = []
  const sharedXml = await readPart(zip, 'xl/sharedStrings.xml')
  if (sharedXml) for (const item of Array.from(sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g))) shared.push(textRuns(item[1]))

  const rows: string[][] = []
  for (const rowMatch of Array.from(sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g))) {
    const row: string[] = []
    for (const cellMatch of Array.from(rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g))) {
      const tag = ` ${cellMatch[1]}`
      const inner = cellMatch[2] ?? ''
      const column = columnIndex(attribute(tag, 'r') ?? '')
      if (column < 0 || column > 50) continue
      const type = attribute(tag, 't')
      const value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
      let text = ''
      if (type === 's') text = shared[Number(value)] ?? ''
      else if (type === 'inlineStr') text = textRuns(inner)
      else if (value !== undefined) text = decodeXml(value)
      row[column] = text
    }
    const filled = Array.from(row, (cell) => cell ?? '')
    if (filled.some((cell) => cell.trim())) rows.push(filled)
    if (rows.length >= maxRows) break
  }
  return rows
}

// ─── Pasted lists ────────────────────────────────────────────────────────────

/**
 * One recruiter per line, the address anywhere in it:
 *   priya.rao@northwind.com
 *   Priya Rao <priya.rao@northwind.com>
 *   Priya Rao, Northwind, priya.rao@northwind.com, Talent Partner
 * Whatever else is on the line is read as name, company and title, in that order.
 */
export function parsePastedList(text: string): RecruiterRow[] {
  const rows: RecruiterRow[] = []
  for (const line of text.split(/\r?\n/)) {
    const email = EMAIL_IN_TEXT.exec(line)?.[0]
    if (!email) continue
    const rest = line
      .replace(email, ' ')
      .replace(/[<>()"]/g, ' ')
      .split(/[,;\t|]| - /)
      .map(clean)
      .filter(Boolean)
    rows.push({ email, name: rest[0] ?? '', company: rest[1] ?? '', title: rest[2] ?? '' })
    if (rows.length >= LIMITS.importRows) break
  }
  return rows
}

// ─── PDF tables ──────────────────────────────────────────────────────────────

/**
 * Recruiters from the text of a PDF table (usually columns like SNo, Name,
 * Email, Title, Company). PDF text extraction often glues the columns
 * together, e.g.
 *   "1Akanksha Puriakanksha.puri@sourcefuse.comAssociate Director HRSourceFuse Technologies"
 * so each address is found from its "@" and the name glued in front of it is
 * worked out from the name words before it.
 */
export function recruitersFromPdfText(input: string): RecruiterRow[] {
  const text = input
    // Addresses a line break split: "john@\ncompany.com", "john@company.\ncom", "john@company\n.com".
    .replace(/@\s*\r?\n\s*/g, '@')
    .replace(/(@[a-zA-Z0-9-]+)\.\s*\r?\n\s*([a-zA-Z]{2,})/g, '$1.$2')
    .replace(/(@[a-zA-Z0-9-]+)\s*\r?\n\s*\.([a-zA-Z]{2,})/g, '$1.$2')

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return []

  // The shortest domain that ends in a known suffix, so "wobot.aiCHROWobot.ai" gives "wobot.ai".
  const domainPattern =
    /^([\w-]+(?:\.[\w-]+)*?\.(?:co\.in|co\.uk|com|org|net|edu|gov|solutions|software|digital|systems|online|design|group|cloud|world|store|site|info|tech|mobi|asia|biz|pro|app|dev|xyz|io|ai|cc|gg|tv|me|us|uk|in|de|fr|ca|au|co|ch|ly|to|vc|eu|nl|es|it|pl|br|sg|hk|nz|za|se|no|dk|at|be|ie))/i

  let start = 0
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    if (/e-?mail/i.test(lines[i]) && /name/i.test(lines[i])) {
      start = i + 1
      break
    }
  }

  const found: RecruiterRow[] = []
  const seen = new Set<string>()

  for (let i = start; i < lines.length && found.length < LIMITS.importRows; i++) {
    const line = lines[i]
    let from = 0
    while (from < line.length) {
      const at = line.indexOf('@', from)
      if (at < 0) break

      const domain = domainPattern.exec(line.substring(at + 1))?.[1]
      if (!domain) {
        from = at + 1
        continue
      }
      const emailEnd = at + 1 + domain.length

      let localStart = at - 1
      while (localStart >= 0 && /[a-zA-Z0-9._\-+]/.test(line[localStart])) localStart--
      localStart++
      const fullLocal = line.substring(localStart, at)
      const realStart = localStart + gluedPrefixLength(fullLocal, line.substring(0, localStart), domain)
      const email = line.substring(realStart, emailEnd)
      const localPart = email.split('@')[0]

      if (localPart.length < 2 || localPart.length > 64 || !/^[a-zA-Z0-9]/.test(localPart) || seen.has(email.toLowerCase())) {
        from = emailEnd
        continue
      }
      seen.add(email.toLowerCase())

      let name = line.substring(0, realStart).replace(/^\d+/, '').trim()
      if (name.length < 2) {
        name = localPart
          .replace(/[._\-+]/g, ' ')
          .split(' ')
          .filter(Boolean)
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ')
      }

      found.push({ email, name: clean(name), ...titleAndCompany(line.substring(emailEnd).trim(), domain) })
      from = emailEnd
    }
  }
  return found
}

/**
 * How many characters at the start of `local` belong to the name or serial
 * number glued before the address, rather than to the address itself.
 *
 * Addresses are written in lower case, so only one with a capital letter in it
 * is taken apart, and a split is only believed when what it cuts off is a
 * serial number and one capitalised word, and what it leaves starts like an
 * address. So a cleanly spaced "Priya Rao priya.rao@…" is left alone.
 */
function gluedPrefixLength(local: string, before: string, domain: string): number {
  if (!/[A-Z]/.test(local)) return 0
  const stripped = local.replace(/^\d+/, '')
  const digits = local.length - stripped.length
  const lower = local.toLowerCase()
  const plausible = (at: number) =>
    at > 0 && at <= local.length - 2 && /^\d*(?:[A-Z][a-zA-Z]*)?$/.test(local.slice(0, at)) && /^[a-z0-9]/.test(local.slice(at))

  // "Puriakanksha.puri", with "Akanksha" before it: the address starts where the first name reappears.
  const nameWords = before.match(/[a-zA-Z]{2,}/g) ?? []
  for (const word of nameWords) {
    const at = lower.indexOf(word.toLowerCase())
    if (plausible(at)) return at
  }

  // "Gokaagoka" after "Aswanth": initial plus last name, "a" + "goka".
  if (nameWords.length > 0 && stripped.length >= 5) {
    for (const word of nameWords) {
      const initial = word[0].toLowerCase()
      for (let length = 2; length <= stripped.length - 3; length++) {
        const at = digits + length
        if (stripped.substring(length).toLowerCase() === initial + stripped.substring(0, length).toLowerCase() && plausible(at)) {
          return at
        }
      }
    }
  }

  if (stripped.length >= 4) {
    const dot = stripped.indexOf('.')
    const head = (dot > 0 ? stripped.substring(0, dot) : stripped).toLowerCase()
    // "Puriakanksha.puri": the part before the dot starts with the last name after it.
    const afterDot = dot > 0 ? stripped.substring(dot + 1).toLowerCase() : ''
    if (afterDot.length >= 2 && head.startsWith(afterDot) && plausible(digits + afterDot.length)) return digits + afterDot.length
    // "Amitamit.malhotra": a name glued to its own repeat.
    const repeat = repeatedTail(head)
    if (repeat > 0 && plausible(digits + repeat)) return digits + repeat
  }

  // "Solutionsqa@artoonsolutions.com": the end of the company name glued on, "Solutions" + "qa".
  if (stripped.length >= 6) {
    const base = mainLabel(domain)
    for (let length = Math.min(stripped.length - 2, base.length - 1); length >= 4; length--) {
      if (base.endsWith(stripped.substring(0, length).toLowerCase()) && plausible(digits + length)) return digits + length
    }
  }

  // A name that shares nothing with its address ("John Doeadmin@…") can't be told apart; it is left whole.
  return plausible(digits) ? digits : 0
}

/** Where a name glued to its own repeat ("amitamit") repeats, or 0. */
function repeatedTail(word: string): number {
  if (word.length < 4) return 0
  for (let half = Math.floor(word.length / 2); half >= 2; half--) {
    const tail = word.substring(word.length - half)
    const index = word.indexOf(tail)
    if (index >= 0 && index < word.length - half) return word.length - half
  }
  return 0
}

/** The label a company's domain is named after: "sourcefuse" in mail.sourcefuse.co.in. */
function mainLabel(domain: string): string {
  const labels = domain.toLowerCase().split('.')
  const suffixLength = /\.(?:co|com|org|net|ac|gov)\.[a-z]{2}$/.test(domain.toLowerCase()) ? 2 : 1
  return labels
    .slice(0, -suffixLength)
    .map((label) => label.replace(/[^a-z0-9]/g, ''))
    .reduce((longest, label) => (label.length > longest.length ? label : longest), '')
}

/** Where `needle` starts in `text` when spaces and punctuation are ignored, so "artoonsolutions" finds "Artoon Solutions". */
function looseIndex(text: string, needle: string): number {
  const positions: number[] = []
  let squeezed = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i].toLowerCase()
    if (/[a-z0-9]/.test(char)) {
      squeezed += char
      positions.push(i)
    }
  }
  const at = squeezed.indexOf(needle)
  return at >= 0 ? positions[at] : -1
}

/**
 * One column's text. A name the source wrote twice in a row — "Securelynkx
 * Networks Securelynkx Networks", from a title column that repeated the company
 * column — is collapsed back to one, because it goes into an email addressed to
 * someone who works there.
 */
function tidyColumn(value: string): string {
  const text = clean(value.replace(/^[,.\-\s]+|[,.\-\s]+$/g, ''))
  const half = Math.floor(text.length / 2)
  const first = text.slice(0, half).trim()
  return first.length >= 4 && first.toLowerCase() === text.slice(half).trim().toLowerCase() ? first : text
}

/**
 * The words an HR job title is built from. Deliberately only the ones that name
 * a role or the function it sits in — not "management", "delivery", "business"
 * or "solutions", which turn up in company names at least as often and would cut
 * "Education Management Solutions" in half.
 */
const TITLE_WORDS = new Set([
  'chief', 'head', 'director', 'vp', 'avp', 'svp', 'president', 'vice', 'manager', 'lead', 'partner', 'specialist',
  'executive', 'associate', 'officer', 'recruiter', 'recruitment', 'recruiting', 'consultant', 'senior', 'global',
  'deputy', 'assistant', 'hr', 'chro', 'human', 'resources', 'talent', 'acquisition', 'people', 'staffing',
  'operations', 'admin', 'generalist', 'sourcer', 'ta',
])

/**
 * Where the title ends when the domain gave nothing away: "Recruitment Delivery
 * Head SA Technologies" at satincorp.com, whose name appears nowhere in either.
 *
 * The title comes first in these lists and is built from a small vocabulary, so
 * the last word of that vocabulary is the end of it. This runs only after both
 * domain matches have failed, because a company actually called "Talent Corp"
 * would be cut in half by it — and such a company almost always has the name in
 * its domain, so the earlier matches take it first.
 */
function whereTheTitleEnds(after: string): number {
  const words = Array.from(after.matchAll(/[A-Za-z][A-Za-z.&/-]*/g))
  let end = -1
  for (const word of words) {
    if (TITLE_WORDS.has(word[0].toLowerCase().replace(/[^a-z]/g, ''))) end = word.index! + word[0].length
  }
  // Something has to be left over to be the company, and something to be the title.
  return end > 0 && after.length - end >= 3 ? end : -1
}

/**
 * Where the company's name starts, when only the opening of its domain appears
 * in the text: "appinessworld" against "… Resources Appiness Interactive".
 *
 * The longest opening wins, so the match is as specific as the domain allows,
 * and it must begin a word — otherwise a four-letter opening like "tech" would
 * cut "Tech Lead" in half. Five characters is the shortest worth trusting for
 * the same reason. Returns -1 when nothing matches.
 */
function openingOfDomain(after: string, base: string): number {
  for (let length = base.length - 1; length >= 5; length--) {
    const at = looseIndex(after, base.slice(0, length))
    if (at > 0 && !/[a-zA-Z0-9]/.test(after[at - 1] ?? '')) return at
  }
  return -1
}

/**
 * The job title and company columns after an address. The company is found by
 * the address's domain when it can be ("HR ManagerTechCorp India" at
 * techcorp.in), otherwise it is the last spaced column or the last capitalised run.
 */
function titleAndCompany(after: string, domain: string): { title: string; company: string } {
  if (!after) return { title: '', company: '' }

  const base = mainLabel(domain)
  if (base.length >= 3) {
    const at = looseIndex(after, base)
    if (at >= 0) return { title: tidyColumn(after.slice(0, at)), company: tidyColumn(after.slice(at)) }

    // A company whose domain says more than its name does: "Appiness Interactive"
    // at appinessworld.com, "Skience" at skience.co. The exact label isn't in the
    // text, but the start of it is, and that is where the title ends. Without
    // this the whole of "Head Of Human Resources Appiness Interactive" became the
    // company, and that name then went into the email as the company's own.
    const opening = openingOfDomain(after, base)
    if (opening > 0) return { title: tidyColumn(after.slice(0, opening)), company: tidyColumn(after.slice(opening)) }
  }

  const spaced = after.split(/\s{2,}/).filter(Boolean)
  if (spaced.length >= 2) {
    return { title: tidyColumn(spaced.slice(0, -1).join(' ')), company: tidyColumn(spaced[spaced.length - 1]) }
  }

  const byTitle = whereTheTitleEnds(after)
  if (byTitle > 0) {
    // "Head of HR at Securelynkx Networks": the "at" belongs to the title's
    // sentence, not to the company's name.
    return { title: tidyColumn(after.slice(0, byTitle)), company: tidyColumn(after.slice(byTitle).trim().replace(/^at\s+/i, '')) }
  }
  for (let i = after.length - 2; i >= 0; i--) {
    if (/[a-z]/.test(after[i]) && /[A-Z]/.test(after[i + 1]) && after.length - (i + 1) >= 3) {
      return { title: tidyColumn(after.slice(0, i + 1)), company: tidyColumn(after.slice(i + 1)) }
    }
  }
  return { title: '', company: tidyColumn(after) }
}
