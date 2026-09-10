/*
 * Apply pending migrations from drizzle/ to the database.
 *
 *   npm run db:generate   # after changing lib/db/schema.ts
 *   npm run db:migrate
 *
 * Reads .env.local the same way Next does, and prefers the direct
 * (unpooled) connection. One Neon database sits behind development, preview
 * and production, so this migrates production too: run it before pushing code
 * that needs the new schema.
 */
import nextEnv from '@next/env'
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { migrate } from 'drizzle-orm/neon-http/migrator'

nextEnv.loadEnvConfig(process.cwd())

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set — see .env.example')
  process.exit(1)
}

await migrate(drizzle({ client: neon(url) }), { migrationsFolder: './drizzle' })
console.log('Migrations applied.')
