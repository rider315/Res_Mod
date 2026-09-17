import { and, count, desc, eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { isResumeId } from '@/lib/db/resumes'

/**
 * Data access for cover letters. Every query is scoped by the signed-in user's
 * id as well as the row id, as for resumes and tailored copies.
 */

const columns = {
  id: schema.coverLetters.id,
  tailoringId: schema.coverLetters.tailoringId,
  tone: schema.coverLetters.tone,
  body: schema.coverLetters.body,
  createdAt: schema.coverLetters.createdAt,
  updatedAt: schema.coverLetters.updatedAt,
}

export type CoverLetterRow = {
  id: string
  tailoringId: string
  tone: string
  body: string
  createdAt: Date
  updatedAt: Date
}

/** The newest letter for a tailored copy, and how many have been written for it. */
export async function latestCoverLetter(
  userId: string,
  tailoringId: string
): Promise<{ letter: CoverLetterRow | null; written: number }> {
  if (!isResumeId(tailoringId)) return { letter: null, written: 0 }
  const scope = and(eq(schema.coverLetters.tailoringId, tailoringId), eq(schema.coverLetters.userId, userId))
  const [rows, [total]] = await Promise.all([
    getDb().select(columns).from(schema.coverLetters).where(scope).orderBy(desc(schema.coverLetters.createdAt)).limit(1),
    getDb().select({ written: count() }).from(schema.coverLetters).where(scope),
  ])
  return { letter: rows[0] ?? null, written: Number(total?.written ?? 0) }
}

export async function saveCoverLetter(
  userId: string,
  input: { tailoringId: string; tone: string; body: string }
): Promise<CoverLetterRow> {
  const [row] = await getDb()
    .insert(schema.coverLetters)
    .values({ userId, ...input })
    .returning(columns)
  return row
}

export async function getCoverLetter(userId: string, id: string): Promise<CoverLetterRow | null> {
  if (!isResumeId(id)) return null
  const [row] = await getDb()
    .select(columns)
    .from(schema.coverLetters)
    .where(and(eq(schema.coverLetters.id, id), eq(schema.coverLetters.userId, userId)))
    .limit(1)
  return row ?? null
}

export async function updateCoverLetter(userId: string, id: string, body: string): Promise<CoverLetterRow | null> {
  if (!isResumeId(id)) return null
  const [row] = await getDb()
    .update(schema.coverLetters)
    .set({ body, updatedAt: new Date() })
    .where(and(eq(schema.coverLetters.id, id), eq(schema.coverLetters.userId, userId)))
    .returning(columns)
  return row ?? null
}
