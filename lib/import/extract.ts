import mammoth from 'mammoth'
import { extractText } from 'unpdf'
import { assertZipWithin, ZipTooLargeError } from '@/lib/security/zip'
import { stripMarkup } from '@/lib/latex/parse'
import { MAX_RESUME_TEXT, MAX_UPLOAD_BYTES, SourceFormat } from '@/lib/resume-doc'

/**
 * Getting plain text out of an uploaded resume. Server-only.
 *
 * The text is only ever read by the structuring step, which transcribes it into
 * a ResumeDoc; nothing from the upload reaches a .tex except through that doc
 * and escapeLatexText. That matters most for LaTeX uploads: a hostile \input or
 * \write18 is reduced to plain words here and is never compiled.
 */

/** A problem with the file itself, worth showing to the user as-is. */
export class ImportError extends Error {}

export interface ExtractedText {
  text: string
  sourceFormat: SourceFormat
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46] // %PDF
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] // PK.. — a .docx is a zip package

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((byte, i) => bytes[i] === byte)
}

/** Decided by the bytes first, so a renamed file is still read correctly. */
function detectFormat(name: string, type: string, bytes: Uint8Array): SourceFormat {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (startsWith(bytes, PDF_MAGIC)) return 'pdf'
  if (startsWith(bytes, ZIP_MAGIC)) {
    if (ext === 'docx') return 'docx'
    throw new ImportError('Only Word .docx files are supported. Save the document as .docx or PDF and try again.')
  }
  if (ext === 'doc') {
    throw new ImportError('Older .doc Word files are not supported. Save it as .docx or PDF and try again.')
  }
  if (bytes.includes(0)) {
    throw new ImportError('Upload a PDF, Word (.docx), LaTeX (.tex) or plain text file.')
  }
  if (ext === 'tex') return 'latex'
  if (ext === 'txt' || ext === 'md' || type.startsWith('text/')) return 'text'
  throw new ImportError('Upload a PDF, Word (.docx), LaTeX (.tex) or plain text file.')
}

/** The text of a PDF. Recruiter lists are read with it too (app/api/outreach/recruiters/import). */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  try {
    // A copy: pdf.js may take ownership of the buffer it is given.
    const { text } = await extractText(new Uint8Array(bytes), { mergePages: true })
    return text
  } catch {
    throw new ImportError('That PDF could not be read. It may be password-protected or damaged.')
  }
}

/**
 * What a .docx may inflate to, all parts together. A real resume with photos is
 * a few megabytes; mammoth inflates whatever it is given, so a zip bomb is
 * turned away before it gets the file.
 */
const MAX_DOCX_INFLATED_BYTES = 60 * 1024 * 1024

async function docxText(bytes: Uint8Array): Promise<string> {
  try {
    await assertZipWithin(bytes, MAX_DOCX_INFLATED_BYTES)
  } catch (err) {
    if (err instanceof ZipTooLargeError) throw new ImportError('That Word file is too large to read. Save it as PDF and try again.')
    throw new ImportError('That Word file could not be read. Try saving it again as .docx or PDF.')
  }
  try {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
    return value
  } catch {
    throw new ImportError('That Word file could not be read. Try saving it again as .docx or PDF.')
  }
}

/** Text-symbol commands worth keeping as the character they print. */
const SYMBOLS: Array<[RegExp, string]> = [
  [/\\textless\s*\{\}/g, '<'],
  [/\\textgreater\s*\{\}/g, '>'],
  [/\\textasciitilde\s*\{\}/g, '~'],
  [/\\textasciicircum\s*\{\}/g, '^'],
  [/\\textbackslash\s*\{\}/g, ''],
  [/\\ldots\s*\{\}|\\ldots\b/g, '...'],
  [/\\([{}])/g, ''],
]

/** The visible words of a .tex body: no preamble, comments, braces or commands. */
function latexText(source: string): string {
  const start = source.indexOf('\\begin{document}')
  const body = (start === -1 ? source : source.slice(start + '\\begin{document}'.length)).split('\\end{document}')[0]
  return body
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^\\])%.*$/, '$1'))
    .map((line) => {
      // Spacing commands carry a length, not words: drop each with its argument,
      // or "\vspace{-4pt}" leaves "-4pt" in the text.
      let text = line.replace(/\\(?:vspace|hspace)\*?\s*\{[^{}]*\}/g, ' ')
      for (const [pattern, symbol] of SYMBOLS) text = text.replace(pattern, symbol)
      text = text
        // A link keeps its visible label, never its target.
        .replace(/\\href\s*\{[^{}]*\}\s*\{/g, '{')
        // Command names go before the braces do. The other way round, the braces
        // vanish first and "\resumeItem{Cut costs}" loses the word "Cut".
        .replace(/\\[a-zA-Z]+\*?/g, ' ')
      return stripMarkup(text)
    })
    .join('\n')
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '')
}

/** Normalise whitespace and apply the length limits. Also used for pasted text. */
export function tidyResumeText(text: string): string {
  const cleaned = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!cleaned) {
    throw new ImportError(
      'No text was found. If this is a scanned PDF, upload a text-based PDF or a Word file instead.'
    )
  }
  if (cleaned.length > MAX_RESUME_TEXT) {
    throw new ImportError(
      `That resume is ${cleaned.length.toLocaleString('en-US')} characters long; ` +
      `the limit is ${MAX_RESUME_TEXT.toLocaleString('en-US')}.`
    )
  }
  return cleaned
}

export async function extractResumeText(file: {
  name: string
  type: string
  bytes: Uint8Array
}): Promise<ExtractedText> {
  if (file.bytes.length === 0) throw new ImportError('That file is empty.')
  if (file.bytes.length > MAX_UPLOAD_BYTES) throw new ImportError('Resumes must be smaller than 4 MB.')

  const sourceFormat = detectFormat(file.name, file.type, file.bytes)
  const raw =
    sourceFormat === 'pdf'
      ? await pdfText(file.bytes)
      : sourceFormat === 'docx'
        ? await docxText(file.bytes)
        : sourceFormat === 'latex'
          ? latexText(decode(file.bytes))
          : decode(file.bytes)

  return { text: tidyResumeText(raw), sourceFormat }
}
