import { ResumeProfile } from '@/lib/profiles/types'

/**
 * Himanshu's resume layout.
 *
 * The important difference from Gaurav's: work experience is grouped by client
 * engagement. Under the employer line sit one or more "Project : <name> - <Bank>"
 * sub-headings, each followed by its own bullets. Those sub-headings name real
 * clients and banking systems, so they are frozen — rewriting them would invent
 * an engagement that never happened, which is the one thing this tool must never
 * do. Gaurav's resume has no equivalent line, which is why the two profiles need
 * separate section rules.
 *
 * Other layout differences handled below:
 *  - the projects section is titled "Project Work", not "Projects"
 *  - education lists three numbered entries rather than one line
 *  - several project bullets open with an inline label ("Security:",
 *    "Deployment and Design:") that must survive the rewrite
 *  - awards and soft skills are numbered lists
 */

const SECTION_RULES = `## SECTION-LEVEL RULES (these override everything else):

### SKILLS section:
- Two labelled lines: "Languages:" and "Technologies & Tools :". Keep BOTH labels exactly as written, including the space before the colon in "Technologies & Tools :".
- You may REORDER skills so JD-relevant ones come first, and REPLACE less-relevant skills with JD-critical ones. Be AGGRESSIVE — if the JD names a technology the resume lacks, swap in the JD's term for the least relevant existing one.
- **CRITICAL CATEGORY MATCHING**: languages (C++, Python, Java, SQL) belong on the "Languages:" line. Frameworks, tools, platforms and concepts (Spring Boot, Kafka, Jenkins, Microservices) belong on the "Technologies & Tools :" line. NEVER move an item across those two lines.
- Do NOT merge the two lines, split them, or change how many lines there are.
- **KEEP THE LINE A SIMILAR LENGTH**: if adding JD skills makes a line noticeably longer, drop the least relevant existing entries to make room. Aim to stay within about 20% of the original line length.

### WORK EXPERIENCE section:
- The employer line (company, city, dates, job title) is FROZEN — never modify it.
- **THIS RESUME GROUPS WORK BY CLIENT PROJECT.** Under the employer line are one or more sub-headings of the form "Project : <project name> - <client>".
- **EVERY LINE STARTING WITH "Project :" IS COMPLETELY FROZEN.** Never rewrite, reword, shorten, or generate a change for those lines. They name real clients and banking systems; altering them fabricates experience.
- ONLY the bullet points beneath each "Project :" sub-heading may be rewritten.
- **CRITICAL — ATS KEYWORD INJECTION**: for EACH "Project :" group separately, rewrite at least 2 of its bullets to DIRECTLY USE the JD's exact keywords, tool names, methodologies and domain terms. Covering only the first group is not acceptable.
- Do NOT just "softly align" — restructure the whole sentence around the JD's terminology while preserving the achievement and any metric.
- Keep the domain honest: this is enterprise banking/payments work. Frame JD keywords in terms of the payment, verification and integration work already described rather than inventing a new domain.

### EDUCATION section:
- DO NOT modify anything. Skip this section entirely. All three numbered entries are frozen.

### PROJECT WORK section:
- This section is titled "Project Work".
- Each project starts with a numbered title line ("1. Secure Lab | An Encryption/Decryption Website."). Those numbered TITLE LINES ARE FROZEN — never rewrite them.
- ONLY the bullet points beneath each numbered title may be rewritten.
- Rewrite at least 2 bullets per project using the JD's exact terminology.
- **PRESERVE INLINE LABELS**: some bullets begin with a label followed by a colon ("Security:", "Deployment and Design:"). Keep that label and its colon exactly as-is and rewrite only the text after it.
- Keep the stated technologies truthful to the project, but lead with whichever ones the JD asks for.

### AWARDS AND CERTIFICATES section:
- DO NOT modify anything. Skip this section entirely. The certification names are factual credentials.

### SOFT SKILLS section:
- A numbered list of five short skill names.
- In "original" and "proposed", include ONLY the skill text (e.g. "Communication Skills"), never the "1." number prefix.
- Note that several entries have a trailing space in the document; do not let that change the wording you propose.
- You may replace a skill name with a JD-relevant one, but keep exactly five entries and keep each name short.
- Do NOT add bold, italic or any formatting markers.

### HEADER / CONTACT section:
- DO NOT modify anything. Skip this section entirely.`

const REVAMP_SECTION_RULES = `## SECTION-LEVEL RULES (these override everything else):

### SKILLS section:
- Two labelled lines: "Languages:" and "Technologies & Tools :". Keep BOTH labels exactly as written, including the space before the colon in "Technologies & Tools :".
- Be VERY AGGRESSIVE — swap out any skill the JD does not mention for one it explicitly requires.
- **KEEP THE LINE A SIMILAR LENGTH**: remove up to 5 of the least relevant entries to make room. Aim to stay within about 20% of the original line length.
- **CRITICAL CATEGORY MATCHING**: languages stay on the "Languages:" line; frameworks, tools, platforms and concepts stay on the "Technologies & Tools :" line. NEVER move an item across those two lines.
- Preserve the exact formatting structure: two lines, label then comma-separated items.

### WORK EXPERIENCE section:
- The employer line (company, city, dates, job title) is FROZEN — never modify it.
- **THIS RESUME GROUPS WORK BY CLIENT PROJECT.** Under the employer line are sub-headings of the form "Project : <project name> - <client>".
- **EVERY LINE STARTING WITH "Project :" IS COMPLETELY FROZEN.** Never rewrite, reword, or generate a change for those lines — they name real clients and banking systems.
- ONLY the bullets beneath each "Project :" sub-heading may be rewritten.
- **CRITICAL — ATS KEYWORD SATURATION**: for EACH "Project :" group separately, rewrite at least 2 of its bullets to directly use the JD's exact keywords, tools and methodologies. Every group must be covered, not just the first.
- COMPLETELY RESTRUCTURE each bullet around the JD's language while keeping the achievement and any metric.
- Keep the domain honest: this is enterprise banking/payments work. Express JD keywords through the payment, verification and integration work already described.

### EDUCATION section:
- DO NOT modify anything. Skip this section entirely.

### PROJECT WORK section:
- This section is titled "Project Work".
- The numbered project TITLE LINES are FROZEN — never rewrite them.
- ONLY the bullets beneath each numbered title may be rewritten.
- Rewrite at least 2 bullets per project with the JD's exact terminology.
- **PRESERVE INLINE LABELS**: bullets beginning with a label and colon ("Security:", "Deployment and Design:") keep that prefix exactly; rewrite only the text after it.

### AWARDS AND CERTIFICATES section:
- DO NOT modify anything. Skip this section entirely.

### SOFT SKILLS section:
- A numbered list of five short skill names.
- Include ONLY the skill text in "original" and "proposed", never the "1." number prefix.
- Replace names with JD-relevant ones but keep exactly five entries, each short.
- No bold, italic or formatting markers.

### HEADER / CONTACT section:
- DO NOT modify anything. Skip this section entirely.`

/** Sub-headings inside work experience that name a real client engagement. */
const PROJECT_SUBHEADING = /^\s*Project\s*:/i
/** Numbered project titles in the "Project Work" section. */
const NUMBERED_PROJECT_TITLE = /^\s*\d+\s*\.\s+\S/

export const himanshuProfile: ResumeProfile = {
  id: 'himanshu',
  label: 'Himanshu',
  description: 'Work grouped under frozen "Project :" client sub-headings; "Project Work" section',
  defaultDocUrl: 'https://docs.google.com/document/d/1XqtDp4AFp7BQHHDO2XE9f4rgOi2aJ-pg6GaxmereYNA/edit',
  urlStorageKey: 'resmod_resume_url_himanshu',

  sectionRules: SECTION_RULES,
  revampSectionRules: REVAMP_SECTION_RULES,

  promptNotes: `## LAYOUT REMINDERS FOR THIS RESUME
- Work experience is split into "Project : ..." client groups. Treat each group as its own role:
  rewrite at least 2 bullets in EVERY group, not just the first one.
- Never generate a change whose "original" is a line starting with "Project :" — those are frozen.
- The projects section is titled "Project Work" and its numbered title lines are frozen.
- Bullets that begin with an inline label such as "Security:" or "Deployment and Design:" must keep
  that label and colon; rewrite only the text that follows.`,

  coverage: {
    frozenSection: /education|award|certificat|header|contact/i,
    experienceSection: /experience|employment|work history|professional background/i,
    // Matches the "Project Work" heading as well as a plain "Projects".
    projectSection: /project/i,
    minBulletLength: 40,
    // Client sub-headings and numbered project titles must never be offered as
    // rewrite candidates by the coverage top-up pass.
    frozenLinePatterns: [PROJECT_SUBHEADING, NUMBERED_PROJECT_TITLE],
    /**
     * Two rewrites per client group / per numbered project, rather than two for
     * the whole section — otherwise one engagement absorbs the quota and the
     * others stay untouched.
     */
    requiredChanges: (section, bulletCount) => {
      const groups = section.content.filter(
        (line) => PROJECT_SUBHEADING.test(line) || NUMBERED_PROJECT_TITLE.test(line)
      ).length
      return Math.min(2 * Math.max(groups, 1), bulletCount)
    },
  },

  length: {
    maxGrowth: (len) => Math.max(50, Math.round(len * 0.6)),
    minLength: (len) => (len <= 25 ? 1 : Math.ceil(len * 0.6)),
  },
}
