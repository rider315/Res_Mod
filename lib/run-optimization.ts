import { AIProvider, OptimizationResult, ParsedResume, ResumeChange } from '@/types/resume'
import {
  buildOptimizeSystemInstruction,
  buildOptimizePrompt,
  parseOptimizeResponse,
} from '@/lib/optimizer'
import {
  buildRevampSystemInstruction,
  buildRevampPrompt,
  parseRevampResponse,
} from '@/lib/revamper'
import {
  buildGapFillPrompt,
  findCoverageGaps,
  mergeChanges,
  stripFrozenLineChanges,
} from '@/lib/coverage'
import { ResumeProfile } from '@/lib/profiles/types'
import {
  buildEvidencePrompt,
  findUnevidencedSkills,
  mergeEvidenceChanges,
  remainingUnevidenced,
} from '@/lib/keyword-evidence'
import { LEVELS, TailorLevel } from '@/lib/tailor/levels'
import { logSnippet } from '@/lib/log'
import { buildKeywordTopUpPrompt, buildTailorPrompt, buildTailorSystemInstruction } from '@/lib/tailor/prompt'
import { addMissingKeywords, JdKeywords, keywordCoverage } from '@/lib/tailor/keywords'
import {
  capBulletChanges,
  dropFrozenSectionChanges,
  editableLines,
  findGroupGaps,
  labelSections,
  snapToLines,
} from '@/lib/tailor/guards'
import { resolveChanges } from '@/lib/tailor/resolve'

/**
 * Orchestrates a full optimization run: the first pass, the coverage top-up,
 * the evidence pass and, when tailoring at a level, the keyword guarantee.
 *
 * Client-safe by design: it takes the model call as a callback so the server
 * routes can pass their provider adapter and the browser-side Puter path can pass
 * puter.ai.chat, without either duplicating this logic.
 *
 * The owner's modes (optimize, revamp) use their own prompts and the active
 * profile's layout rules. A regular user's tailoring level swaps in the level's
 * prompts, quotas and length limits, guards the sections that hold facts, and
 * finishes by making sure every required keyword is in the resume.
 */

export type GenerateFn = (args: {
  systemInstruction: string
  prompt: string
  temperature: number
}) => Promise<string>

export interface RunOptions {
  mode: 'optimize' | 'revamp'
  /**
   * A regular user's tailoring level. When set it takes over from `mode`: the
   * level's prompts, quotas and length limits apply, and `keywords` are guaranteed.
   */
  level?: TailorLevel
  /** The job description's keywords. Required with a level. */
  keywords?: JdKeywords
  profile: ResumeProfile
  resume: ParsedResume
  jobDescription: string
  hardInstructions: string
  softInstructions: string
  provider: AIProvider
  model?: string
  generate: GenerateFn
  /** Told which pass is running, so a screen can show the run as it happens. */
  onProgress?: (progress: RunProgress) => void
  /**
   * When the run must be finished by (epoch ms), because the server stops the
   * request then. The follow-up passes only improve on the first one, so they are
   * skipped rather than started with too little time left for a model call.
   */
  deadline?: number
}

/**
 * How long one model call can take, thinking included, on the slower models. A
 * follow-up pass isn't started with less time than this before the deadline.
 */
export const PASS_TIME_MS = 75_000

/** The passes a run goes through, in the order a user sees them. */
export type RunStage = 'jd' | 'first' | 'coverage' | 'evidence' | 'keywords' | 'check' | 'done'

export interface RunProgress {
  stage: RunStage
  /** What that pass is doing, in the user's words. */
  label: string
}

export const RUN_STAGES: Array<{ stage: RunStage; label: string }> = [
  { stage: 'jd', label: 'Reading the job description' },
  { stage: 'first', label: 'Rewriting the resume for the job' },
  { stage: 'coverage', label: 'Filling the gaps under each role' },
  { stage: 'evidence', label: 'Backing new skills with real bullets' },
  { stage: 'keywords', label: 'Placing every required keyword' },
  { stage: 'check', label: 'Checking every change applies' },
]

const stageLabel = (stage: RunStage): string =>
  RUN_STAGES.find((entry) => entry.stage === stage)?.label ?? 'Working'

const report = (opts: RunOptions, stage: RunStage) => opts.onProgress?.({ stage, label: stageLabel(stage) })

/** Whether there is still time for another model call before the deadline. */
function timeFor(ctx: PassContext, pass: string): boolean {
  const { deadline } = ctx.opts
  if (deadline === undefined || deadline - Date.now() >= PASS_TIME_MS) return true
  console.warn(`[${ctx.label}] Skipping the ${pass}: ${Math.max(0, Math.round((deadline - Date.now()) / 1000))} s left`)
  return false
}

type ParseFn = (
  text: string,
  provider: AIProvider,
  model?: string,
  length?: ResumeProfile['length']
) => OptimizationResult

interface PassContext {
  opts: RunOptions
  label: string
  systemInstruction: string
  temperature: number
  parse: ParseFn
  /** Tailoring's extra limits on a set of changes; passes changes through untouched for the owner's modes. */
  guard: (changes: ResumeChange[]) => ResumeChange[]
}

export async function runOptimization(opts: RunOptions): Promise<OptimizationResult> {
  const {
    mode,
    level,
    keywords,
    profile,
    resume,
    jobDescription,
    hardInstructions,
    softInstructions,
    provider,
    model,
    generate,
  } = opts
  if (level && !keywords) throw new Error('Tailoring at a level needs the job description keywords.')

  const isRevamp = mode === 'revamp'
  const label = level ? `tailor-${level}:${profile.id}` : `${mode}:${profile.id}`

  const systemInstruction = level
    ? buildTailorSystemInstruction(level, profile)
    : isRevamp
      ? buildRevampSystemInstruction(profile)
      : buildOptimizeSystemInstruction(profile)
  const prompt =
    level && keywords
      ? buildTailorPrompt({ resume, jobDescription, keywords, level, instructions: hardInstructions })
      : isRevamp
        ? buildRevampPrompt(resume, jobDescription, hardInstructions, softInstructions, profile.promptNotes)
        : buildOptimizePrompt(resume, jobDescription, hardInstructions, softInstructions, profile.promptNotes)
  const temperature = level ? LEVELS[level].temperature : isRevamp ? 0.3 : 0.2
  const parse: ParseFn = isRevamp && !level ? parseRevampResponse : parseOptimizeResponse

  const ctx: PassContext = {
    opts,
    label,
    systemInstruction,
    temperature,
    parse,
    guard: level ? tailoringGuard(opts, label, level) : (changes) => changes,
  }

  report(opts, 'first')
  const firstPass = parse(
    await generate({ systemInstruction, prompt, temperature }),
    provider,
    model,
    profile.length
  )

  // Guard the profile's frozen lines even if the model ignored the instruction.
  const guarded = stripFrozenLineChanges(firstPass.changes, profile.coverage)
  if (guarded.dropped.length > 0) {
    console.warn(
      `[${label}] Dropped ${guarded.dropped.length} change(s) targeting frozen heading lines: ` +
      guarded.dropped.map((c) => JSON.stringify(logSnippet(c.original, 60))).join(', ')
    )
  }
  const baseline: OptimizationResult = { ...firstPass, changes: ctx.guard(guarded.kept) }

  const covered = await coveragePass(baseline, ctx)
  const evidenced = await evidencePass(covered, ctx)
  const finished = level ? await keywordPass(evidenced, ctx) : evidenced

  report(opts, 'check')
  const result = { ...finished, changes: reconcile(finished.changes, ctx) }
  report(opts, 'done')
  return result
}

/**
 * Every change, pointed back at a line that is really in the resume, so nothing
 * reaches the review screen that would fail at splice time. Each pass reads the
 * resume as the earlier changes leave it, so quotes of rewritten lines are
 * expected here rather than exceptional.
 */
function reconcile(changes: ResumeChange[], ctx: PassContext): ResumeChange[] {
  const { resume, profile } = ctx.opts
  const resolved = resolveChanges(resume, changes, profile.length, {
    frozen: (section) => section.id === 'section_header' || profile.coverage.frozenSection.test(section.title),
  })
  if (resolved.dropped.length > 0) {
    console.warn(
      `[${ctx.label}] Dropped ${resolved.dropped.length} change(s) that could not be applied: ` +
      resolved.dropped.map((entry) => `${JSON.stringify(logSnippet(entry.change.original, 60))} — ${entry.reason}`).join(', ')
    )
  }
  return resolved.changes
}

/** Sections that hold facts are never edited, and a level's per-role bullet cap holds. */
function tailoringGuard(opts: RunOptions, label: string, level: TailorLevel) {
  const { resume, profile } = opts
  const cap = LEVELS[level].maxBulletsPerGroup
  return (changes: ResumeChange[]): ResumeChange[] => {
    const facts = dropFrozenSectionChanges(resume, labelSections(resume, changes), profile.coverage)
    if (facts.dropped.length > 0) {
      console.warn(`[${label}] Dropped ${facts.dropped.length} change(s) to sections that hold facts`)
    }
    if (cap === undefined) return facts.kept
    const capped = capBulletChanges(resume, facts.kept, profile.coverage, cap)
    if (capped.dropped.length > 0) {
      console.warn(`[${label}] Dropped ${capped.dropped.length} bullet change(s) over ${cap} per role or project`)
    }
    return capped.kept
  }
}

/** Did every experience/project section actually get its rewrites? If not, ask for the missing ones. */
async function coveragePass(baseline: OptimizationResult, ctx: PassContext): Promise<OptimizationResult> {
  const { opts, label, systemInstruction, temperature, parse, guard } = ctx
  const { level, profile, resume, jobDescription, hardInstructions, provider, model, generate } = opts

  // Tailoring levels owe their rewrites under every role and project; the owner's
  // profiles keep their per-section quotas.
  const gaps = level
    ? findGroupGaps(resume, baseline.changes, profile.coverage, LEVELS[level].bulletsOwed)
    : findCoverageGaps(resume, baseline.changes, profile.coverage)
  if (gaps.length === 0 || !timeFor(ctx, 'coverage top-up')) return baseline
  report(opts, 'coverage')

  console.log(
    `[${label}] Coverage gaps in ${gaps.length} section(s): ` +
    gaps.map((g) => `${g.sectionTitle} (${g.have}/${g.required})`).join(', ') +
    ' — running a top-up pass'
  )

  try {
    const gapPrompt = buildGapFillPrompt(
      jobDescription,
      hardInstructions,
      gaps,
      profile.promptNotes
    )
    const secondPass = parse(
      await generate({ systemInstruction, prompt: gapPrompt, temperature }),
      provider,
      model,
      profile.length
    )

    const extra = guard(stripFrozenLineChanges(secondPass.changes, profile.coverage).kept)
    const changes = mergeChanges(baseline.changes, extra)
    const added = changes.length - baseline.changes.length
    console.log(`[${label}] Top-up pass added ${added} change(s)`)

    if (added === 0) return baseline
    return {
      ...baseline,
      changes,
      // Keep both passes' keyword lists so the review screen reflects everything.
      keywordsAdded: Array.from(new Set([...baseline.keywordsAdded, ...secondPass.keywordsAdded])),
      sectionsModified: Array.from(new Set([...baseline.sectionsModified, ...secondPass.sectionsModified])),
    }
  } catch (err) {
    // A failed top-up must never lose the first pass's work.
    console.warn(`[${label}] Top-up pass failed, keeping first-pass results:`, err)
    return baseline
  }
}

/**
 * Back up newly-claimed skills with real bullets.
 *
 * Adding "RAG" or "Cloud Deployment" to the skills line while no experience or
 * project bullet mentions them produces a resume a recruiter stops trusting. This
 * pass asks the model to evidence each added skill in a bullet where the work
 * honestly supports it — and to declare the rest unsupported rather than invent
 * anything. Whatever is still unevidenced is reported to the user.
 */
async function evidencePass(result: OptimizationResult, ctx: PassContext): Promise<OptimizationResult> {
  const { opts, label, systemInstruction, parse, guard } = ctx
  const { profile, resume, jobDescription, provider, model, generate } = opts

  const gaps = findUnevidencedSkills(resume, result.changes, profile.coverage)
  if (gaps.length === 0) return result
  // Skipped for time: the skills are still reported as having no bullet behind them.
  if (!timeFor(ctx, 'evidence pass')) return { ...result, unevidencedSkills: gaps.map((g) => g.term) }
  report(opts, 'evidence')

  console.log(
    `[${label}] ${gaps.length} claimed skill(s) with no supporting bullet: ` +
    gaps.map((g) => g.term).join(', ') +
    ' — running an evidence pass'
  )

  try {
    const raw = await generate({
      systemInstruction,
      prompt: buildEvidencePrompt(jobDescription, gaps, profile.promptNotes),
      temperature: 0.2,
    })

    const evidence = parse(raw, provider, model, profile.length)
    const extra = stripFrozenLineChanges(evidence.changes, profile.coverage).kept
    // Not mergeChanges: evidence rewrites can target bullets an earlier pass already rewrote.
    const changes = guard(mergeEvidenceChanges(result.changes, extra, profile.length))
    console.log(
      `[${label}] Evidence pass merged ${extra.length} rewrite(s), ` +
      `${changes.length - result.changes.length} of them on untouched bullets`
    )

    const withEvidence: OptimizationResult = {
      ...result,
      changes,
      keywordsAdded: Array.from(new Set([...result.keywordsAdded, ...evidence.keywordsAdded])),
    }

    const stillUnevidenced = remainingUnevidenced(withEvidence, resume, profile.coverage)
    if (stillUnevidenced.length > 0) {
      console.warn(`[${label}] Still unevidenced: ${stillUnevidenced.join(', ')}`)
    }
    return { ...withEvidence, unevidencedSkills: stillUnevidenced }
  } catch (err) {
    console.warn(`[${label}] Evidence pass failed, keeping existing results:`, err)
    return { ...result, unevidencedSkills: gaps.map((g) => g.term) }
  }
}

/**
 * The keyword guarantee. Any required keyword still missing gets one focused pass
 * asking the model to place it where the work supports it; whatever is left after
 * that is listed in a skills line (or the summary) by addMissingKeywords, as a
 * change the user reviews.
 */
async function keywordPass(result: OptimizationResult, ctx: PassContext): Promise<OptimizationResult> {
  const { opts, label, systemInstruction, parse, guard } = ctx
  const { profile, resume, jobDescription, hardInstructions, provider, model, generate } = opts
  const level = opts.level as TailorLevel
  const keywords = opts.keywords as JdKeywords

  const missingRequired = (changes: ResumeChange[]) =>
    keywordCoverage(resume, keywords.keywords, changes)
      .statuses.filter((entry) => entry.status === 'missing' && entry.keyword.required)
      .map((entry) => entry.keyword)

  report(opts, 'keywords')
  // What is still missing is judged on changes that will really apply.
  let changes = reconcile(result.changes, ctx)
  let keywordsAdded = result.keywordsAdded
  let missing = missingRequired(changes)

  if (missing.length > 0 && timeFor(ctx, 'keyword pass')) {
    console.log(
      `[${label}] Required keywords still missing: ${missing.map((k) => k.term).join(', ')} — running a keyword pass`
    )
    try {
      const lines = editableLines(resume, changes, profile.coverage)
      const raw = await generate({
        systemInstruction,
        prompt: buildKeywordTopUpPrompt({ jobDescription, missing, lines, level, instructions: hardInstructions }),
        temperature: 0.2,
      })
      const topUp = parse(raw, provider, model, profile.length)
      const extra = stripFrozenLineChanges(snapToLines(topUp.changes, lines), profile.coverage).kept
      changes = guard(mergeEvidenceChanges(changes, extra, profile.length))
      keywordsAdded = Array.from(new Set([...keywordsAdded, ...topUp.keywordsAdded]))
      missing = missingRequired(changes)
    } catch (err) {
      console.warn(`[${label}] Keyword pass failed, listing the missing keywords instead:`, err)
    }
  }

  let unplaced: string[] = []
  if (missing.length > 0) {
    const fallback = addMissingKeywords(resume, changes, missing, profile.coverage)
    changes = fallback.changes
    unplaced = fallback.unplaced
    keywordsAdded = Array.from(new Set([...keywordsAdded, ...fallback.placed]))
    console.log(
      `[${label}] Listed ${fallback.placed.length} required keyword(s) in a skills line or the summary` +
      (unplaced.length > 0 ? `; no line could hold: ${unplaced.join(', ')}` : '')
    )
  }

  const before = keywordCoverage(resume, keywords.keywords)
  return {
    ...result,
    changes,
    keywordsAdded,
    companyName:
      result.companyName && result.companyName !== 'Company' ? result.companyName : keywords.company || 'Company',
    keywordReport: {
      jobTitle: keywords.jobTitle,
      keywords: keywords.keywords,
      before: {
        requiredPresent: before.requiredPresent,
        requiredTotal: before.requiredTotal,
        present: before.present,
        total: before.total,
        score: before.score,
      },
      unplaced,
    },
  }
}
