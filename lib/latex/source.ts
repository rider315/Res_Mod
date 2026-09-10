import { promises as fs } from 'fs'
import path from 'path'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { ResumeProfile } from '@/lib/profiles/types'

/**
 * Reading an owner profile's LaTeX resume.
 *
 * The database holds the copy the app reads. resumes/ is the owner's local
 * working copy, kept out of git, and `npm run db:seed-owner` publishes it. The
 * optimizer never writes the stored resume; it only produces a copy with the
 * approved rewrites spliced in.
 *
 * Outside production, a missing DATABASE_URL or a profile that was never seeded
 * falls back to the file on disk, so local work keeps going. Production never
 * reads the disk: a resume missing from the database is an error there, not a
 * silent fallback.
 */

const RESUME_DIR = path.join(process.cwd(), 'resumes')

export async function loadResumeSource(profile: ResumeProfile): Promise<string> {
  const production = process.env.NODE_ENV === 'production'

  if (process.env.DATABASE_URL) {
    const [row] = await getDb()
      .select({ latex: schema.resumes.latex })
      .from(schema.resumes)
      .where(eq(schema.resumes.profileId, profile.id))
      .limit(1)

    if (row) {
      console.log(`[resume] "${profile.id}" loaded from the database`)
      return row.latex
    }
    if (production) {
      throw new Error(
        `The "${profile.label}" resume is not in the database yet. Run npm run db:seed-owner.`
      )
    }
  } else if (production) {
    throw new Error('DATABASE_URL is not set, so the resume profiles cannot be loaded.')
  }

  console.log(`[resume] "${profile.id}" loaded from resumes/ on disk`)
  return loadFromDisk(profile)
}

async function loadFromDisk(profile: ResumeProfile): Promise<string> {
  // profile.texFile is ours, not user input, but basename keeps it that way even
  // if a profile is ever built from something less trustworthy.
  const file = path.basename(profile.texFile)
  const full = path.join(RESUME_DIR, file)

  try {
    return await fs.readFile(full, 'utf8')
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Could not read resumes/${file} for the "${profile.label}" profile, and it is not in the ` +
      `database either. Run npm run db:seed-owner. (${reason})`
    )
  }
}
