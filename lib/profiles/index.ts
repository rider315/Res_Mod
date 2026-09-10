import { ResumeProfile, ResumeProfileId } from '@/lib/profiles/types'
import { gauravProfile } from '@/lib/profiles/gaurav'
import { himanshuProfile } from '@/lib/profiles/himanshu'

export type { ResumeProfile, ResumeProfileId, CoverageRules, LengthRules } from '@/lib/profiles/types'

export const PROFILES: Record<ResumeProfileId, ResumeProfile> = {
  gaurav: gauravProfile,
  himanshu: himanshuProfile,
}

/** Display order in the resume picker. */
export const PROFILE_ORDER: ResumeProfileId[] = ['gaurav', 'himanshu']

export const DEFAULT_PROFILE_ID: ResumeProfileId = 'gaurav'

/**
 * Strict on purpose: an unknown id used to fall back to Gaurav's profile, which
 * would hand the owner's prompts to anyone who sent a bad id.
 */
export function getProfile(id: ResumeProfileId): ResumeProfile {
  const profile = PROFILES[id]
  if (!profile) throw new Error(`Unknown resume profile "${id}"`)
  return profile
}

export function isValidProfileId(id: string): id is ResumeProfileId {
  return id in PROFILES
}
