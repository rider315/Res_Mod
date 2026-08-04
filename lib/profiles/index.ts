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

export function getProfile(id: ResumeProfileId | string | undefined): ResumeProfile {
  return PROFILES[id as ResumeProfileId] ?? PROFILES[DEFAULT_PROFILE_ID]
}

export function isValidProfileId(id: string): id is ResumeProfileId {
  return id in PROFILES
}
