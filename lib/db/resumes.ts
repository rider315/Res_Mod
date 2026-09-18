import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { ResumeDoc, SourceFormat } from '@/lib/resume-doc'

/**
 * Data access for users' own resumes.
 *
 * Every query that touches a resume is scoped by the signed-in user's id as well
 * as the resume id, so knowing or guessing an id never reaches another
 * account's row. Owner profile resumes (user_id null) are out of reach here.
 */

export const MAX_RESUMES_PER_USER = 20

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A malformed id is simply "not found" — Postgres would reject it with an error. */
export function isResumeId(id: string): boolean {
  return UUID.test(id)
}

/** Create the account row a resume hangs off, or refresh its email and name. */
/**
 * Make sure the account exists, and say whether this call is what created it.
 *
 * `xmax = 0` is Postgres's own way of telling an insert from an update in a
 * single upsert: a freshly inserted row has no updating transaction stamped on
 * it. That is the only reliable moment to call someone new — everything else
 * fires again every time they come back.
 */
export async function ensureUser(user: { id: string; email: string; name: string | null }): Promise<{ created: boolean }> {
  const [row] = await getDb()
    .insert(schema.users)
    .values(user)
    .onConflictDoUpdate({ target: schema.users.id, set: { email: user.email, name: user.name } })
    .returning({ created: sql<boolean>`xmax = 0` })
  return { created: row?.created === true }
}

const summaryColumns = {
  id: schema.resumes.id,
  title: schema.resumes.title,
  sourceFormat: schema.resumes.sourceFormat,
  updatedAt: schema.resumes.updatedAt,
}

export async function listResumes(userId: string) {
  return getDb()
    .select(summaryColumns)
    .from(schema.resumes)
    .where(eq(schema.resumes.userId, userId))
    .orderBy(desc(schema.resumes.updatedAt))
}

export async function countResumes(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.resumes)
    .where(eq(schema.resumes.userId, userId))
  return row?.count ?? 0
}

export async function getResume(userId: string, id: string) {
  if (!isResumeId(id)) return null
  const [row] = await getDb()
    .select()
    .from(schema.resumes)
    .where(and(eq(schema.resumes.id, id), eq(schema.resumes.userId, userId)))
    .limit(1)
  return row ?? null
}

export async function createResume(
  userId: string,
  input: { title: string; sourceFormat: SourceFormat; doc: ResumeDoc; latex: string }
) {
  const [row] = await getDb()
    .insert(schema.resumes)
    .values({ userId, ...input })
    .returning(summaryColumns)
  return row
}

export async function updateResume(
  userId: string,
  id: string,
  input: { title: string; doc: ResumeDoc; latex: string }
) {
  if (!isResumeId(id)) return null
  const [row] = await getDb()
    .update(schema.resumes)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(schema.resumes.id, id), eq(schema.resumes.userId, userId)))
    .returning(summaryColumns)
  return row ?? null
}

export async function deleteResume(userId: string, id: string): Promise<boolean> {
  if (!isResumeId(id)) return false
  const rows = await getDb()
    .delete(schema.resumes)
    .where(and(eq(schema.resumes.id, id), eq(schema.resumes.userId, userId)))
    .returning({ id: schema.resumes.id })
  return rows.length > 0
}
