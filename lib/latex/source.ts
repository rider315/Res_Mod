import { promises as fs } from 'fs'
import path from 'path'
import { ResumeProfile } from '@/lib/profiles/types'

/**
 * Reading a profile's LaTeX resume off disk.
 *
 * The .tex files in resumes/ are the single source of truth — there is no
 * database and no remote document. Editing resumes/gaurav.tex by hand and
 * reloading the app is the intended way to change the base resume; the
 * optimizer only ever produces a *copy* with the approved rewrites spliced in,
 * so the file on disk is never written to by the app.
 */

const RESUME_DIR = path.join(process.cwd(), 'resumes')

export async function loadResumeSource(profile: ResumeProfile): Promise<string> {
  // profile.texFile is ours, not user input, but basename keeps it that way even
  // if a profile is ever built from something less trustworthy.
  const file = path.basename(profile.texFile)
  const full = path.join(RESUME_DIR, file)

  try {
    return await fs.readFile(full, 'utf8')
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Could not read resumes/${file} for the "${profile.label}" profile. ` +
      `Make sure the file exists in the project's resumes/ folder. (${reason})`
    )
  }
}
