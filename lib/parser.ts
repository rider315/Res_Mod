import { docs_v1 } from 'googleapis'
import { ParsedResume, ResumeSection } from '@/types/resume'

const HEADING_STYLES = new Set([
  'HEADING_1', 'HEADING_2', 'HEADING_3', 'TITLE',
])

function extractText(paragraph: docs_v1.Schema$Paragraph): string {
  return (paragraph.elements || [])
    .map((el) => el.textRun?.content ?? '')
    .join('')
    .trim()
}

function isHeading(paragraph: docs_v1.Schema$Paragraph): boolean {
  return HEADING_STYLES.has(paragraph.paragraphStyle?.namedStyleType ?? '')
}

export function parseDocument(doc: docs_v1.Schema$Document): ParsedResume {
  const bodyContent = doc.body?.content ?? []
  const sections: ResumeSection[] = []
  let current: ResumeSection | null = null
  let idx = 0

  for (const element of bodyContent) {
    const para = element.paragraph
    if (!para) continue
    const text = extractText(para)
    if (!text) continue

    if (isHeading(para)) {
      if (current) sections.push(current)
      current = { id: `section_${idx++}`, title: text, content: [] }
    } else {
      if (!current) {
        current = { id: 'section_header', title: 'Header / Contact', content: [] }
      }
      current.content.push(text)
    }
  }

  if (current) sections.push(current)

  return {
    documentId: doc.documentId!,
    title: doc.title ?? 'Resume',
    sections,
  }
}