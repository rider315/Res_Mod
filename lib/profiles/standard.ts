import { LATEX_RULES, ResumeProfile, STRUCTURAL_LINE } from '@/lib/profiles/types'
import { LEVELS, TailorLevel } from '@/lib/tailor/levels'

/**
 * The layout rules for the house template every imported resume is rendered into
 * (lib/import/render.ts), with the rewrite quotas and length limits of the chosen
 * tailoring level. Nothing here is specific to a person.
 */

/** Sections that hold facts. No tailoring level rewrites them. */
export const STANDARD_FROZEN_SECTION =
  /education|achievement|publication|award|certificat|licen[cs]e|patent|header|contact|^\s*languages?\s*$|interest|hobb|reference/i

const SECTION_RULES = `## SECTION RULES FOR THIS RESUME
${LATEX_RULES}

### SUMMARY
- One paragraph, and the first thing both a recruiter and an ATS read. It should name the target job title.

### TECHNICAL SKILLS
- Lines of the form \\textbf{Category:} item, item, item. Keep each \\textbf{Category:} label exactly as written, including the colon, and change only the items after it.
- Put every skill in the line of the category it belongs to. Do not merge, split, add or remove lines, and do not bold individual skills.

### EXPERIENCE AND PROJECTS
- [Role], [Project] and [Group] lines are frozen headings. Only the bullets under them change.

### FACTS THAT NEVER CHANGE
- Education, certifications, licences, awards, publications, patents, spoken languages, interests and the header hold facts. Return no changes for them.

### ANYTHING ELSE
- Other editable lines, such as soft skills, may be reworded to use the job description's terms.`

export function standardProfile(level: TailorLevel): ResumeProfile {
  const spec = LEVELS[level]
  return {
    id: 'standard',
    label: 'Imported resume',
    personName: '',
    description: 'The house template every imported resume is rendered into',
    texFile: '',
    sectionRules: SECTION_RULES,
    revampSectionRules: SECTION_RULES,
    promptNotes: '',
    coverage: {
      frozenSection: STANDARD_FROZEN_SECTION,
      experienceSection: /experience|employment|work history|professional background/i,
      projectSection: /project/i,
      minBulletLength: 30,
      frozenLinePatterns: [STRUCTURAL_LINE],
      requiredChanges: (_section, bulletCount) => spec.bulletsPerSection(bulletCount),
    },
    length: spec.length,
  }
}
