import { AIProvider, OptimizationResult, ParsedResume } from '@/types/resume'
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
  remainingUnevidenced,
} from '@/lib/keyword-evidence'

/**
 * Orchestrates a full optimization run, including the coverage top-up pass.
 *
 * Client-safe by design: it takes the model call as a callback so the server
 * routes can pass their provider adapter and the browser-side Puter path can pass
 * puter.ai.chat, without either duplicating this logic.
 *
 * The ATS objective is the same for every resume; the active profile supplies
 * only the layout rules — which sections are editable, which lines are frozen,
 * and how many rewrites each section owes.
 */

export type GenerateFn = (args: {
  systemInstruction: string
  prompt: string
  temperature: number
}) => Promise<string>

export interface RunOptions {
  mode: 'optimize' | 'revamp'
  profile: ResumeProfile
  resume: ParsedResume
  jobDescription: string
  hardInstructions: string
  softInstructions: string
  provider: AIProvider
  model?: string
  generate: GenerateFn
}

export async function runOptimization(opts: RunOptions): Promise<OptimizationResult> {
  const {
    mode,
    profile,
    resume,
    jobDescription,
    hardInstructions,
    softInstructions,
    provider,
    model,
    generate,
  } = opts
  const isRevamp = mode === 'revamp'
  const label = `${mode}:${profile.id}`

  const systemInstruction = isRevamp
    ? buildRevampSystemInstruction(profile)
    : buildOptimizeSystemInstruction(profile)
  const prompt = isRevamp
    ? buildRevampPrompt(resume, jobDescription, hardInstructions, softInstructions, profile.promptNotes)
    : buildOptimizePrompt(resume, jobDescription, hardInstructions, softInstructions, profile.promptNotes)
  const temperature = isRevamp ? 0.3 : 0.2
  const parse = isRevamp ? parseRevampResponse : parseOptimizeResponse

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
      guarded.dropped.map((c) => JSON.stringify(c.original.slice(0, 60))).join(', ')
    )
  }
  const baseline: OptimizationResult = { ...firstPass, changes: guarded.kept }

  // Did every experience/project section actually get its rewrites?
  const gaps = findCoverageGaps(resume, baseline.changes, profile.coverage)
  if (gaps.length === 0) {
    return evidencePass(baseline, opts, label, isRevamp, parse)
  }

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
      isRevamp,
      profile.promptNotes
    )
    const secondPass = parse(
      await generate({ systemInstruction, prompt: gapPrompt, temperature }),
      provider,
      model,
      profile.length
    )

    const extra = stripFrozenLineChanges(secondPass.changes, profile.coverage).kept
    const changes = mergeChanges(baseline.changes, extra)
    const added = changes.length - baseline.changes.length
    console.log(`[${label}] Top-up pass added ${added} change(s)`)

    const merged: OptimizationResult =
      added === 0
        ? baseline
        : {
            ...baseline,
            changes,
            // Keep both passes' keyword lists so the review screen reflects everything.
            keywordsAdded: Array.from(
              new Set([...baseline.keywordsAdded, ...secondPass.keywordsAdded])
            ),
            sectionsModified: Array.from(
              new Set([...baseline.sectionsModified, ...secondPass.sectionsModified])
            ),
          }

    return evidencePass(merged, opts, label, isRevamp, parse)
  } catch (err) {
    // A failed top-up must never lose the first pass's work.
    console.warn(`[${label}] Top-up pass failed, keeping first-pass results:`, err)
    return evidencePass(baseline, opts, label, isRevamp, parse)
  }
}

type ParseFn = (
  text: string,
  provider: AIProvider,
  model?: string,
  length?: ResumeProfile['length']
) => OptimizationResult

/**
 * Back up newly-claimed skills with real bullets.
 *
 * Adding "RAG" or "Cloud Deployment" to the skills line while no experience or
 * project bullet mentions them produces a resume a recruiter stops trusting. This
 * pass asks the model to evidence each added skill in a bullet where the work
 * honestly supports it — and to declare the rest unsupported rather than invent
 * anything. Whatever is still unevidenced is reported to the user.
 */
async function evidencePass(
  result: OptimizationResult,
  opts: RunOptions,
  label: string,
  isRevamp: boolean,
  parse: ParseFn
): Promise<OptimizationResult> {
  const { profile, resume, jobDescription, provider, model, generate } = opts

  const gaps = findUnevidencedSkills(resume, result.changes, profile.coverage)
  if (gaps.length === 0) return result

  console.log(
    `[${label}] ${gaps.length} claimed skill(s) with no supporting bullet: ` +
    gaps.map((g) => g.term).join(', ') +
    ' — running an evidence pass'
  )

  try {
    const systemInstruction = isRevamp
      ? buildRevampSystemInstruction(profile)
      : buildOptimizeSystemInstruction(profile)
    const raw = await generate({
      systemInstruction,
      prompt: buildEvidencePrompt(jobDescription, gaps, isRevamp, profile.promptNotes),
      temperature: 0.2,
    })

    const evidence = parse(raw, provider, model, profile.length)
    const extra = stripFrozenLineChanges(evidence.changes, profile.coverage).kept
    const changes = mergeChanges(result.changes, extra)
    console.log(`[${label}] Evidence pass added ${changes.length - result.changes.length} change(s)`)

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
