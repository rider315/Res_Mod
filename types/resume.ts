export type AIProvider = 'openrouter' | 'gemini' | 'cerebras'

export interface ResumeSection {
  id: string
  title: string
  content: string[]
}

export interface ParsedResume {
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
  boldKeywords?: string[]
}

export interface OptimizationResult {
  summary: string
  companyName: string
  keywordsAdded: string[]
  sectionsModified: string[]
  changes: ResumeChange[]
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
  resumeUrl: string
  copiedDocId: string | null
  copiedDocUrl: string | null
  parsedResume: ParsedResume | null
  jobDescription: string
  hardInstructions: string
  softInstructions: string
  optimizationResult: OptimizationResult | null
  error: string | null
  aiProvider: AIProvider
  /** API keys kept per provider so switching providers doesn't clobber the other key. */
  aiApiKeys: Record<AIProvider, string>
  /** OpenRouter model id, e.g. "deepseek/deepseek-chat-v3-0324:free". */
  openRouterModel: string
  showSettings: boolean
}
