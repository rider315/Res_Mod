import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

/**
 * Encrypting secrets the app keeps in its database, such as the AI key the owner
 * saves for Chills AI: AES-256-GCM, with a key derived from NEXTAUTH_SECRET, so a
 * copy of the database alone doesn't reveal them.
 *
 * Changing NEXTAUTH_SECRET makes values saved before it unreadable. decryptSecret
 * then returns null, and the owner saves the setting again.
 */

const VERSION = 'v1'

function encryptionKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('NEXTAUTH_SECRET is not set, so secrets cannot be encrypted.')
  return Buffer.from(hkdfSync('sha256', secret, 'resmod', 'app-settings-encryption', 32))
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.')
}

/** The plain value, or null when it is malformed, was tampered with, or was sealed under another secret. */
export function decryptSecret(sealed: string): string | null {
  try {
    const [version, iv, tag, data] = sealed.split('.')
    if (version !== VERSION || !iv || !tag || !data) return null
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'), { authTagLength: 16 })
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
