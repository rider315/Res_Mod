import { extractJSON, invalidJsonMessage } from '@/lib/json-repair'
import { normalizeChanges, asStringArray, LengthLimits } from '@/lib/normalize-changes'
import { AIProvider, ParsedResume, OptimizationResult } from '@/types/resume'
import { ResumeProfile } from '@/lib/profiles/types'


/**
 * Shared ATS core for the revamp pass — the objective, the absolute rules and the
 * length guidance. Identical for every resume: the goal is always to rewrite the
 * resume around the job description's keywords. Layout-specific rules come from
 * the active profile and are appended below.
 */
export const REVAMP_CORE_INSTRUCTION = `You are an expert ATS resume optimizer performing a FULL ATS-TARGETED REVAMP. Your SOLE PURPOSE is to ensure this resume PASSES automated ATS keyword screening. You aggressively rewrite work experience, project descriptions, and skills to directly mirror the job description's exact terminology.

Your ABSOLUTE rules:

1. NEVER invent new experiences, companies, dates, or facts not in the original resume.
2. ONLY rewrite or rephrase existing content — never add new roles or projects.
3. Return ONLY a valid JSON object — no markdown fences, no extra commentary.
4. Each "original" value must be an EXACT, VERBATIM substring found in the resume content — character-for-character.
5. **LENGTH RULE**: Keep each "proposed" value close to the "original" length so the document layout holds. Growing a bullet to fit in JD keywords is EXPECTED and ENCOURAGED — aim to stay within about 30% of the original length, and never more than about 50% longer. Do NOT sacrifice keyword coverage to hit an exact character count, and NEVER shorten a bullet by more than a third — that deletes real content.
6. NEVER use markdown formatting like **bold**, *italic*, or any special syntax in the proposed text. Output must be plain text only — no asterisks, no markdown.

`

/** Core objective plus the active resume's layout rules. */
export function buildRevampSystemInstruction(profile: ResumeProfile): string {
  return REVAMP_CORE_INSTRUCTION + profile.revampSectionRules
}


export function buildRevampPrompt(
  resume: ParsedResume,
  jobDescription: string,
  hardInstructions: string,
  softInstructions: string,
  /** Layout reminders for the active resume; empty for layouts that need none. */
  profileNotes = ''
): string {
  const resumeText = resume.sections
    .map((s) => `### ${s.title} [id: ${s.id}]\n${s.content.join('\n')}`)
    .join('\n\n')


  return `## RESUME TO REVAMP
${resumeText}


## TARGET JOB DESCRIPTION
${jobDescription}


## HARD CONSTRAINTS — You MUST obey these exactly:
${hardInstructions || 'None'}


## ADDITIONAL GUIDELINES:
${softInstructions || 'Use strong action verbs. Quantify achievements where possible. DIRECTLY USE the JD exact keywords in bullet points. Replace generic terms with JD-specific terminology.'}

## FULL ATS REVAMP INSTRUCTIONS (CRITICAL — MAXIMUM AGGRESSIVENESS)
This is a FULL ATS-TARGETED REVAMP — the goal is to maximize ATS keyword match score:

1. **ALL work experience roles**: For EVERY role, rewrite at least 2 bullet points. COMPLETELY RESTRUCTURE them around the JD's exact keywords, tools, and methodologies. Do NOT soft-align — directly inject JD terminology.
2. **ALL projects**: Rewrite at least 1-2 bullet points per project using JD keywords. NEVER touch the project title/heading line.
3. **Skills section**: AGGRESSIVELY swap skills to match the JD. If the JD lists a skill the resume doesn't have, replace the least relevant existing skill with it.
4. **Soft Skills**: Replace with JD-relevant soft skill phrases.

### HOW TO REWRITE BULLETS FOR ATS:
- Use the JD's EXACT keywords, tool names, and methodology terms directly in the bullet.
- Do NOT just append a keyword — RESTRUCTURE the entire sentence around the JD's language.
- Example: JD says "microservices" and resume says "built backend modules" → rewrite to "architected and deployed microservices for backend systems"
- Example: JD says "CI/CD with Jenkins" and resume says "automated deployment" → rewrite to "implemented CI/CD pipelines using Jenkins for automated deployment"
- Example: JD says "Agile methodology" and resume says "worked in team" → rewrite to "delivered features in Agile sprints with cross-functional collaboration"
- Keep the same achievement type and any metrics from the original.
- Keep the proposed text within roughly 30% of the original length — growing a bullet to fit JD keywords is expected.

### BOLD KEYWORDS:
For each change, also output a "boldKeywords" array containing the 2-4 most important JD-relevant keywords/phrases in the proposed text that should be visually emphasized. These should be exact substrings of the proposed text.
Example: if proposed is "architected and deployed microservices for distributed backend systems using Kubernetes", then boldKeywords could be ["microservices", "Kubernetes"].

### WHAT IS FROZEN (NEVER CHANGE):
- Company names, role titles, and date ranges
- Project title/heading lines (the first line of each project — often blue/linked text with project name and tech stack)
- Education and Certificates sections entirely
- Header/Contact section entirely

## LENGTH GUIDANCE
Keep "proposed" close to the original length so the document layout holds, but do NOT let this
block keyword injection. A bullet growing from 120 to 150 characters to fit in the JD's exact terminology is
GOOD and expected. Stay within roughly 30% of the original length; never exceed about 50% longer, and never
cut a bullet down by more than a third.


## OUTPUT FORMAT
Return this exact JSON structure:
{
  "summary": "One paragraph describing the revamp performed",
  "companyName": "The company name extracted from the job description (e.g. Google, Amazon, KPIT). If not found, use 'Company'",
  "keywordsAdded": ["keyword1", "keyword2"],
  "sectionsModified": ["Section Title 1", "Section Title 2"],
  "changes": [
    {
      "sectionId": "exact section id from the resume (e.g. section_0, section_1)",
      "sectionTitle": "Section Title",
      "original": "exact verbatim text from resume — must be findable via string search, character-for-character",
      "proposed": "rewritten plain text that directly reflects the JD, similar length to the original (NO markdown, NO asterisks)",
      "reason": "why this rewrite improves the resume for this specific role",
      "type": "rewrite|add_keywords|improve_clarity|action_verb",
      "boldKeywords": ["keyword1", "keyword2"]
    }
  ]
}


${profileNotes ? profileNotes + '\n\n' : ''}## SECTION SKIP LIST
Do NOT generate any changes for sections whose title contains any of these (case-insensitive):
- "Education"
- "Award"
- "Certificate"
- "Header"
- "Contact"

## RULES
- Suggest 10 to 20 high-impact changes — cover EVERY work experience role and EVERY project
- "original" must EXACTLY match text that exists in the resume — no paraphrasing, no trimming
- NEVER touch frozen fields (company names, role titles, dates, project names/titles/links)
- EVERY work experience role MUST have at least 2 bullet point changes
- EVERY project MUST have at least 1 bullet point change
- For projects: NEVER change the heading/title line — only bullet points under it
- Keep each proposed change within roughly 30% of the original length
- Each change must include a "boldKeywords" array with 2-4 important JD terms from the proposed text

## ATS KEYWORD OPTIMIZATION
Before generating changes, perform this analysis:

### Step 1: Extract critical keywords from the JD.
- Technical skills, tools, frameworks, languages
- Methodologies (Agile, Scrum, CI/CD, TDD, etc.)
- Domain terms (e-commerce, fintech, automotive, embedded, etc.)

### Step 2: Check which keywords are MISSING from the resume.
Focus on the top 8-12 most critical missing keywords.

### Step 3: Incorporate missing keywords into bullet rewrites.
- Directly use JD terminology in the rewritten bullets
- Skills section: Swap less-relevant skills for JD-critical ones
- Keep category alignment strict

### Step 4: Ensure consistency.
The resume should read naturally — not like a keyword dump.

Report all incorporated keywords in the "keywordsAdded" field.`
}


/**
 * Validate and normalize the model's raw response.
 *
 * Runs on the server for API-key providers and in the browser for Puter, so it
 * must stay free of server-only imports.
 */
export function parseRevampResponse(
  responseText: string,
  provider: AIProvider,
  model?: string,
  length?: LengthLimits
): OptimizationResult {
  let raw
  try {
    raw = JSON.parse(responseText)
  } catch {
    // Try to extract/repair JSON from the response (handles markdown fences, truncation, etc.)
    const rescued = extractJSON(responseText)
    if (rescued) {
      try {
        raw = JSON.parse(rescued)
        console.log('[revamper] Rescued JSON from malformed response')
      } catch {
        // Fall through to error
      }
    }
    if (!raw) {
      console.error('[revamper] Failed to parse AI response. First 500 chars:', responseText.slice(0, 500))
      throw new Error(invalidJsonMessage(provider, model))
    }
  }

  const { changes, skipped } = normalizeChanges(raw.changes, {
    idPrefix: 'revamp',
    logLabel: 'revamper',
    withBoldKeywords: true,
    length,
  })

  if (changes.length === 0 && skipped > 0) {
    throw new Error(
      `The AI returned ${skipped} suggestion${skipped === 1 ? '' : 's'}, but none were usable — ` +
      'they were malformed or changed the text length too much. Try again, or pick a different model in Settings.'
    )
  }

  return {
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    companyName: (typeof raw.companyName === 'string' && raw.companyName) || 'Company',
    keywordsAdded: asStringArray(raw.keywordsAdded),
    sectionsModified: asStringArray(raw.sectionsModified),
    changes,
  }
}
