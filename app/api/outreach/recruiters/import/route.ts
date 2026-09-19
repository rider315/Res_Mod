import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { LIMITS, RecruiterSource } from '@/lib/outreach/model'
import type { ImportSummary } from '@/lib/outreach/types'
import { checkEmails } from '@/lib/outreach/email-check'
import {
  googleSheetCsvUrl,
  parseCsv,
  parsePastedList,
  readXlsx,
  RecruiterImportError,
  RecruiterRow,
  recruitersFromPdfText,
  rowsFromTable,
} from '@/lib/outreach/recruiter-import'
import { ImportError, pdfText } from '@/lib/import/extract'
import { MAX_UPLOAD_BYTES } from '@/lib/resume-doc'
import { addRecruiters, existingRecruiterEmails } from '@/lib/db/outreach'
import { fail, firstIssue, requireOutreachAccount } from '@/lib/outreach/server'
import { checkRateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/security/rate-limit'

export const maxDuration = 120

const JsonSchema = z.union([
  z.object({ sheetUrl: z.string().trim().min(1, 'Paste the Google Sheets link.').max(2000) }),
  z.object({ text: z.string().min(3, 'Paste at least one email address.').max(200_000) }),
])

const MAX_SHEET_BYTES = 2 * 1024 * 1024

const startsWith = (bytes: Uint8Array, magic: number[]) => magic.every((byte, i) => bytes[i] === byte)

/** Rows from an uploaded file, whatever it turns out to be. */
async function rowsFromFile(file: File): Promise<{ rows: RecruiterRow[]; source: RecruiterSource }> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const name = file.name.toLowerCase()
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
    const text = await pdfText(bytes)
    if (!text.trim()) {
      throw new RecruiterImportError('That PDF has no text in it, as if it were scanned. Export the list as CSV or Excel instead.')
    }
    return { rows: recruitersFromPdfText(text), source: 'pdf' }
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return { rows: rowsFromTable(await readXlsx(bytes)), source: 'excel' }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]) || name.endsWith('.xls')) {
    throw new RecruiterImportError('Older .xls workbooks can’t be read. Save the sheet as .xlsx or .csv and try again.')
  }
  if (bytes.includes(0)) throw new RecruiterImportError('Upload a CSV, Excel (.xlsx), PDF or text file.')

  const text = new TextDecoder().decode(bytes)
  if (name.endsWith('.csv') || /^[^\n]*,[^\n]*e-?mail/i.test(text)) return { rows: rowsFromTable(parseCsv(text)), source: 'csv' }
  return { rows: parsePastedList(text), source: 'paste' }
}

async function rowsFromSheet(link: string): Promise<RecruiterRow[]> {
  const url = googleSheetCsvUrl(link)
  let response: Response
  try {
    response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) })
  } catch {
    throw new RecruiterImportError('Google Sheets couldn’t be reached. Try again in a moment.')
  }
  const type = response.headers.get('content-type') ?? ''
  if (!response.ok || !type.includes('text/csv')) {
    throw new RecruiterImportError('That sheet isn’t public. In Google Sheets, choose Share → “Anyone with the link”, then try again.')
  }
  if (Number(response.headers.get('content-length') ?? 0) > MAX_SHEET_BYTES) {
    throw new RecruiterImportError('That sheet is too large. Keep recruiter lists under a few thousand rows.')
  }
  const text = await response.text()
  if (text.length > MAX_SHEET_BYTES) throw new RecruiterImportError('That sheet is too large. Keep recruiter lists under a few thousand rows.')
  return rowsFromTable(parseCsv(text))
}

/**
 * Import recruiters from a file (CSV, Excel, PDF or text), a public Google
 * Sheet, or a pasted list. Every address is checked; the bad ones are reported,
 * never saved, so they can't reach the AI or anyone's mailbox.
 */
export async function POST(req: NextRequest) {
  const auth = await requireOutreachAccount()
  if (!auth.ok) return auth.response
  const limited = await checkRateLimit(RATE_LIMITS.recruiterImport, auth.userId)
  if (!limited.ok) return tooManyRequests(limited, 'Too many imports in a short time.')

  let rows: RecruiterRow[]
  let source: RecruiterSource
  try {
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await req.formData().catch(() => null)
      const file = form?.get('file')
      if (!(file instanceof File)) return fail(400, 'No file was received.')
      if (file.size > MAX_UPLOAD_BYTES) return fail(413, 'Files must be smaller than 4 MB.')
      const fromFile = await rowsFromFile(file)
      rows = fromFile.rows
      source = fromFile.source
    } else {
      const parsed = JsonSchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) return fail(400, firstIssue(parsed.error))
      if ('sheetUrl' in parsed.data) {
        rows = await rowsFromSheet(parsed.data.sheetUrl)
        source = 'sheets'
      } else {
        rows = parsePastedList(parsed.data.text)
        source = 'paste'
      }
    }
  } catch (err) {
    if (err instanceof RecruiterImportError || err instanceof ImportError) return fail(422, err.message)
    console.error('[outreach/import]', err instanceof Error ? err.message : err)
    return fail(500, 'That list couldn’t be read.')
  }

  rows = rows.slice(0, LIMITS.importRows)
  if (rows.length === 0) {
    return fail(422, 'No email addresses were found. Make sure one column is headed "Email", or paste one address per line.')
  }

  // Repeats within the import, and addresses already in the list, are skipped before any lookups.
  const existing = await existingRecruiterEmails(auth.userId)
  const seen = new Set<string>()
  let duplicates = 0
  const fresh: RecruiterRow[] = []
  for (const row of rows) {
    const key = row.email.trim().toLowerCase()
    if (existing.has(key) || seen.has(key)) {
      duplicates++
      continue
    }
    seen.add(key)
    fresh.push(row)
  }

  const checks = await checkEmails(fresh.map((row) => row.email))
  const valid: RecruiterRow[] = []
  const rejected: ImportSummary['rejected'] = []
  checks.forEach((check, i) => {
    if (check.valid) valid.push({ ...fresh[i], email: check.email })
    else rejected.push({ email: check.email || fresh[i].email, reason: check.message, ...(check.suggestion ? { suggestion: check.suggestion } : {}) })
  })

  const { added, overLimit } = await addRecruiters(auth.userId, valid, source)
  const summary: ImportSummary = {
    found: rows.length,
    added,
    // A row that raced another import in, between the check and the insert, counts as a repeat.
    duplicates: duplicates + (valid.length - overLimit - added),
    rejected: rejected.slice(0, 200),
    overLimit,
  }
  return NextResponse.json(summary)
}
