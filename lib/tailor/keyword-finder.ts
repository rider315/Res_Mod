import { JdKeyword, KEYWORD_KINDS, mentionsKeyword } from '@/lib/tailor/keywords'

/**
 * The keyword finder: the keywords a job description screens for, scored so the
 * ones worth placing first stand out, with where each belongs on a resume.
 *
 * The keywords are the same ones a tailoring guarantees, so what the finder
 * shows is what tailoring will work into the resume. Scores come from the job
 * description itself, not from another model call. Client-safe.
 */

export interface ScoredKeyword extends JdKeyword {
  /** 1–10: how much the job leans on it. */
  score: number
  /** How many sentences of the job description mention it. */
  mentions: number
  /** Where on a resume it belongs. */
  where: string
}

type Kind = (typeof KEYWORD_KINDS)[number]

const WHERE: Record<Kind, string> = {
  skill: 'Your skills line, and a bullet where you used it',
  tool: 'Your skills line, and a bullet where you used it',
  domain: 'Your summary, and the bullets about that work',
  responsibility: 'Experience bullets that describe this work',
  soft_skill: 'A bullet that shows it in action, not just the word',
  certification: 'Your certifications or education',
  title: 'The first line of your summary',
}

/** The job description's sentences and list items: the units a mention is counted in. */
function sentences(text: string): string[] {
  return text
    .replace(/([.!?;])\s+/g, '$1\n')
    .replace(/\s[•·▪–-]\s/g, '\n')
    .split(/[\n\r]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export function countMentions(jobDescription: string, keyword: JdKeyword): number {
  return sentences(jobDescription).filter((sentence) => mentionsKeyword(sentence, keyword)).length
}

/**
 * Required keywords score 5–10 and nice-to-haves 1–6. The model lists the most
 * important terms first, so position counts, and so does how often the job
 * description comes back to a term.
 */
export function scoreKeywords(jobDescription: string, keywords: JdKeyword[]): ScoredKeyword[] {
  const scored = keywords.map((keyword, index) => {
    const mentions = countMentions(jobDescription, keyword)
    const position = index / Math.max(1, keywords.length)
    let score = keyword.required ? 6 : 3
    if (position < 1 / 3) score += 2
    else if (position < 2 / 3) score += 1
    if (mentions >= 3) score += 2
    else if (mentions === 2) score += 1
    if (keyword.kind === 'title' || (keyword.kind === 'certification' && keyword.required)) score += 1
    score = keyword.required ? Math.min(10, Math.max(5, score)) : Math.min(6, Math.max(1, score))
    const entry: ScoredKeyword = { ...keyword, score, mentions, where: WHERE[keyword.kind] ?? WHERE.skill }
    return { entry, index }
  })

  return scored
    .sort(
      (a, b) =>
        Number(b.entry.required) - Number(a.entry.required) || b.entry.score - a.entry.score || a.index - b.index
    )
    .map(({ entry }) => entry)
}

export interface KeywordFinderResult {
  jobTitle: string
  company: string
  keywords: ScoredKeyword[]
}
