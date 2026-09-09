import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, buildResumeFileName } from '@/lib/require-auth'
import { getProfile, PROFILE_ORDER } from '@/lib/profiles'
import { loadResumeSource } from '@/lib/latex/source'
import { applyLatexChanges } from '@/lib/latex/apply'

const schema = z.object({
  profileId: z.enum(PROFILE_ORDER as [string, ...string[]]),
  changes: z.array(
    z.object({
      id: z.string(),
      sectionTitle: z.string().optional(),
      original: z.string(),
      proposed: z.string(),
      approved: z.boolean().nullable(),
    })
  ),
  companyName: z.string().optional(),
})

/**
 * Splice the approved rewrites into a fresh copy of the profile's .tex.
 *
 * The base file is re-read here rather than trusted from the client, so the
 * document the changes are applied to is always the real one on disk.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const { profileId, changes, companyName } = parsed.data
  const approved = changes
    .filter((c) => c.approved === true)
    .map((c) => ({ original: c.original, proposed: c.proposed, sectionTitle: c.sectionTitle }))

  if (approved.length === 0) {
    return NextResponse.json({ error: 'No approved changes to apply' }, { status: 400 })
  }

  const profile = getProfile(profileId)

  try {
    const source = await loadResumeSource(profile)
    const result = applyLatexChanges(source, approved)

    if (result.documentProblems.length > 0) {
      console.error('[resume/apply] rejected splice:', result.documentProblems.join('; '))
      return NextResponse.json(
        {
          error:
            'Applying those changes would produce a .tex that does not compile (' +
            result.documentProblems.join('; ') +
            '). Nothing was changed — try rejecting the most heavily rewritten change and applying again.',
        },
        { status: 422 }
      )
    }

    for (const bad of result.rejected) {
      console.warn(`[resume/apply] rejected "${bad.original.slice(0, 60)}": ${bad.reason}`)
    }

    return NextResponse.json({
      success: true,
      latex: result.latex,
      fileName: buildResumeFileName(profile.personName, companyName || 'Company'),
      appliedCount: result.applied,
      requestedCount: result.requested,
      unmatched: result.unmatched,
      overlapping: result.overlapping,
      rejected: result.rejected,
      recovered: result.recovered,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[resume/apply]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
