import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { isResumeId } from '@/lib/db/resumes'
import type { HistoryCoverage } from '@/lib/tailor/history'

/**
 * Data access for the tailoring history. Like resumes, every query is scoped by
 * the signed-in user's id as well as the row id.
 */

/** Tailored copies kept per account. Saving another removes the oldest. */
export const MAX_TAILORINGS_PER_USER = 50

const summaryColumns = {
  id: schema.tailorings.id,
  resumeId: schema.tailorings.resumeId,
  resumeTitle: schema.tailorings.resumeTitle,
  jobTitle: schema.tailorings.jobTitle,
  company: schema.tailorings.company,
  level: schema.tailorings.level,
  appliedCount: schema.tailorings.appliedCount,
  coverage: schema.tailorings.coverage,
  createdAt: schema.tailorings.createdAt,
}

export interface NewTailoring {
  resumeId: string
  resumeTitle: string
  jobTitle: string
  company: string
  level: string
  jobDescription: string
  changes: Array<{ original: string; proposed: string }>
  appliedCount: number
  coverage: HistoryCoverage | null
  latex: string
}

export async function saveTailoring(userId: string, input: NewTailoring): Promise<string> {
  const db = getDb()
  const [row] = await db
    .insert(schema.tailorings)
    .values({ userId, ...input })
    .returning({ id: schema.tailorings.id })
  await db.execute(sql`
    delete from tailorings
    where user_id = ${userId} and id not in (
      select id from tailorings where user_id = ${userId} order by created_at desc limit ${MAX_TAILORINGS_PER_USER}
    )`)
  return row.id
}

export async function listTailorings(userId: string) {
  return getDb()
    .select(summaryColumns)
    .from(schema.tailorings)
    .where(eq(schema.tailorings.userId, userId))
    .orderBy(desc(schema.tailorings.createdAt))
}

export async function getTailoring(userId: string, id: string) {
  if (!isResumeId(id)) return null
  const [row] = await getDb()
    .select({
      ...summaryColumns,
      jobDescription: schema.tailorings.jobDescription,
      changes: schema.tailorings.changes,
      latex: schema.tailorings.latex,
    })
    .from(schema.tailorings)
    .where(and(eq(schema.tailorings.id, id), eq(schema.tailorings.userId, userId)))
    .limit(1)
  return row ?? null
}

export async function deleteTailoring(userId: string, id: string): Promise<boolean> {
  if (!isResumeId(id)) return false
  const rows = await getDb()
    .delete(schema.tailorings)
    .where(and(eq(schema.tailorings.id, id), eq(schema.tailorings.userId, userId)))
    .returning({ id: schema.tailorings.id })
  return rows.length > 0
}
