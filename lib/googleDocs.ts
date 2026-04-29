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
  changes: Array<{ original: string; proposed: string }>
): Promise<void> {
  if (changes.length === 0) return
  const auth = getOAuthClient(accessToken)
  const docs = google.docs({ version: 'v1', auth })
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