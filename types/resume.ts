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
}

export interface OptimizationResult {
  summary: string
  keywordsAdded: string[]
  sectionsModified: string[]
  changes: ResumeChange[]
}

export type AppStep =
  | 'input'
  | 'parsing'
  | 'instructions'
  | 'optimizing'
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
}