import { ParsedResume, ResumeChange, ResumeSection } from '@/types/resume'
import { CoverageRules, STRUCTURAL_LINE } from '@/lib/profiles/types'
import { visible } from '@/lib/latex/match'
import type { CoverageGap } from '@/lib/coverage'

/**
 * Limits on tailoring changes for regular users' resumes, on top of the frozen
 * heading guard every run gets, plus helpers for reading the resume as the
 * changes so far would leave it.
 *
 * Client-safe.
 */

const HEADER_SECTION_ID = 'section_header'

/** Headings that start a new role or project; a [Group] stays inside its role. */
const GROUP_HEADING = /^\s*\[(Role|Project)\]/

const looseKey = (text: string) => visible(text).toLowerCase()

/** The section and the role or project a line sits under. */
function locate(resume: ParsedResume, text: string): { section: ResumeSection; group: string } | null {
  const exact = text.trim()
  const loose = looseKey(text)
  for (const section of resume.sections) {
    let group = section.id
    for (const line of section.content) {
      if (GROUP_HEADING.test(line)) {
        group = `${section.id}:${line}`
        continue
      }
      if (line.trim() === exact || looseKey(line) === loose) return { section, group }
    }
  }
  return null
}

export interface GuardResult {
  kept: ResumeChange[]
  dropped: ResumeChange[]
}

/** Drop changes to sections that hold facts, such as education or certifications, and to the header. */
export function dropFrozenSectionChanges(
  resume: ParsedResume,
  changes: ResumeChange[],
  rules: CoverageRules
): GuardResult {
  const result: GuardResult = { kept: [], dropped: [] }
  for (const change of changes) {
    const where = locate(resume, change.original)
    const frozen =
      where?.section.id === HEADER_SECTION_ID || rules.frozenSection.test(where?.section.title ?? change.sectionTitle)
    result[frozen ? 'dropped' : 'kept'].push(change)
  }
  return result
}

/** At most `max` rewritten bullets under each role or project. Summary and skills lines don't count. */
export function capBulletChanges(
  resume: ParsedResume,
  changes: ResumeChange[],
  rules: CoverageRules,
  max: number
): GuardResult {
  const used = new Map<string, number>()
  const result: GuardResult = { kept: [], dropped: [] }
  for (const change of changes) {
    const where = locate(resume, change.original)
    const bullet =
      where && (rules.experienceSection.test(where.section.title) || rules.projectSection.test(where.section.title))
    if (!where || !bullet) {
      result.kept.push(change)
      continue
    }
    const count = used.get(where.group) ?? 0
    if (count >= max) {
      result.dropped.push(change)
      continue
    }
    used.set(where.group, count + 1)
    result.kept.push(change)
  }
  return result
}

/** Label each change with the section its line actually sits in, whatever the model called it. */
export function labelSections(resume: ParsedResume, changes: ResumeChange[]): ResumeChange[] {
  return changes.map((change) => {
    const where = locate(resume, change.original)
    return where ? { ...change, sectionId: where.section.id, sectionTitle: where.section.title } : change
  })
}

/**
 * Rewrites still owed under each role and project.
 *
 * Counting per section let a level's quota be met by rewriting two bullets of
 * the first job and none of the rest. Counting per role or project holds every
 * one of them to the level, and each shortfall becomes its own block in the
 * top-up prompt.
 */
export function findGroupGaps(
  resume: ParsedResume,
  changes: ResumeChange[],
  rules: CoverageRules,
  owed: (kind: 'role' | 'project', bulletCount: number) => number
): CoverageGap[] {
  const changed = new Set(changes.map((change) => looseKey(change.original)))
  const gaps: CoverageGap[] = []

  for (const section of resume.sections) {
    if (rules.frozenSection.test(section.title)) continue
    const kind = rules.experienceSection.test(section.title)
      ? 'role'
      : rules.projectSection.test(section.title)
        ? 'project'
        : null
    if (!kind) continue

    let heading = ''
    let bullets: string[] = []
    const flush = () => {
      if (bullets.length === 0) return
      const required = Math.min(owed(kind, bullets.length), bullets.length)
      const have = bullets.filter((line) => changed.has(looseKey(line))).length
      const candidateLines = bullets.filter((line) => !changed.has(looseKey(line)))
      if (have < required && candidateLines.length > 0) {
        gaps.push({
          sectionId: section.id,
          sectionTitle: heading ? `${section.title}: ${heading.replace(STRUCTURAL_LINE, '').trim()}` : section.title,
          required,
          have,
          candidateLines,
        })
      }
    }

    for (const line of section.content) {
      if (GROUP_HEADING.test(line)) {
        flush()
        heading = line
        bullets = []
      } else if (!STRUCTURAL_LINE.test(line) && line.trim().length >= rules.minBulletLength) {
        bullets.push(line)
      }
    }
    flush()
  }
  return gaps
}

export interface ResumeLine {
  section: ResumeSection
  /** The line as it is in the resume. */
  original: string
  /** The line as the changes would leave it. */
  current: string
}

/** Every line of the resume, alongside how it reads once `changes` are applied. */
export function readLines(resume: ParsedResume, changes: ResumeChange[] = []): ResumeLine[] {
  const exact = new Map(changes.map((change) => [change.original.trim(), change.proposed]))
  const loose = new Map(changes.map((change) => [looseKey(change.original), change.proposed]))
  const lines: ResumeLine[] = []
  for (const section of resume.sections) {
    for (const line of section.content) {
      const current = STRUCTURAL_LINE.test(line) ? line : exact.get(line.trim()) ?? loose.get(looseKey(line)) ?? line
      lines.push({ section, original: line, current })
    }
  }
  return lines
}

export interface EditableLine {
  sectionId: string
  sectionTitle: string
  /** The line as it currently reads, after earlier changes. */
  text: string
}

/** The lines a tailoring pass may still change, as they read after `changes`. */
export function editableLines(resume: ParsedResume, changes: ResumeChange[], rules: CoverageRules): EditableLine[] {
  return readLines(resume, changes)
    .filter(
      ({ section, original }) =>
        section.id !== HEADER_SECTION_ID && !rules.frozenSection.test(section.title) && !STRUCTURAL_LINE.test(original)
    )
    .map(({ section, current }) => ({ sectionId: section.id, sectionTitle: section.title, text: current }))
}

/**
 * Point each change's "original" at the exact line it quotes, forgiving a copied
 * list marker ("- ") or reflowed markup, so a good rewrite isn't lost to a
 * quoting slip.
 */
export function snapToLines(changes: ResumeChange[], lines: EditableLine[]): ResumeChange[] {
  const exact = new Set(lines.map((line) => line.text.trim()))
  const loose = new Map(lines.map((line) => [looseKey(line.text), line.text]))
  return changes.map((change) => {
    if (exact.has(change.original.trim())) return change
    const unmarked = change.original.replace(/^\s*[-•*]\s+/, '').trim()
    if (exact.has(unmarked)) return { ...change, original: unmarked }
    const match = loose.get(looseKey(unmarked))
    return match ? { ...change, original: match } : change
  })
}
