import { google } from 'googleapis'
import { docs_v1 } from 'googleapis'

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

export async function applyChangesToDocument(
  accessToken: string,
  documentId: string,
  changes: Array<{ original: string; proposed: string; sectionTitle?: string }>
): Promise<void> {
  if (changes.length === 0) return
  const auth = getOAuthClient(accessToken)
  const docs = google.docs({ version: 'v1', auth })

  // Step 1: Apply all text replacements
  const requests = changes.map((change) => ({
    replaceAllText: {
      containsText: { text: change.original, matchCase: true },
      replaceText: change.proposed,
    },
  }))
  await docs.documents.batchUpdate({
    documentId,
    requestBody: { requests },
  })

  // Step 2: Fix formatting in Skills / Soft Skills sections
  // Google Docs replaceAllText preserves original bold formatting.
  // We want: labels ("Languages:", "1.") bold, items after them NOT bold.
  const skillChanges = changes.filter(
    (c) => c.sectionTitle && /skill/i.test(c.sectionTitle)
  )
  if (skillChanges.length === 0) return

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

  if (styleRequests.length > 0) {
    await docs.documents.batchUpdate({
      documentId,
      requestBody: { requests: styleRequests },
    })
  }
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