import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from '@/lib/db/schema'

/**
 * The database client, created on first use.
 *
 * Neon's HTTP driver sends each query as a single fetch, which suits serverless
 * functions: there is no connection pool to keep warm or exhaust. Creating it
 * lazily means a build, or a route that never touches the database, doesn't need
 * DATABASE_URL at all.
 */
function createDb(url: string) {
  return drizzle({ client: neon(url), schema })
}

let db: ReturnType<typeof createDb> | undefined

export function getDb() {
  if (!db) {
    const url = process.env.DATABASE_URL
    if (!url) {
      throw new Error('DATABASE_URL is not set. Add the Neon connection string to .env.local and to Vercel.')
    }
    db = createDb(url)
  }
  return db
}

export { schema }
