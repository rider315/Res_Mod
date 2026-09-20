import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'

/**
 * The browser extension's key to one account, and the jobs it picks up.
 *
 * A token is a random 32 bytes shown once and stored only as a hash, so the
 * table is useless to anyone who reads it. Verification looks the hash up
 * directly rather than scanning rows, which is both faster and the only way to
 * keep the comparison constant-time.
 */

export const TOKEN_PREFIX = 'cx_'
const TOKEN_BYTES = 32

export interface ExtensionToken {
  id: string
  label: string
  createdAt: Date
  lastUsedAt: Date | null
}

const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex')

/** A new key for this account. The plain token is returned once and never kept. */
export async function mintToken(userId: string, label: string): Promise<{ token: string; id: string }> {
  const token = TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('base64url')
  const [row] = await getDb()
    .insert(schema.extensionTokens)
    .values({ userId, tokenHash: hashToken(token), label: label.trim().slice(0, 80) || 'Browser extension' })
    .returning({ id: schema.extensionTokens.id })
  return { token, id: row.id }
}

/**
 * The account a token belongs to, or null.
 *
 * `lastUsedAt` is written on every accepted call. It is the only way an account
 * can be shown when its extension last spoke, and the only way a key that has
 * quietly gone unused can be told from one in daily service.
 */
export async function userForToken(token: string): Promise<{ userId: string; email: string; tokenId: string } | null> {
  if (!token.startsWith(TOKEN_PREFIX) || token.length < TOKEN_PREFIX.length + 32) return null
  const hash = hashToken(token)

  try {
    const [row] = await getDb()
      .select({
        tokenId: schema.extensionTokens.id,
        userId: schema.extensionTokens.userId,
        tokenHash: schema.extensionTokens.tokenHash,
        email: schema.users.email,
      })
      .from(schema.extensionTokens)
      .innerJoin(schema.users, eq(schema.users.id, schema.extensionTokens.userId))
      .where(and(eq(schema.extensionTokens.tokenHash, hash), isNull(schema.extensionTokens.revokedAt)))
      .limit(1)
    if (!row) return null

    // The lookup already matched on the hash; this is the belt for that brace,
    // and it costs nothing next to the query that found the row.
    const found = Buffer.from(row.tokenHash, 'utf8')
    const wanted = Buffer.from(hash, 'utf8')
    if (found.length !== wanted.length || !timingSafeEqual(found, wanted)) return null

    await getDb()
      .update(schema.extensionTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.extensionTokens.id, row.tokenId))

    return { userId: row.userId, email: row.email, tokenId: row.tokenId }
  } catch (err) {
    console.error('[extension] token lookup failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/** Every key this account has cut, newest first, without the tokens themselves. */
export async function listTokens(userId: string): Promise<ExtensionToken[]> {
  return getDb()
    .select({
      id: schema.extensionTokens.id,
      label: schema.extensionTokens.label,
      createdAt: schema.extensionTokens.createdAt,
      lastUsedAt: schema.extensionTokens.lastUsedAt,
    })
    .from(schema.extensionTokens)
    .where(and(eq(schema.extensionTokens.userId, userId), isNull(schema.extensionTokens.revokedAt)))
    .orderBy(desc(schema.extensionTokens.createdAt))
}

/** Retire a key. It keeps its row, so when it stopped working stays answerable. */
export async function revokeToken(userId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .update(schema.extensionTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.extensionTokens.id, id),
        eq(schema.extensionTokens.userId, userId),
        isNull(schema.extensionTokens.revokedAt)
      )
    )
    .returning({ id: schema.extensionTokens.id })
  return rows.length > 0
}

// ─── Captured jobs ───────────────────────────────────────────────────────────

export const JOB_STATUSES = ['saved', 'applied', 'interviewing', 'offer', 'closed'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export interface CapturedJob {
  id: string
  url: string
  source: string
  title: string
  company: string
  location: string
  description: string
  status: string
  score: number | null
  tailoringId: string | null
  capturedAt: Date
  updatedAt: Date
}

export interface JobCapture {
  url: string
  source: string
  title: string
  company: string
  location: string
  description: string
}

/**
 * Keep a posting the extension read, and hand back its id.
 *
 * Capturing the same URL again updates what is stored rather than adding a
 * second row: a posting re-read after an edit is the same job, and a list that
 * shows it twice is a list nobody trusts. The status and the tailoring already
 * on the row are left alone — those are the user's own progress, and a refresh
 * of the text must not undo them.
 */
export async function captureJob(userId: string, job: JobCapture): Promise<CapturedJob> {
  const values = { ...job, userId, updatedAt: new Date() }
  const [row] = await getDb()
    .insert(schema.capturedJobs)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.capturedJobs.userId, schema.capturedJobs.url],
      set: {
        title: values.title,
        company: values.company,
        location: values.location,
        description: values.description,
        source: values.source,
        updatedAt: values.updatedAt,
      },
    })
    .returning()
  return row
}

export async function getJob(userId: string, id: string): Promise<CapturedJob | null> {
  const [row] = await getDb()
    .select()
    .from(schema.capturedJobs)
    .where(and(eq(schema.capturedJobs.userId, userId), eq(schema.capturedJobs.id, id)))
    .limit(1)
  return row ?? null
}

/** This account's captured jobs, newest first. */
export async function listJobs(userId: string, limit = 100): Promise<CapturedJob[]> {
  return getDb()
    .select()
    .from(schema.capturedJobs)
    .where(eq(schema.capturedJobs.userId, userId))
    .orderBy(desc(schema.capturedJobs.capturedAt))
    .limit(limit)
}

/** The one already-captured job for a URL, so the panel can say "saved" on sight. */
export async function jobByUrl(userId: string, url: string): Promise<CapturedJob | null> {
  const [row] = await getDb()
    .select()
    .from(schema.capturedJobs)
    .where(and(eq(schema.capturedJobs.userId, userId), eq(schema.capturedJobs.url, url)))
    .limit(1)
  return row ?? null
}

export async function updateJob(
  userId: string,
  id: string,
  patch: Partial<Pick<CapturedJob, 'status' | 'score' | 'tailoringId'>>
): Promise<CapturedJob | null> {
  const [row] = await getDb()
    .update(schema.capturedJobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(schema.capturedJobs.userId, userId), eq(schema.capturedJobs.id, id)))
    .returning()
  return row ?? null
}

export async function deleteJob(userId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(schema.capturedJobs)
    .where(and(eq(schema.capturedJobs.userId, userId), eq(schema.capturedJobs.id, id)))
    .returning({ id: schema.capturedJobs.id })
  return rows.length > 0
}

/** How many jobs this account has kept, for the cap that stops a runaway extension. */
export async function countJobs(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.capturedJobs)
    .where(eq(schema.capturedJobs.userId, userId))
  return row?.count ?? 0
}

export const MAX_CAPTURED_JOBS = 500
