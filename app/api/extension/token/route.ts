import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/require-auth'
import { listTokens, mintToken, revokeToken } from '@/lib/db/extension'
import { ensureUser } from '@/lib/db/resumes'
import { allowedExtensionIds, connectTarget, deliveryUrl } from '@/lib/extension/connect'
import { checkRateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/security/rate-limit'

/**
 * Cutting and retiring the extension's keys.
 *
 * Deliberately session-only: `requireAuth` denies extension tokens unless a
 * route asks for them, and this one never does. A key that could mint another
 * key would outlive its own revocation, which would make the revoke button a
 * decoration.
 */

const mintSchema = z.object({
  redirectUri: z.string().max(2_000),
  state: z.string().max(128),
  label: z.string().trim().max(80).default('Browser extension'),
})

const fail = (status: number, error: string) => NextResponse.json({ error }, { status })

/** The keys this account has out, so they can be seen and retired. */
export async function GET() {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  return NextResponse.json({ tokens: await listTokens(auth.userId) })
}

/**
 * Mint a key and say where to send it. The token comes back once; it is stored
 * only as a hash, so a lost one is replaced rather than recovered.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const limited = await checkRateLimit(RATE_LIMITS.extensionKey, auth.userId)
  if (!limited.ok) return tooManyRequests(limited, 'Too many extension keys were made in a short time.')

  const parsed = mintSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? 'Invalid request')

  const target = connectTarget(parsed.data.redirectUri, parsed.data.state, allowedExtensionIds())
  if (!target) return fail(400, 'That is not an address Chills will send an extension key to.')

  try {
    await ensureUser({ id: auth.userId, email: auth.email, name: auth.userName || null })
    const { token } = await mintToken(auth.userId, parsed.data.label)
    return NextResponse.json({ redirectTo: deliveryUrl(target, token) })
  } catch (err) {
    console.error('[extension/token] mint failed:', err instanceof Error ? err.message : err)
    return fail(500, 'That key could not be made right now.')
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const limited = await checkRateLimit(RATE_LIMITS.extensionKey, auth.userId)
  if (!limited.ok) return tooManyRequests(limited, 'Too many extension keys were changed in a short time.')

  const id = req.nextUrl.searchParams.get('id')?.trim() ?? ''
  if (!id) return fail(400, 'Which key?')
  if (!(await revokeToken(auth.userId, id))) return fail(404, 'That key is already gone.')
  return NextResponse.json({ ok: true })
}
