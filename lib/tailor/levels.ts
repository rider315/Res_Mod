import { LengthLimits } from '@/lib/normalize-changes'

/**
 * The three tailoring levels a regular user picks from.
 *
 * Every level shares the same fixed limits and the same keyword guarantee:
 * employers, titles, dates, degrees and contact details never change, nothing is
 * invented, and every required keyword ends up in the resume. What differs is how
 * much of the wording may move. Soft touches the summary, the skills and a bullet
 * here and there; hard rebuilds a couple of bullets per role around the job's
 * terminology; hardest reworks every editable line toward the job.
 */

export const TAILOR_LEVELS = ['soft', 'hard', 'hardest'] as const
export type TailorLevel = (typeof TAILOR_LEVELS)[number]

export interface LevelSpec {
  label: string
  /** One line for the level picker. */
  blurb: string
  temperature: number
  /** Bullet rewrites owed under each role or project, given how many bullets it has. */
  bulletsOwed(kind: 'role' | 'project', bulletCount: number): number
  /** Most bullet rewrites allowed under one role or project; undefined means no cap. */
  maxBulletsPerGroup?: number
  length: LengthLimits
  /** The length limit, described for the model. */
  lengthHint: string
  /** How this level tailors, as told to the model. */
  strategy: string
}

const keepAtLeast = (share: number) => (len: number) => (len <= 25 ? 1 : Math.ceil(len * share))

export const LEVELS: Record<TailorLevel, LevelSpec> = {
  soft: {
    label: 'Soft',
    blurb: 'Light touch. The summary and skills pick up the job’s keywords, and at most one bullet per role is adjusted.',
    temperature: 0.2,
    bulletsOwed: () => 0,
    maxBulletsPerGroup: 1,
    length: { maxGrowth: (len) => Math.max(60, Math.round(len * 0.25)), minLength: keepAtLeast(0.8) },
    lengthHint: 'at most about 25% longer (a skills line may take a few extra items), and never shorter than 80% of the original',
    strategy: `Change as little as possible: the resume should read almost exactly as before.
- Summary: rewrite it lightly so it names the target job title and the top 3 to 5 keywords.
- Skills lines: add missing required skills to the line of the matching category. You may drop a clearly irrelevant item to make room.
- Bullets: at most ONE bullet per role or project, and only by working a keyword into the existing sentence. Keep its structure and the rest of its wording.
- Aim for roughly 4 to 10 changes in total.`,
  },
  hard: {
    label: 'Hard',
    blurb: 'Clear alignment. The summary and skills are rebuilt, and at least two bullets per role are rewritten around the job.',
    temperature: 0.25,
    bulletsOwed: (kind, count) => Math.min(kind === 'role' ? 2 : 1, count),
    length: { maxGrowth: (len) => Math.max(60, Math.round(len * 0.5)), minLength: keepAtLeast(0.7) },
    lengthHint: 'at most about 50% longer, and never shorter than 70% of the original',
    strategy: `Clearly align the resume with this job while keeping every fact.
- Summary: rewrite it around the job title and the top keywords.
- Skills lines: lead with the job's skills; swap items the job doesn't value for missing required skills in the same category.
- Bullets: for EVERY role rewrite at least 2 bullets, and at least 1 per project, restructuring each sentence around the job's exact terminology. Keep what was done, its scale and its metrics.
- Aim for roughly 10 to 20 changes in total.`,
  },
  hardest: {
    label: 'Hardest',
    blurb: 'Full realignment. Every editable line is rewritten toward the job; employers, titles, dates and metrics still never change.',
    temperature: 0.3,
    bulletsOwed: (_kind, count) => count,
    length: { maxGrowth: (len) => Math.max(70, Math.round(len * 0.6)), minLength: keepAtLeast(0.6) },
    lengthHint: 'at most about 60% longer, and never shorter than 60% of the original',
    strategy: `Rework the whole resume toward this job: every editable line should read as if written for it, while the facts stay exactly the same.
- Summary: rewrite it completely, leading with the job title and carrying the top keywords.
- Skills lines: rebuild each line around the job's skills, in the right categories; drop what the job does not care about.
- Bullets: rewrite EVERY bullet in every role and project, reframing the work toward the job's domain and responsibilities with its exact terminology. What was built, its scale, the employer and every metric do not change.
- Other editable lines, such as soft skills: use the job's own phrases.
- Return a change for every editable line.`,
  },
}

export function isTailorLevel(value: unknown): value is TailorLevel {
  return typeof value === 'string' && (TAILOR_LEVELS as readonly string[]).includes(value)
}

/**
 * The voice the rewritten lines are written in. Balanced is the default; the
 * others shift the wording to suit the role and company, never the facts.
 */
export const TAILOR_TONES = ['balanced', 'formal', 'direct', 'warm'] as const
export type TailorTone = (typeof TAILOR_TONES)[number]

export const TONES: Record<TailorTone, { label: string; hint: string; style: string }> = {
  balanced: {
    label: 'Balanced',
    hint: 'Clear and professional',
    style: '',
  },
  formal: {
    label: 'Formal',
    hint: 'Polished, for corporate and regulated roles',
    style: 'Write in a formal, polished register: precise verbs and measured phrasing, nothing casual.',
  },
  direct: {
    label: 'Direct',
    hint: 'Short, results first',
    style: 'Write plainly and concisely: lead each line with a strong verb and the result, and cut every filler word.',
  },
  warm: {
    label: 'Warm',
    hint: 'Human, for people-focused roles',
    style: 'Write in an approachable, human voice that still sounds professional, suited to people-focused and creative roles.',
  },
}
