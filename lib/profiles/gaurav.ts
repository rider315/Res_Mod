import { LATEX_RULES, ResumeProfile, STRUCTURAL_LINE } from '@/lib/profiles/types'

/**
 * Gaurav's resume layout — resumes/gaurav.tex.
 *
 * Sections run: Header/Contact, Summary, Technical Skills, Experience, Projects,
 * Education, Achievements & Publications, Soft Skills. Work experience is a flat
 * list of bullets under each role, with no client sub-headings inside it.
 *
 * Each role and each project ends with a "Tech:" bullet listing its stack. Those
 * are ordinary editable bullets and are one of the highest-value things to
 * retune per job description, so the rules call them out explicitly.
 */

const SECTION_RULES = `## SECTION-LEVEL RULES (these override everything else):

${LATEX_RULES}

### SUMMARY section:
- One paragraph. This is the first thing a recruiter and an ATS both read, so it MUST carry the job title from the JD and its top 4-6 keywords.
- Rewrite it to mirror the JD's own language for the role (e.g. if the JD says "Forward Deployed Engineer", the summary should say that).
- Keep it honest: only claim experience the rest of the resume evidences.
- Keep it to roughly the same length — 3 to 4 lines.

### TECHNICAL SKILLS section:
- Several labelled lines, each of the form \\textbf{Category:} item, item, item.
- **KEEP THE CATEGORY LABEL EXACTLY AS IT IS**, including the \\textbf{} wrapper and the colon. Rewrite only the comma-separated items after it.
- You may REORDER items to put JD-relevant ones first, and REPLACE less-relevant items with JD-critical ones. Be AGGRESSIVE — if the JD requires a skill and this resume lists a weaker alternative, swap it.
- **CRITICAL CATEGORY MATCHING**: a language goes on the "Languages:" line, a database on the "Databases & Caching:" line, a cloud tool on the "Cloud & DevOps:" line, an AI technique on the "AI & Machine Learning:" line, a frontend/backend framework on the "Full Stack & Frontend:" line. NEVER move an item across categories.
- Do NOT merge, split, add or remove lines. Keep the same number of lines.
- **KEEP THE LINE A SIMILAR LENGTH**: if adding JD skills makes a line noticeably longer, drop the least relevant existing items to make room. Stay within about 20% of the original length.
- Do NOT bold the individual skills — only the category label is bold.

### EXPERIENCE section:
- Employer, role and dates live on frozen [Role] lines. Never rewrite those.
- ONLY the bullet points may change.
- **CRITICAL — ATS KEYWORD INJECTION**: for EVERY role, rewrite at least 2 bullets to DIRECTLY USE the JD's exact keywords, tool names, methodologies and domain terms, wrapped in \\textbf{}.
- Do NOT just "softly align" — REPLACE generic phrasing with JD-specific language. If the JD says "microservices architecture" and the bullet says "built backend modules", rewrite it to "architected \\textbf{microservices} for backend systems".
- Preserve the achievement and every metric. A bullet that says 40\\% must still say 40\\%.
- **THE "Tech:" BULLET**: each role ends with a bullet starting \\textbf{Tech:}. Keep that label, and retune the technology list after it to lead with the JD's stack. This is a cheap, high-value ATS win — do it for every role.
- Keep the domain honest. The Innodata role is AI/LLM evaluation work, KPIT is automotive embedded work, and the two internships are web development. Express the JD's keywords through the work that is actually described rather than relocating it to a new field.

### PROJECTS section:
- Project titles, links and tech-stack summaries sit on frozen [Project] lines. Never rewrite those.
- ONLY the bullet points under each project may change.
- Apply the SAME aggressive keyword injection as experience: at least 2 bullets per project.

### EDUCATION section:
- DO NOT modify anything. Skip this section entirely.

### ACHIEVEMENTS & PUBLICATIONS section:
- DO NOT modify anything. These are factual credentials with live links.

### SOFT SKILLS section:
- A single line of skills separated by $|$.
- You may swap a skill name for a JD-relevant one, but keep the same count and keep the $|$ separators exactly as they are.
- No bold, no other formatting.

### HEADER / CONTACT section:
- DO NOT modify anything. Skip this section entirely.`

const REVAMP_SECTION_RULES = `## SECTION-LEVEL RULES (these override everything else):

${LATEX_RULES}

### SUMMARY section:
- Rewrite it completely around the JD: lead with the JD's job title and saturate it with the JD's top keywords, each in \\textbf{}.
- Stay honest — every claim must be evidenced elsewhere in the resume.

### TECHNICAL SKILLS section:
- Keep every \\textbf{Category:} label exactly as written; rewrite only the items after it.
- Be VERY AGGRESSIVE — swap out any item the JD does not mention for one it explicitly requires, up to 5 swaps per line.
- **CRITICAL CATEGORY MATCHING**: never move an item across categories.
- Keep the same number of lines and stay within about 20% of the original line length.

### EXPERIENCE section:
- [Role] lines are frozen. Only bullets change.
- **CRITICAL — ATS KEYWORD SATURATION**: for EVERY role (not just the most recent), rewrite at least 2 bullets to directly use the JD's exact keywords, in \\textbf{}.
- COMPLETELY RESTRUCTURE each bullet around the JD's language rather than appending a keyword to the end.
- Preserve every metric. Keep "proposed" within about 30% of the original length.
- Retune the \\textbf{Tech:} bullet of every role to lead with the JD's stack.

### PROJECTS section:
- [Project] lines are frozen — never rewrite a project title, link or stack summary.
- Rewrite at least 2 bullets per project with the JD's terminology.
- Keep "proposed" within about 30% of the original length.

### EDUCATION section:
- DO NOT modify anything.

### ACHIEVEMENTS & PUBLICATIONS section:
- DO NOT modify anything.

### SOFT SKILLS section:
- One line separated by $|$. Swap names for JD-relevant ones, keep the count and the separators.

### HEADER / CONTACT section:
- DO NOT modify anything.`

export const gauravProfile: ResumeProfile = {
  id: 'gaurav',
  label: 'Gaurav',
  personName: 'Gaurav Chaudhary',
  description: 'AI / full-stack LaTeX resume; flat bullets per role, each ending in a Tech: line',
  texFile: 'gaurav.tex',

  sectionRules: SECTION_RULES,
  revampSectionRules: REVAMP_SECTION_RULES,

  promptNotes: `## LAYOUT REMINDERS FOR THIS RESUME
- This is LaTeX. Return LaTeX in "proposed", bold injected keywords with \\textbf{}, and escape % & _ # as \\% \\& \\_ \\#.
- Never return a change for a line starting with [Role] or [Project] — those are frozen.
- Every role and project ends with a bullet starting \\textbf{Tech:}. Keep that label and retune the list after it to match the JD's stack.
- The Summary is the highest-leverage line in the document: make it name the JD's job title.`,

  coverage: {
    frozenSection: /education|achievement|publication|award|certificat|header|contact/i,
    experienceSection: /experience|employment|work history|professional background/i,
    projectSection: /project/i,
    minBulletLength: 40,
    frozenLinePatterns: [STRUCTURAL_LINE],
    // Two rewrites per section, or fewer if there aren't that many bullets.
    requiredChanges: (_section, bulletCount) => Math.min(2, bulletCount),
  },

  length: {
    maxGrowth: (len) => Math.max(50, Math.round(len * 0.6)),
    minLength: (len) => (len <= 25 ? 1 : Math.ceil(len * 0.6)),
  },
}
