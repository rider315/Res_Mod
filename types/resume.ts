export type AIProvider =
  | 'openrouter'
  | 'gemini'
  | 'sambanova'
  | 'puter'
  | 'cerebras'
  | 'groq'
  | 'mistral'
  | 'ollama'

export interface ResumeSection {
  id: string
  title: string
  content: string[]
}

export interface ParsedResume {
  /** The profile id the LaTeX was loaded for. */
  documentId: string
  title: string
  sections: ResumeSection[]
}

export interface ResumeChange {
  id: string
  sectionId: string
  sectionTitle: string
  original: string
  proposed: string
  reason: string
  type: 'rewrite' | 'add_keywords' | 'improve_clarity' | 'action_verb'
  approved: boolean | null
}

export interface OptimizationResult {
  summary: string
  companyName: string
  keywordsAdded: string[]
  sectionsModified: string[]
  changes: ResumeChange[]
  /**
   * Skills added to the skills line that no experience or project bullet backs
   * up — reported rather than silently fabricated into a bullet.
   */
  unevidencedSkills?: string[]
}

export type AppStep =
  | 'input'
  | 'parsing'
  | 'instructions'
  | 'optimizing'
  | 'revamping'
  | 'review'
  | 'applying'
  | 'done'

export interface AppState {
  step: AppStep
  /** Which resume layout is being optimized. */
  profileId: 'gaurav' | 'himanshu'
  /** The base .tex as loaded from resumes/, never modified. */
  latexSource: string | null
  /** The .tex with approved rewrites spliced in — what gets downloaded. */
  optimizedLatex: string | null
  parsedResume: ParsedResume | null
  jobDescription: string
  hardInstructions: string
  softInstructions: string
  optimizationResult: OptimizationResult | null
  error: string | null
  /** Non-fatal notice shown on the done screen (e.g. changes that matched no line). */
  applyWarning: string | null
  aiProvider: AIProvider
  /** API keys kept per provider so switching providers doesn't clobber another key. */
  aiApiKeys: Record<AIProvider, string>
  /** Selected model id per provider. */
  aiModels: Record<AIProvider, string>
  showSettings: boolean
}
