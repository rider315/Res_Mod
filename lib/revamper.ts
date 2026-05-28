import { GoogleGenerativeAI } from '@google/generative-ai'
import { ParsedResume, ResumeChange, OptimizationResult } from '@/types/resume'


const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)


const REVAMP_SYSTEM_INSTRUCTION = `You are an expert ATS resume optimizer performing a TARGETED REVAMP. You rewrite work experience and project bullet points to directly reflect a job description — more aggressively than a soft optimization, but still controlled and precise.

Your ABSOLUTE rules:

1. NEVER invent new experiences, companies, dates, or facts not in the original resume.
2. ONLY rewrite or rephrase existing content — never add new roles or projects.
3. Return ONLY a valid JSON object — no markdown fences, no extra commentary.
4. Each "original" value must be an EXACT, VERBATIM substring found in the resume content — character-for-character.
5. **CRITICAL — SAME LENGTH RULE**: Each "proposed" value MUST have the EXACT same character count as the "original" value (±3 chars max). Count the characters before outputting. If the proposed text is shorter, pad with natural filler words. If longer, trim or rephrase to fit. This is essential to preserve document alignment and formatting.
6. NEVER use markdown formatting like **bold**, *italic*, or any special syntax in the proposed text. Output must be plain text only — no asterisks, no markdown.

## SECTION-LEVEL RULES (these override everything else):

### SKILLS section:
- You may REORDER existing skills to prioritize JD-relevant ones at the front of each list.
- You may REPLACE less-relevant skills with JD-critical skills that are closely related to the candidate's actual tech stack.
- **TO STAY WITHIN CHARACTER LIMIT**: If swapping in JD skills makes the line longer, you MUST remove/drop up to 5 of the LEAST relevant existing skills from that line. Cut the least important ones to make room. The final line MUST be within ±3 chars of the original.
- **CRITICAL CATEGORY MATCHING**: Respect sub-categories. Languages go in "Languages:", frameworks in "Frameworks:", tools in "Tools:".
- Preserve the EXACT formatting structure (labels, comma-separated pattern, number of lines).
- The total character count per line MUST stay within ±3 chars of the original. Count carefully before outputting.

### WORK EXPERIENCE section:
- Company names, role titles, and date ranges are FROZEN — never modify them.
- ONLY modify the bullet-point descriptions of work done.
- **KPIT TECHNOLOGIES**: This is the PRIMARY role. Pick the 2 MOST RELEVANT bullet points and rewrite them to directly reflect the JD's technologies and methodologies. Leave the other KPIT bullets untouched.
- For other companies: You may modify 1-2 bullets max per company if relevant.
- Rewrite the selected bullets so they directly use the JD's exact keywords, tool names, and methodology terms.
- Keep the same achievement structure — if the original has a metric (e.g., "reduced load time by 40%"), preserve a similar metric.
- The proposed text must match the original character count (±3 chars).

### EDUCATION section:
- DO NOT modify anything. Skip this section entirely.

### PROJECTS section:
- **PROJECT TITLES, NAMES, LINKS, and HEADING LINES are FROZEN — NEVER modify them.**
- The first line of each project (the title/heading line, often containing project name, link, tech stack summary) is COMPLETELY FROZEN. Do NOT generate a change for it.
- ONLY modify the bullet-point descriptions UNDER each project heading.
- Rewrite the bullet points to reflect JD technologies where naturally applicable.
- The proposed text must match the original character count (±3 chars).

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
${softInstructions || 'Use strong action verbs. Quantify achievements where possible. Directly use the JD\'s exact terminology in bullet points.'}

## REVAMP INSTRUCTIONS (CRITICAL)
This is a TARGETED REVAMP — more aggressive than soft optimization, but still controlled:

1. **KPIT Technologies** (primary work experience): Pick EXACTLY 2 bullet points that are MOST relevant to rewrite. Rewrite them to directly use the JD's technologies, tools, and methodologies. Leave other KPIT bullets untouched.
2. **Other work experience**: Modify at most 1-2 bullets per company.
3. **Projects**: ONLY modify bullet points under project headings. NEVER touch the project title/heading line (the first line with project name, link, and tech stack). Only change the black descriptive bullet points, NOT the blue/linked heading text.
4. **Skills section**: Swap skills to match the JD. Keep category structure intact.
5. **Soft Skills**: Replace with JD-relevant soft skills.

### HOW TO REWRITE BULLETS:
- Use the JD's EXACT keywords, tool names, and methodology terms directly in the bullet.
- Example: JD says "microservices" and resume says "built backend modules" → rewrite to "architected and deployed microservices for backend systems"
- Example: JD says "CI/CD with Jenkins" and resume says "automated deployment" → rewrite to "implemented CI/CD pipelines using Jenkins for automated deployment"
- Keep the same achievement type and any metrics from the original.
- The proposed text MUST be within ±3 characters of the original length.

### BOLD KEYWORDS:
For each change, also output a "boldKeywords" array containing the 2-4 most important JD-relevant keywords/phrases in the proposed text that should be visually emphasized. These should be exact substrings of the proposed text.
Example: if proposed is "architected and deployed microservices for distributed backend systems using Kubernetes", then boldKeywords could be ["microservices", "Kubernetes"].

### WHAT IS FROZEN (NEVER CHANGE):
- Company names, role titles, and date ranges
- Project title/heading lines (the first line of each project — often blue/linked text with project name and tech stack)
- Education and Certificates sections entirely
- Header/Contact section entirely

## CRITICAL LENGTH RULE
For every change, the "proposed" text MUST have the EXACT same character count as the "original" text (±3 chars max).
Count carefully. If original is 120 characters, proposed must be 117-123 characters.
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
- Suggest 8 to 15 high-impact changes
- "original" must EXACTLY match text that exists in the resume — no paraphrasing, no trimming
- NEVER touch frozen fields (company names, role titles, dates, project names/titles/links)
- For KPIT: exactly 2 bullet point changes, no more
- For projects: NEVER change the heading/title line — only bullet points under it
- Maintain the same character length (±3 chars) for every proposed change
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
  softInstructions: string
): Promise<OptimizationResult> {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-pro',
    systemInstruction: REVAMP_SYSTEM_INSTRUCTION,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.3,
    },
  })


  const prompt = buildRevampPrompt(resume, jobDescription, hardInstructions, softInstructions)
  const result = await model.generateContent(prompt)
  const raw = JSON.parse(result.response.text())

  const MAX_CHAR_DIFF = 5 // same limit as optimizer — reject changes that exceed this

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
