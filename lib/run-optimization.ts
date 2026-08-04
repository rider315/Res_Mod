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
  if (gaps.length === 0) return baseline

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

    if (added === 0) return baseline

    return {
      ...baseline,
      changes,
      // Keep both passes' keyword lists so the review screen reflects everything.
      keywordsAdded: Array.from(new Set([...baseline.keywordsAdded, ...secondPass.keywordsAdded])),
      sectionsModified: Array.from(
        new Set([...baseline.sectionsModified, ...secondPass.sectionsModified])
      ),
    }
  } catch (err) {
    // A failed top-up must never lose the first pass's work.
    console.warn(`[${label}] Top-up pass failed, keeping first-pass results:`, err)
    return baseline
  }
}
