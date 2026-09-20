/**
 * The jobs a user has picked up, and how far each one has got.
 *
 * Client-safe: the panel and the route that validates its writes read the same
 * list from here, so a status the screen can set is always one the server will
 * take.
 *
 * The stages are the ones a person actually moves through, and nothing moves
 * them but the person. Sending an email is not applying, and a product that
 * advances this on the user's behalf turns the one screen they keep as their
 * own record into a screen that guesses.
 */

export const JOB_STATUSES = ['saved', 'applied', 'interviewing', 'offer', 'closed'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export const STATUS_LABELS: Record<JobStatus, string> = {
  saved: 'Saved',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  closed: 'Closed',
}

export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === 'string' && (JOB_STATUSES as readonly string[]).includes(value)
}

/** A captured job as the browser sees it: dates are strings over the wire. */
export interface JobRow {
  id: string
  url: string
  source: string
  title: string
  company: string
  location: string
  description: string
  status: string
  score: number | null
  tailoringId: string | null
  capturedAt: string
  updatedAt: string
}

/** What to call a job whose posting gave no title. */
export const describeJob = (job: { title: string; company: string }): string =>
  job.title && job.company ? `${job.title} at ${job.company}` : job.title || job.company || 'A saved job'
