import { generateAIResponse } from '@/lib/ai-provider'
import { AIProvider, ParsedResume, ResumeChange, OptimizationResult } from '@/types/resume'


const REVAMP_SYSTEM_INSTRUCTION = `You are an expert ATS resume optimizer performing a FULL ATS-TARGETED REVAMP. Your SOLE PURPOSE is to ensure this resume PASSES automated ATS keyword screening. You aggressively rewrite work experience, project descriptions, and skills to directly mirror the job description's exact terminology.

Your ABSOLUTE rules:

1. NEVER invent new experiences, companies, dates, or facts not in the original resume.
2. ONLY rewrite or rephrase existing content — never add new roles or projects.
3. Return ONLY a valid JSON object — no markdown fences, no extra commentary.
4. Each "original" value must be an EXACT, VERBATIM substring found in the resume content — character-for-character.
5. **CRITICAL — SAME LENGTH RULE**: Each "proposed" value MUST have the EXACT same character count as the "original" value (±5 chars max). Count the characters before outputting. If the proposed text is shorter, pad with natural filler words. If longer, trim or rephrase to fit. This is essential to preserve document alignment and formatting.
6. NEVER use markdown formatting like **bold**, *italic*, or any special syntax in the proposed text. Output must be plain text only — no asterisks, no markdown.

## SECTION-LEVEL RULES (these override everything else):

### SKILLS section:
- You may REORDER existing skills to prioritize JD-relevant ones at the front of each list.
- You may REPLACE less-relevant skills with JD-critical skills. Be VERY AGGRESSIVE — swap out any skill the JD doesn't mention for one it explicitly requires.
- **TO STAY WITHIN CHARACTER LIMIT**: If swapping in JD skills makes the line longer, you MUST remove/drop up to 5 of the LEAST relevant existing skills from that line. Cut the least important ones to make room. The final line MUST be within ±5 chars of the original.
- **CRITICAL CATEGORY MATCHING**: Respect sub-categories. Languages go in "Languages:", frameworks in "Frameworks:", tools in "Tools:".
- Preserve the EXACT formatting structure (labels, comma-separated pattern, number of lines).
- The total character count per line MUST stay within ±5 chars of the original. Count carefully before outputting.

### WORK EXPERIENCE section:
- Company names, role titles, and date ranges are FROZEN — never modify them.
- ONLY modify the bullet-point descriptions of work done.
- **CRITICAL — ATS KEYWORD SATURATION**: For EVERY work experience role listed (not just the primary one), you MUST rewrite at least 2 bullet points to DIRECTLY USE the JD's exact keywords, tool names, methodologies, and domain terms.
- Do NOT "softly align" — COMPLETELY RESTRUCTURE bullet points around the JD's language.
- If the JD says "microservices" and the bullet says "built backend modules", rewrite to "architected and deployed microservices for backend systems".
- If the JD says "CI/CD with Jenkins" and the bullet says "automated deployment", rewrite to "implemented CI/CD pipelines using Jenkins for automated deployment".
- If the JD mentions "Agile/Scrum", "cross-functional teams", or "stakeholder management", weave these phrases into bullets.
- Keep the same achievement structure — if the original has a metric (e.g., "reduced load time by 40%"), preserve a similar metric.
- The proposed text must match the original character count (±5 chars).

### EDUCATION section:
- DO NOT modify anything. Skip this section entirely.

### PROJECTS section:
- **PROJECT TITLES, NAMES, LINKS, and HEADING LINES are FROZEN — NEVER modify them.**
- The first line of each project (the title/heading line, often containing project name, link, tech stack summary) is COMPLETELY FROZEN. Do NOT generate a change for it.
- ONLY modify the bullet-point descriptions UNDER each project heading.
- Apply the SAME aggressive ATS keyword injection — rewrite bullets to directly use JD terminology.
- The proposed text must match the original character count (±5 chars).

### AWARDS / CERTIFICATES section:
- DO NOT modify anything. Skip this section entirely.

### SOFT SKILLS section:
- The soft skills use a Google Docs numbered list. The numbers (1. 2. 3.) are AUTO-GENERATED — they are NOT part of the text content.
- In "original" and "proposed" fields, include ONLY the skill text (e.g. "Communication Skills"), NEVER include the number prefix.
- You may replace soft skill names to better align with the JD.
- Each replacement must be similar in character length to the original.

### HEADER / CONTACT section:
- DO NOT modify anything. Skip this section entirely.`


function buildRevampPrompt(
  resume: ParsedResume,
  jobDescription: string,
  hardInstructions: string,
  softInstructions: string
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
- The proposed text MUST be within ±5 characters of the original length.

### BOLD KEYWORDS:
For each change, also output a "boldKeywords" array containing the 2-4 most important JD-relevant keywords/phrases in the proposed text that should be visually emphasized. These should be exact substrings of the proposed text.
Example: if proposed is "architected and deployed microservices for distributed backend systems using Kubernetes", then boldKeywords could be ["microservices", "Kubernetes"].

### WHAT IS FROZEN (NEVER CHANGE):
- Company names, role titles, and date ranges
- Project title/heading lines (the first line of each project — often blue/linked text with project name and tech stack)
- Education and Certificates sections entirely
- Header/Contact section entirely

## CRITICAL LENGTH RULE
For every change, the "proposed" text MUST have the EXACT same character count as the "original" text (±5 chars max).
Count carefully. If original is 120 characters, proposed must be 115-125 characters.
This is non-negotiable — the document formatting will break otherwise.


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
      "proposed": "rewritten plain text that directly reflects the JD (MUST be within ±3 chars of original length, NO markdown, NO asterisks)",
      "reason": "why this rewrite improves the resume for this specific role",
      "type": "rewrite|add_keywords|improve_clarity|action_verb",
      "boldKeywords": ["keyword1", "keyword2"]
    }
  ]
}


## SECTION SKIP LIST
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
- Maintain the same character length (±5 chars) for every proposed change
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


export async function revampResume(
  resume: ParsedResume,
  jobDescription: string,
  hardInstructions: string,
  softInstructions: string,
  provider: AIProvider = 'gemini',
  apiKey?: string
): Promise<OptimizationResult> {
  const resolvedKey = apiKey || process.env.GEMINI_API_KEY!

  const prompt = buildRevampPrompt(resume, jobDescription, hardInstructions, softInstructions)
  const responseText = await generateAIResponse({
    provider,
    apiKey: resolvedKey,
    systemInstruction: REVAMP_SYSTEM_INSTRUCTION,
    prompt,
    temperature: 0.3,
  })
  let raw
  try {
    raw = JSON.parse(responseText)
  } catch {
    console.error('[revamper] Failed to parse AI response. First 500 chars:', responseText.slice(0, 500))
    throw new Error(`AI returned invalid JSON. This usually means the model's response was truncated. ${provider === 'cerebras' ? 'Cerebras free-tier models may struggle with large prompts — try Gemini instead.' : 'Please try again.'}`)
  }

  const MAX_CHAR_DIFF = 8 // hard limit — reject changes that exceed this (increased for aggressive ATS rewrites)

  const changes: ResumeChange[] = (raw.changes ?? [])
    .map(
      (c: Omit<ResumeChange, 'id' | 'approved'> & { boldKeywords?: string[] }, i: number) => ({
        id: `revamp_${i}_${Date.now()}`,
        sectionId: c.sectionId,
        sectionTitle: c.sectionTitle,
        original: c.original,
        proposed: c.proposed,
        reason: c.reason,
        type: c.type ?? 'rewrite',
        approved: null,
        boldKeywords: (c.boldKeywords ?? []).filter(
          (kw: string) => typeof kw === 'string' && c.proposed.includes(kw)
        ),
      })
    )
    .filter((c: ResumeChange) => {
      const diff = Math.abs(c.proposed.length - c.original.length)
      if (diff > MAX_CHAR_DIFF) {
        console.warn(
          `[revamper] Rejected change (±${diff} chars): "${c.original.slice(0, 50)}..." → "${c.proposed.slice(0, 50)}..."`
        )
        return false
      }
      return true
    })


  return {
    summary: raw.summary ?? '',
    companyName: raw.companyName || 'Company',
    keywordsAdded: raw.keywordsAdded ?? [],
    sectionsModified: raw.sectionsModified ?? [],
    changes,
  }
}
