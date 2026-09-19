import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/require-auth'
import { extractResumeText, ImportError } from '@/lib/import/extract'
import { MAX_UPLOAD_BYTES } from '@/lib/resume-doc'
import { checkRateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/security/rate-limit'

/**
 * Pull the text out of an uploaded resume: PDF, .docx, .tex, .txt or .md.
 *
 * No AI and no database here. The text goes back to the browser, which sends it
 * on to structuring — through /api/import/structure, or through Puter in the
 * browser — and shows it to the user if that fails.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const limited = await checkRateLimit(RATE_LIMITS.resumeUpload, auth.userId)
  if (!limited.ok) return tooManyRequests(limited, 'Too many uploads in a short time.')

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Send the resume as a file upload.' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file was received.' }, { status: 400 })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'Resumes must be smaller than 4 MB.' }, { status: 413 })
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const result = await extractResumeText({ name: file.name, type: file.type, bytes })
    return NextResponse.json({ ...result, characters: result.text.length })
  } catch (err) {
    if (err instanceof ImportError) {
      return NextResponse.json({ error: err.message }, { status: 422 })
    }
    console.error('[import/extract]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'That file could not be read.' }, { status: 500 })
  }
}
