import { defineConfig } from 'drizzle-kit'

// Used by `npm run db:generate`, which diffs lib/db/schema.ts against the
// previous migrations and needs no database connection. Migrations are applied
// by `npm run db:migrate` (scripts/db-migrate.mjs).
export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/db/schema.ts',
  out: './drizzle',
})
