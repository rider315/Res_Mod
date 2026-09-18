import { and, asc, count, desc, eq, gte, ilike, inArray, lt, or, sql } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { LIMITS } from '@/lib/outreach/model'
import type { RecruiterRow } from '@/lib/outreach/recruiter-import'

/**
 * The recruiter directory: the contacts Chills publishes itself, so an account
 * with nobody to write to still has somewhere to start.
 *
 * The caps live here rather than in the screens, because they are what keeps the
 * list worth having. One recruiter can be taken by only so many accounts — the
 * same pitch arriving from hundreds of strangers is what turns a good contact
 * into a spam report — and an account can take only so many a week. Anyone who
 * asks to be left alone is suppressed and can never be taken again.
 */

export interface DirectoryEntry {
  id: string
  name: string
  company: string
  title: string
  field: string
  location: string
  batch: string
  /** Whether this account already has them. */
  taken: boolean
  /** Places left before this contact is closed to new accounts. */
  spotsLeft: number
}

export interface DirectoryFilter {
  field?: string
  search?: string
  /** Only the newest batch. */
  newOnly?: boolean
  limit?: number
  offset?: number
}

/** An address is never sent to the browser until the account has taken it. */
const LISTED = {
  id: schema.directoryRecruiters.id,
  name: schema.directoryRecruiters.name,
  company: schema.directoryRecruiters.company,
  title: schema.directoryRecruiters.title,
  field: schema.directoryRecruiters.field,
  location: schema.directoryRecruiters.location,
  batch: schema.directoryRecruiters.batch,
  takenCount: schema.directoryRecruiters.takenCount,
}

/** Open to new accounts: not suppressed, and not already taken by too many. */
const open = () =>
  and(
    eq(schema.directoryRecruiters.suppressed, false),
    lt(schema.directoryRecruiters.takenCount, LIMITS.directoryTakesPerRecruiter)
  )

export async function latestBatch(): Promise<string | null> {
  const [row] = await getDb()
    .select({ batch: schema.directoryRecruiters.batch })
    .from(schema.directoryRecruiters)
    .orderBy(desc(schema.directoryRecruiters.batch))
    .limit(1)
  return row?.batch ?? null
}

/** The fields on offer, for the filter, with how many are open in each. */
export async function directoryFields(): Promise<Array<{ field: string; open: number }>> {
  const rows = await getDb()
    .select({ field: schema.directoryRecruiters.field, open: count() })
    .from(schema.directoryRecruiters)
    .where(open())
    .groupBy(schema.directoryRecruiters.field)
    .orderBy(asc(schema.directoryRecruiters.field))
  return rows.filter((row) => row.field).map((row) => ({ field: row.field, open: Number(row.open) }))
}

export async function listDirectory(userId: string, filter: DirectoryFilter = {}): Promise<DirectoryEntry[]> {
  const limit = Math.min(Math.max(filter.limit ?? 60, 1), 100)
  const conditions = [open()]
  if (filter.field) conditions.push(eq(schema.directoryRecruiters.field, filter.field))
  if (filter.newOnly) {
    const batch = await latestBatch()
    if (batch) conditions.push(eq(schema.directoryRecruiters.batch, batch))
  }
  if (filter.search) {
    const needle = `%${filter.search.replace(/[%_]/g, '')}%`
    conditions.push(
      or(
        ilike(schema.directoryRecruiters.company, needle),
        ilike(schema.directoryRecruiters.name, needle),
        ilike(schema.directoryRecruiters.title, needle),
        ilike(schema.directoryRecruiters.location, needle)
      )!
    )
  }

  const rows = await getDb()
    .select({ ...LISTED, takenAt: schema.directoryClaims.takenAt })
    .from(schema.directoryRecruiters)
    .leftJoin(
      schema.directoryClaims,
      and(eq(schema.directoryClaims.recruiterId, schema.directoryRecruiters.id), eq(schema.directoryClaims.userId, userId))
    )
    .where(and(...conditions))
    // The least-contacted first, so the load spreads instead of piling on page one.
    .orderBy(asc(schema.directoryRecruiters.takenCount), desc(schema.directoryRecruiters.addedAt))
    .limit(limit)
    .offset(Math.max(filter.offset ?? 0, 0))

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    company: row.company,
    title: row.title,
    field: row.field,
    location: row.location,
    batch: row.batch,
    taken: row.takenAt !== null,
    spotsLeft: Math.max(0, LIMITS.directoryTakesPerRecruiter - row.takenCount),
  }))
}

/** How many this account has taken in the last seven days. */
export async function takenThisWeek(userId: string): Promise<number> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const [row] = await getDb()
    .select({ n: count() })
    .from(schema.directoryClaims)
    .where(and(eq(schema.directoryClaims.userId, userId), gte(schema.directoryClaims.takenAt, since)))
  return Number(row?.n ?? 0)
}

export interface TakeResult {
  /** Rows now in the account's own recruiter list. */
  taken: RecruiterRow[]
  /** Asked for but not given: already taken, closed, suppressed, or over the weekly cap. */
  skipped: number
  weeklyLeft: number
}

/**
 * Take published recruiters into an account's own list.
 *
 * The UPDATE is the gate, not a check before it. Postgres re-evaluates an
 * UPDATE's WHERE against the latest version of any row another transaction is
 * touching, so `taken_count < cap` still holds when two accounts take the last
 * place at once — a plain SELECT-then-write would let both through. The claim
 * rows follow from whatever the update actually changed, so a contact is never
 * copied without being counted, and its primary key stops the same account
 * taking one twice.
 */
export async function takeFromDirectory(userId: string, ids: string[]): Promise<TakeResult> {
  const weeklyLeft = Math.max(0, LIMITS.directoryPerWeek - (await takenThisWeek(userId)))
  const wanted = Array.from(new Set(ids)).slice(0, weeklyLeft)
  if (wanted.length === 0) return { taken: [], skipped: ids.length, weeklyLeft }

  const db = getDb()
  const claimed = await db.execute(sql`
    with bumped as (
      update directory_recruiters as d
      set taken_count = taken_count + 1
      where d.id = any(${sql.param(wanted)}::uuid[])
        and d.suppressed = false
        and d.taken_count < ${LIMITS.directoryTakesPerRecruiter}
        and not exists (
          select 1 from directory_claims c where c.user_id = ${userId} and c.recruiter_id = d.id
        )
      returning d.id, d.email, d.name, d.company, d.title
    ),
    claims as (
      insert into directory_claims (user_id, recruiter_id)
      select ${userId}, id from bumped
      on conflict (user_id, recruiter_id) do nothing
      returning recruiter_id
    )
    select b.id, b.email, b.name, b.company, b.title from bumped b
    where b.id in (select recruiter_id from claims)`)

  const rows = (claimed.rows ?? []) as Array<{ email: string; name: string; company: string; title: string }>
  return {
    taken: rows.map((row) => ({ email: row.email, name: row.name ?? '', company: row.company ?? '', title: row.title ?? '' })),
    skipped: ids.length - rows.length,
    weeklyLeft: weeklyLeft - rows.length,
  }
}

// ─── The owner's side ────────────────────────────────────────────────────────

export interface PublishSummary {
  added: number
  /** Already published, so left alone. */
  duplicates: number
  batch: string
}

/** Publish a week's list. An address already there keeps its count and its batch. */
export async function publishBatch(rows: RecruiterRow[], batch: string, field: string, source: string): Promise<PublishSummary> {
  if (rows.length === 0) return { added: 0, duplicates: 0, batch }
  const seen = new Set<string>()
  const values = rows
    .filter((row) => {
      const key = row.email.trim().toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((row) => ({
      email: row.email.trim().toLowerCase(),
      name: row.name.slice(0, 120),
      company: row.company.slice(0, 160),
      title: row.title.slice(0, 120),
      field: field.slice(0, 60),
      location: '',
      batch,
      source: source.slice(0, 60),
    }))

  const inserted = await getDb()
    .insert(schema.directoryRecruiters)
    .values(values)
    .onConflictDoNothing({ target: schema.directoryRecruiters.email })
    .returning({ id: schema.directoryRecruiters.id })

  return { added: inserted.length, duplicates: values.length - inserted.length, batch }
}

/**
 * Switch a contact off for good. Used when a recruiter asks not to be written
 * to, which has to be honoured everywhere and immediately, and when an address
 * turns out to be wrong.
 */
export async function suppressContacts(emails: string[], reason: string): Promise<number> {
  const keys = emails.map((email) => email.trim().toLowerCase()).filter(Boolean)
  if (keys.length === 0) return 0
  const rows = await getDb()
    .update(schema.directoryRecruiters)
    .set({ suppressed: true, suppressedReason: reason.slice(0, 200) })
    .where(inArray(schema.directoryRecruiters.email, keys))
    .returning({ id: schema.directoryRecruiters.id })
  return rows.length
}

/** What the owner sees: the size of the list, and what is closed off. */
export async function directoryStats(): Promise<{ total: number; open: number; suppressed: number; batches: number }> {
  const [row] = await getDb()
    .select({
      total: count(),
      open: sql<number>`count(*) filter (where suppressed = false and taken_count < ${LIMITS.directoryTakesPerRecruiter})`,
      suppressed: sql<number>`count(*) filter (where suppressed = true)`,
      batches: sql<number>`count(distinct batch)`,
    })
    .from(schema.directoryRecruiters)
  return {
    total: Number(row?.total ?? 0),
    open: Number(row?.open ?? 0),
    suppressed: Number(row?.suppressed ?? 0),
    batches: Number(row?.batches ?? 0),
  }
}
