import { LATEX_RULES, ResumeProfile, STRUCTURAL_LINE } from '@/lib/profiles/types'

/**
 * Himanshu's resume layout — resumes/himanshu.tex.
 *
 * The important difference from Gaurav's: work experience is grouped by client
 * engagement. Under the employer line sit one or more "[Group] Project: <name>
 * -- <Bank>" sub-headings, each followed by its own bullets. Those sub-headings
 * name real clients and banking systems, so they are frozen — rewriting one
 * would invent an engagement that never happened, which is the one thing this
 * tool must never do.
 *
 * That grouping is also why this profile's coverage rule counts groups rather
 * than sections: with a flat quota, the first engagement absorbs every rewrite
 * and the second stays untouched.
 */

const SECTION_RULES = `## SECTION-LEVEL RULES (these override everything else):

${LATEX_RULES}

### SUMMARY section:
- One paragraph, and the first thing both a recruiter and an ATS read. It MUST carry the JD's job title and its top 4-6 keywords, each in \\textbf{}.
- Keep it honest: only claim what the rest of the resume evidences. This is enterprise banking/payments plus GenAI side work.
- Keep it to roughly the same length — 3 to 4 lines.

### TECHNICAL SKILLS section:
- Seven labelled lines of the form \\textbf{Category:} item, item, item.
- **KEEP THE CATEGORY LABEL EXACTLY AS IT IS**, including the \\textbf{} wrapper and the colon. Rewrite only the comma-separated items after it.
- You may REORDER items so JD-relevant ones come first, and REPLACE less-relevant items with JD-critical ones. Be AGGRESSIVE.
- **CRITICAL CATEGORY MATCHING**: languages (Java, Python, C++, SQL) go on the "Languages:" line; frameworks and messaging on "Backend & Systems:"; models and AI tooling on "AI & Machine Learning:"; stores on "Databases & Caching:"; infra on "Cloud & DevOps:"; UI on "Frontend:"; theory on "CS Fundamentals:". NEVER move an item across lines.
- Do NOT merge, split, add or remove lines. Keep all seven.
- **KEEP THE LINE A SIMILAR LENGTH**: drop the least relevant items to make room. Stay within about 20% of the original length.

### EXPERIENCE section:
- The employer line is a frozen [Role] line. Never rewrite it.
- **THIS RESUME GROUPS WORK BY CLIENT ENGAGEMENT.** Under the employer sit [Group] lines of the form "Project: <name> -- <client bank>".
- **EVERY [Group] LINE IS COMPLETELY FROZEN.** Never rewrite, reword or return a change for one. They name real clients and banking systems.
- ONLY the bullets beneath each [Group] line may be rewritten.
- **CRITICAL — ATS KEYWORD INJECTION**: for EACH [Group] engagement separately, rewrite at least 2 of its bullets to DIRECTLY USE the JD's exact keywords, tool names and methodologies, in \\textbf{}. Covering only the first engagement is not acceptable.
- Do NOT "softly align" — restructure the sentence around the JD's terminology while preserving the achievement and every metric.
- Keep the domain honest: this is enterprise banking and payments work. Frame the JD's keywords through the payment, verification and integration work already described rather than inventing a new domain.

### PROJECTS section:
- Project titles and stack summaries sit on frozen [Project] lines. Never rewrite them.
- ONLY the bullets beneath each project may change.
- Rewrite at least 2 bullets per project using the JD's exact terminology.
- Keep the stated technologies truthful to the project, but lead with whichever ones the JD asks for.

### EDUCATION section:
- DO NOT modify anything. All three entries are frozen.

### CERTIFICATIONS & ACHIEVEMENTS section:
- DO NOT modify anything. These are factual credentials.

### SOFT SKILLS section:
- A single line of skills separated by $|$.
- You may swap a skill name for a JD-relevant one, but keep the same count and the $|$ separators exactly as they are.
- No bold, no other formatting.

### HEADER / CONTACT section:
- DO NOT modify anything. Skip this section entirely.`

const REVAMP_SECTION_RULES = `## SECTION-LEVEL RULES (these override everything else):

${LATEX_RULES}

### SUMMARY section:
- Rewrite completely around the JD: lead with its job title, saturate with its top keywords in \\textbf{}.
- Stay honest — every claim must be evidenced elsewhere in the resume.

### TECHNICAL SKILLS section:
- Keep all seven \\textbf{Category:} labels exactly as written; rewrite only the items after them.
- Be VERY AGGRESSIVE — swap out any item the JD does not mention for one it requires, up to 5 per line.
- **CRITICAL CATEGORY MATCHING**: never move an item across lines.
- Stay within about 20% of the original line length.

### EXPERIENCE section:
- The [Role] employer line and every [Group] client line are FROZEN — never return a change for either.
- ONLY the bullets beneath each [Group] line may be rewritten.
- **CRITICAL — ATS KEYWORD SATURATION**: for EACH [Group] engagement separately, rewrite at least 2 bullets with the JD's exact keywords in \\textbf{}. Every engagement must be covered, not just the first.
- COMPLETELY RESTRUCTURE each bullet around the JD's language while keeping the achievement and every metric.
- Keep the domain honest: express the JD's keywords through the payment, verification and integration work already described.

### PROJECTS section:
- [Project] title lines are FROZEN.
- Rewrite at least 2 bullets per project with the JD's exact terminology.
- Keep "proposed" within about 30% of the original length.

### EDUCATION section:
- DO NOT modify anything.

### CERTIFICATIONS & ACHIEVEMENTS section:
- DO NOT modify anything.

### SOFT SKILLS section:
- One line separated by $|$. Swap names for JD-relevant ones, keep the count and the separators.

### HEADER / CONTACT section:
- DO NOT modify anything.`

export const himanshuProfile: ResumeProfile = {
  id: 'himanshu',
  label: 'Himanshu',
  personName: 'Himanshu Kumar',
  description: 'Banking/backend LaTeX resume; work grouped under frozen client engagements',
  texFile: 'himanshu.tex',

  sectionRules: SECTION_RULES,
  revampSectionRules: REVAMP_SECTION_RULES,

  promptNotes: `## LAYOUT REMINDERS FOR THIS RESUME
- This is LaTeX. Return LaTeX in "proposed", bold injected keywords with \\textbf{}, and escape % & _ # as \\% \\& \\_ \\#.
- Work experience is split into [Group] client engagements. Treat each group as its own role:
  rewrite at least 2 bullets in EVERY group, not just the first one.
- Never return a change whose "original" starts with [Role], [Group] or [Project] — those are frozen.
- The domain is enterprise banking and payments; keep JD keywords expressed through that work.`,

  coverage: {
    frozenSection: /education|certificat|achievement|award|header|contact/i,
    experienceSection: /experience|employment|work history|professional background/i,
    projectSection: /project/i,
    minBulletLength: 40,
    frozenLinePatterns: [STRUCTURAL_LINE],
    /**
     * Two rewrites per client engagement / per project, rather than two for the
     * whole section — otherwise one engagement absorbs the quota and the others
     * stay untouched.
     */
    requiredChanges: (section, bulletCount) => {
      const groups = section.content.filter((line) =>
        /^\s*\[(Group|Project)\]/.test(line)
      ).length
      return Math.min(2 * Math.max(groups, 1), bulletCount)
    },
  },

  length: {
    maxGrowth: (len) => Math.max(50, Math.round(len * 0.6)),
    minLength: (len) => (len <= 25 ? 1 : Math.ceil(len * 0.6)),
  },
}
