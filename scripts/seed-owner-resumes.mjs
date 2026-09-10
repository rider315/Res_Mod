/*
 * Publish the owner's resume profiles from resumes/*.tex to the database.
 *
 *   npm run db:seed-owner
 *
 * resumes/ is the owner's local working copy and stays out of git; the app reads
 * the profiles from the database. Run this after editing a .tex: each file
 * upserts the row for the profile it is named after (gaurav.tex -> "gaurav"),
 * and the change is live in every environment at once.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import nextEnv from '@next/env'
import { neon } from '@neondatabase/serverless'

nextEnv.loadEnvConfig(process.cwd())

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set — see .env.example')
  process.exit(1)
}

const sql = neon(url)
const dir = path.join(process.cwd(), 'resumes')
const files = (await fs.readdir(dir)).filter((file) => file.endsWith('.tex'))
if (files.length === 0) {
  console.error('No .tex files found in resumes/')
  process.exit(1)
}

for (const file of files) {
  const profileId = path.basename(file, '.tex')
  const latex = await fs.readFile(path.join(dir, file), 'utf8')
  if (!latex.includes('\\begin{document}')) {
    console.warn(`Skipped ${file}: it has no \\begin{document}`)
    continue
  }

  await sql`
    insert into resumes (profile_id, title, source_format, latex)
    values (${profileId}, ${profileId}, 'latex', ${latex})
    on conflict (profile_id) where profile_id is not null
    do update set latex = excluded.latex, updated_at = now()
  `
  console.log(`Published profile "${profileId}" (${latex.length} characters)`)
}
