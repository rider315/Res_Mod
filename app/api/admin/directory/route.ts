import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOwner } from '@/lib/require-auth'
import { checkEmails } from '@/lib/outreach/email-check'
import { LIMITS } from '@/lib/outreach/model'
import {
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
import { directoryStats, publishBatch, suppressContacts } from '@/lib/db/directory'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * The owner's side of the recruiter directory: publishing a week's list, and
 * switching a contact off.
 *
 * It reads the same files the users' own imports do, and checks every address
 * the same way, so nothing reaches the directory that couldn't be written to.
 */

const startsWith = (bytes: Uint8Array, magic: number[]) => magic.every((byte, i) => bytes[i] === byte)

async function rowsFromFile(file: File): Promise<RecruiterRow[]> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
    const text = await pdfText(bytes)
    if (!text.trim()) throw new RecruiterImportError('That PDF has no text in it. Export the list as CSV or Excel instead.')
    return recruitersFromPdfText(text)
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return rowsFromTable(await readXlsx(bytes))
  if (bytes.includes(0)) throw new RecruiterImportError('Upload a CSV, Excel (.xlsx), PDF or text file.')
  const text = new TextDecoder().decode(bytes)
  if (file.name.toLowerCase().endsWith('.csv') || /^[^\n]*,[^\n]*e-?mail/i.test(text)) return rowsFromTable(parseCsv(text))
  return parsePastedList(text)
}

export async function GET() {
  const auth = await requireOwner()
  if (!auth.ok) return auth.response
  return NextResponse.json(await directoryStats())
}

/** Publish a week's list. The batch is the week it belongs to, so "new" means something. */
export async function POST(req: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.response

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  const field = String(form?.get('field') ?? '').trim()
  const batch = String(form?.get('batch') ?? '').trim() || new Date().toISOString().slice(0, 10)
  const source = String(form?.get('source') ?? '').trim()

  if (!(file instanceof File)) return NextResponse.json({ error: 'No file was received.' }, { status: 400 })
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: 'Files must be smaller than 4 MB.' }, { status: 413 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(batch)) return NextResponse.json({ error: 'The batch must be a date, as 2026-09-21.' }, { status: 400 })

  let rows: RecruiterRow[]
  try {
    rows = (await rowsFromFile(file)).slice(0, LIMITS.importRows)
  } catch (err) {
    if (err instanceof RecruiterImportError || err instanceof ImportError) {
      return NextResponse.json({ error: err.message }, { status: 422 })
    }
    console.error('[admin/directory] could not read the list:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'That list could not be read.' }, { status: 500 })
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No addresses were found. Make sure a column is headed "Email".' }, { status: 422 })
  }

  // Every address is checked before it is published: a bad one here would be
  // handed to hundreds of accounts.
  const checks = await checkEmails(rows.map((row) => row.email))
  const valid: RecruiterRow[] = []
  const rejected: Array<{ email: string; reason: string }> = []
  checks.forEach((check, i) => {
    if (check.valid) valid.push({ ...rows[i], email: check.email })
    else rejected.push({ email: check.email || rows[i].email, reason: check.message })
  })

  const published = await publishBatch(valid, batch, field, source)
  return NextResponse.json({ ...published, found: rows.length, rejected: rejected.slice(0, 100) })
}

const suppressSchema = z.object({
  emails: z.array(z.string().trim().min(3)).min(1).max(500),
  reason: z.string().trim().max(200).default('asked not to be contacted'),
})

/**
 * Switch contacts off. This is how "please stop emailing me" is honoured: they
 * leave the directory at once and can never be taken again.
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.response
  const parsed = suppressSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }
  const suppressed = await suppressContacts(parsed.data.emails, parsed.data.reason)
  return NextResponse.json({ suppressed })
}
