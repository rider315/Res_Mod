import { google } from 'googleapis'
import { docs_v1 } from 'googleapis'
import { resolveChanges } from '@/lib/text-match'

function getOAuthClient(accessToken: string) {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  )
  auth.setCredentials({ access_token: accessToken })
  return auth
}

export function extractDocumentId(url: string): string | null {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

export async function getDocument(
  accessToken: string,
  documentId: string
): Promise<docs_v1.Schema$Document> {
  const auth = getOAuthClient(accessToken)
  const docs = google.docs({ version: 'v1', auth })
  const response = await docs.documents.get({ documentId })
  return response.data
}

export async function copyDocument(
  accessToken: string,
  documentId: string,
  title: string
): Promise<{ id: string; url: string }> {
  const auth = getOAuthClient(accessToken)
  const drive = google.drive({ version: 'v3', auth })
  const response = await drive.files.copy({
    fileId: documentId,
    requestBody: { name: `[OPTIMIZED] ${title}` },
  })
  const id = response.data.id!
  return {
    id,
    url: `https://docs.google.com/document/d/${id}/edit`,
  }
}

export async function renameDocument(
  accessToken: string,
  documentId: string,
  newName: string
): Promise<void> {
  const auth = getOAuthClient(accessToken)
  const drive = google.drive({ version: 'v3', auth })
  await drive.files.update({
    fileId: documentId,
    requestBody: { name: newName },
  })
}

export interface ApplyChangesResult {
  requested: number
  /** Changes whose text was actually found and replaced in the document. */
  applied: number
  /** Changes whose text genuinely isn't in the document. */
  unmatched: string[]
  /** Changes skipped because another change rewrites overlapping text. */
  overlapping: string[]
  /** How many needed whitespace/punctuation-tolerant matching to be found. */
  recovered: number
}

/**
 * The document's text stream, exactly as `replaceAllText` sees it.
 *
 * Text runs are concatenated with no added separators — each paragraph's final
 * run already ends in a newline — so offsets line up with the real content.
 */
export function extractDocumentText(doc: docs_v1.Schema$Document): string {
  const parts: string[] = []

  const readParagraph = (para: docs_v1.Schema$Paragraph) => {
    for (const el of para.elements ?? []) {
      if (el.textRun?.content) parts.push(el.textRun.content)
    }
  }

  const walk = (content: docs_v1.Schema$StructuralElement[]) => {
    for (const element of content) {
      if (element.paragraph) readParagraph(element.paragraph)
      // Resumes frequently lay out contact details or skills inside a table.
      for (const row of element.table?.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) {
          walk(cell.content ?? [])
        }
      }
    }
  }

  walk(doc.body?.content ?? [])
  return parts.join('')
}

export async function applyChangesToDocument(
  accessToken: string,
  documentId: string,
  changes: Array<{ original: string; proposed: string; sectionTitle?: string; boldKeywords?: string[] }>
): Promise<ApplyChangesResult> {
  if (changes.length === 0)
    return { requested: 0, applied: 0, unmatched: [], overlapping: [], recovered: 0 }

  const auth = getOAuthClient(accessToken)
  const docs = google.docs({ version: 'v1', auth })

  // Step 1: Resolve each change against the document's real text before touching
  // anything. Models normalize whitespace and punctuation when they quote, so an
  // exact `replaceAllText` match fails on text that is plainly there — those
  // changes used to be dropped silently. resolveChanges recovers the true
  // substring and discards changes that would overwrite each other.
  const preDoc = await docs.documents.get({ documentId })
  const documentText = extractDocumentText(preDoc.data)
  const { resolved, notFound, overlapping } = resolveChanges(documentText, changes)

  const recovered = resolved.filter((c) => c.how !== 'exact').length
  if (recovered > 0) {
    console.log(`[googleDocs] Recovered ${recovered} change(s) via whitespace/punctuation-tolerant matching`)
  }
  for (const miss of notFound) {
    console.warn(`[googleDocs] Not found in document: "${miss.original.slice(0, 80)}"`)
  }
  for (const clash of overlapping) {
    console.warn(`[googleDocs] Skipped (overlaps another change): "${clash.original.slice(0, 80)}"`)
  }

  const result: ApplyChangesResult = {
    requested: changes.length,
    applied: 0,
    unmatched: notFound.map((c) => c.original),
    overlapping: overlapping.map((c) => c.original),
    recovered,
  }

  if (resolved.length === 0) return result

  // Step 2: Apply the replacements. resolveChanges already ordered them
  // longest-first and removed overlaps, so no request can clobber another.
  const replaceResponse = await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: resolved.map((change) => ({
        replaceAllText: {
          containsText: { text: change.resolvedOriginal, matchCase: true },
          replaceText: change.proposed,
        },
      })),
    },
  })

  const replies = replaceResponse.data.replies ?? []
  resolved.forEach((change, i) => {
    const occurrences = replies[i]?.replaceAllText?.occurrencesChanged ?? 0
    if (occurrences) result.applied++
    else result.unmatched.push(change.original)
  })

  // Step 3: Fix formatting in Skills / Soft Skills sections
  // Google Docs replaceAllText preserves original bold formatting.
  // We want: labels ("Languages:", "1.") bold, items after them NOT bold.
  const skillChanges = changes.filter(
    (c) => c.sectionTitle && /skill/i.test(c.sectionTitle)
  )
  const boldChanges = changes.filter(
    (c) => c.boldKeywords && c.boldKeywords.length > 0
  )
  if (skillChanges.length === 0 && boldChanges.length === 0) return result

  // Re-fetch document to get current text positions
  const docResponse = await docs.documents.get({ documentId })
  const body = docResponse.data.body?.content ?? []

  const styleRequests: Array<{
    updateTextStyle: {
      range: { startIndex: number; endIndex: number }
      textStyle: { bold: boolean }
      fields: string
    }
  }> = []

  for (const element of body) {
    const para = element.paragraph
    if (!para?.elements) continue

    // Reconstruct full paragraph text (with original whitespace)
    const paraText = para.elements
      .map((el) => el.textRun?.content ?? '')
      .join('')
    const paraTextTrimmed = paraText.trim()

    if (!paraTextTrimmed) continue

    // Check if this paragraph matches any proposed text from Skills/Soft Skills
    const matchesSkill = skillChanges.some((c) => {
      const proposed = c.proposed.trim()
      return paraTextTrimmed.includes(proposed) || proposed.includes(paraTextTrimmed)
    })

    if (!matchesSkill) continue

    // Get absolute start/end indices of this paragraph's content
    const paraStartIndex = para.elements[0]?.startIndex
    const paraEndIndex = para.elements[para.elements.length - 1]?.endIndex
    if (paraStartIndex == null || paraEndIndex == null) continue

    // Handle Google Docs list items (numbered lists like Soft Skills)
    // The "1." marker is auto-generated and inherits bold from the first character.
    // Do NOT modify formatting for list items — replaceAllText already preserves
    // the original document formatting, which keeps the numbers and text consistent.
    if (para.bullet) continue

    // Determine the label boundary (for non-list paragraphs)
    // Pattern 1: "Languages: ..." or "Technologies & Tools : ..."
    const colonMatch = paraText.match(/^(\s*)([^:]+:\s*)/)
    // Pattern 2: "1. ..." or "2. ..." (plain-text numbered items, allowing leading whitespace)
    const numberMatch = paraText.match(/^(\s*)(\d+\.\s*)/)

    if (colonMatch) {
      const labelStart = paraStartIndex + (colonMatch[1]?.length ?? 0)
      const labelEnd = labelStart + colonMatch[2].length
      // Bold the label part (e.g. "Languages: ")
      styleRequests.push({
        updateTextStyle: {
          range: { startIndex: labelStart, endIndex: labelEnd },
          textStyle: { bold: true },
          fields: 'bold',
        },
      })
      // Unbold the items part (e.g. "Java, Python, ...")
      if (labelEnd < paraEndIndex) {
        styleRequests.push({
          updateTextStyle: {
            range: { startIndex: labelEnd, endIndex: paraEndIndex },
            textStyle: { bold: false },
            fields: 'bold',
          },
        })
      }
    } else if (numberMatch) {
      const prefixStart = paraStartIndex + (numberMatch[1]?.length ?? 0)
      const prefixEnd = prefixStart + numberMatch[2].length
      // Bold the number prefix (e.g. "1. ")
      styleRequests.push({
        updateTextStyle: {
          range: { startIndex: prefixStart, endIndex: prefixEnd },
          textStyle: { bold: true },
          fields: 'bold',
        },
      })
      // Unbold the skill text (e.g. "Communication Skills")
      if (prefixEnd < paraEndIndex) {
        styleRequests.push({
          updateTextStyle: {
            range: { startIndex: prefixEnd, endIndex: paraEndIndex },
            textStyle: { bold: false },
            fields: 'bold',
          },
        })
      }
    } else {
      // No label found — unbold entire paragraph
      styleRequests.push({
        updateTextStyle: {
          range: { startIndex: paraStartIndex, endIndex: paraEndIndex },
          textStyle: { bold: false },
          fields: 'bold',
        },
      })
    }
  }

  // Step 4: Bold specific keywords in revamped bullet points
  if (boldChanges.length > 0) {
    // Re-fetch document to get up-to-date positions (after step 1 replacements)
    const boldDocResponse = skillChanges.length > 0
      ? await docs.documents.get({ documentId })  // re-fetch after skill formatting
      : docResponse  // reuse if no skill formatting was applied
    const boldBody = boldDocResponse.data.body?.content ?? []

    for (const element of boldBody) {
      const para = element.paragraph
      if (!para?.elements) continue

      const paraText = para.elements
        .map((el) => el.textRun?.content ?? '')
        .join('')
      const paraTextTrimmed = paraText.trim()
      if (!paraTextTrimmed) continue

      const paraStartIndex = para.elements[0]?.startIndex
      if (paraStartIndex == null) continue

      // Check if this paragraph contains proposed text from a bold change
      for (const change of boldChanges) {
        const proposed = change.proposed.trim()
        if (!paraTextTrimmed.includes(proposed) && !proposed.includes(paraTextTrimmed)) continue

        // Found a matching paragraph — bold each keyword
        for (const keyword of change.boldKeywords!) {
          const kwIdx = paraText.indexOf(keyword)
          if (kwIdx === -1) continue
          const kwStart = paraStartIndex + kwIdx
          const kwEnd = kwStart + keyword.length
          styleRequests.push({
            updateTextStyle: {
              range: { startIndex: kwStart, endIndex: kwEnd },
              textStyle: { bold: true },
              fields: 'bold',
            },
          })
        }
      }
    }
  }

  if (styleRequests.length > 0) {
    await docs.documents.batchUpdate({
      documentId,
      requestBody: { requests: styleRequests },
    })
  }

  return result
}

export async function exportDocAsPdf(
  accessToken: string,
  documentId: string
): Promise<Buffer> {
  const auth = getOAuthClient(accessToken)
  const drive = google.drive({ version: 'v3', auth })
  const response = await drive.files.export(
    { fileId: documentId, mimeType: 'application/pdf' },
    { responseType: 'arraybuffer' }
  )
  return Buffer.from(response.data as ArrayBuffer)
}