import { GoogleGenerativeAI } from '@google/generative-ai'
import { ParsedResume, ResumeChange, OptimizationResult } from '@/types/resume'


const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)


const SYSTEM_INSTRUCTION = `You are an expert ATS resume optimizer. Your strict rules:
1. NEVER invent new experiences, companies, dates, or facts not in the original resume
2. ONLY rewrite or rephrase existing content — never add new roles or projects
3. Preserve all proper nouns: company names, project names, technologies, dates
4. Return ONLY a valid JSON object — no markdown fences, no extra commentary
5. Each "original" value must be an EXACT substring found in the resume content`


function buildPrompt(
  resume: ParsedResume,
  jobDescription: string,
  hardInstructions: string,
  softInstructions: string
): string {
  const resumeText = resume.sections
    .map((s) => `### ${s.title}\n${s.content.join('\n')}`)
    .join('\n\n')


  return `## RESUME TO OPTIMIZE
${resumeText}


## TARGET JOB DESCRIPTION
${jobDescription}


## HARD CONSTRAINTS — You MUST obey these exactly:
${hardInstructions || 'None'}


## SOFT GUIDELINES — Apply where appropriate:
${softInstructions || 'Use strong action verbs. Quantify achievements where possible. Align phrasing with keywords from the job description. Improve conciseness and clarity.'}


## OUTPUT FORMAT
Return this exact JSON structure:
{
  "summary": "One paragraph describing what was optimized and why",
  "keywordsAdded": ["keyword1", "keyword2"],
  "sectionsModified": ["Section Title 1", "Section Title 2"],
  "changes": [
    {
      "sectionId": "section_id from resume",
      "sectionTitle": "Section Title",
      "original": "exact verbatim text from resume (must be findable via string search)",
      "proposed": "improved replacement text",
      "reason": "why this change improves the resume for this specific role",
      "type": "rewrite|add_keywords|improve_clarity|action_verb"
    }
  ]
}


Rules:
- Suggest 8 to 15 high-impact changes only
- Never touch contact info or the Header/Contact section
- "original" must exactly match text that exists in the resume`
}


export async function optimizeResume(
  resume: ParsedResume,
  jobDescription: string,
  hardInstructions: string,
  softInstructions: string
): Promise<OptimizationResult> {
  // ✅ Use gemini-2.0-flash — fastest, cheapest, fully available
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  })


  const prompt = buildPrompt(resume, jobDescription, hardInstructions, softInstructions)
  const result = await model.generateContent(prompt)
  const raw = JSON.parse(result.response.text())


  const changes: ResumeChange[] = (raw.changes ?? []).map(
    (c: Omit<ResumeChange, 'id' | 'approved'>, i: number) => ({
      id: `change_${i}_${Date.now()}`,
      sectionId: c.sectionId,
      sectionTitle: c.sectionTitle,
      original: c.original,
      proposed: c.proposed,
      reason: c.reason,
      type: c.type ?? 'rewrite',
      approved: null,
    })
  )


  return {
    summary: raw.summary ?? '',
    keywordsAdded: raw.keywordsAdded ?? [],
    sectionsModified: raw.sectionsModified ?? [],
    changes,
  }
}