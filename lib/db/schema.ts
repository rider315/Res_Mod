import { sql } from 'drizzle-orm'
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

/**
 * Database schema.
 *
 * Change a table here, then run `npm run db:generate` to write the migration
 * into drizzle/ and `npm run db:migrate` to apply it.
 */

export const users = pgTable('users', {
  /** Google's stable account id (the session `sub`). */
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Owner resumes and user resumes share one table. An owner resume is keyed by the
 * profile it belongs to (lib/profiles), a user resume by the account that
 * imported it, and the check constraint makes exactly one of those set — so a
 * profile's resume can never be reached through a user id, or the other way round.
 */
export const resumes = pgTable(
  'resumes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The account that imported it; null for owner profile resumes. */
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** The owner profile it belongs to, e.g. "gaurav"; null for user resumes. */
    profileId: text('profile_id'),
    title: text('title').notNull(),
    /** What it was imported from: latex, pdf, docx or text. */
    sourceFormat: text('source_format').notNull(),
    /** The structured resume the LaTeX is rendered from; null for hand-written .tex. */
    doc: jsonb('doc'),
    latex: text('latex').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('resumes_profile_id_key').on(table.profileId).where(sql`profile_id is not null`),
    index('resumes_user_id_idx').on(table.userId),
    check('resumes_one_owner', sql`(user_id is null) <> (profile_id is null)`),
  ]
)
