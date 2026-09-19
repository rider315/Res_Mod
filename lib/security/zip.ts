import JSZip from 'jszip'

/**
 * Opening uploaded zip files (.xlsx workbooks, .docx documents) without letting
 * a zip bomb fill memory.
 *
 * A zip entry declares how large it inflates to, but the declaration can lie: a
 * few megabytes of deflated zeros claim to be small and inflate to gigabytes.
 * So entries are inflated as a stream and stopped the moment they pass their
 * budget, rather than inflated whole and measured afterwards. Server-only.
 */

export class ZipTooLargeError extends Error {
  constructor() {
    super('That file expands to more than Chills will read.')
    this.name = 'ZipTooLargeError'
  }
}

/** Inflate one entry, keeping its bytes or only counting them, and stop past `maxBytes`. */
function inflate(entry: JSZip.JSZipObject, maxBytes: number, keep: boolean): Promise<{ size: number; bytes: Buffer }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const stream = entry.nodeStream('nodebuffer') as NodeJS.ReadableStream & { destroy?: () => void }
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        // Stops the inflating too: nothing asks the stream for more.
        stream.destroy?.()
        reject(new ZipTooLargeError())
        return
      }
      if (keep) chunks.push(chunk)
    })
    stream.on('error', reject)
    stream.on('end', () => resolve({ size, bytes: Buffer.concat(chunks) }))
  })
}

/** One entry's contents as text, refusing to inflate more than `maxBytes`. */
export async function readEntryCapped(entry: JSZip.JSZipObject, maxBytes: number): Promise<string> {
  return (await inflate(entry, maxBytes, true)).bytes.toString('utf8')
}

/** Throws ZipTooLargeError unless every entry of the archive, together, inflates within `maxBytes`. */
export async function assertZipWithin(bytes: Uint8Array, maxBytes: number): Promise<void> {
  const zip = await JSZip.loadAsync(bytes)
  let total = 0
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    total += (await inflate(entry, maxBytes - total, false)).size
  }
}
