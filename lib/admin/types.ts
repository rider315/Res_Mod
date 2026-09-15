/** The owner's Business overview (GET /api/admin/overview). Client-safe types. */

export type CheckState = 'ok' | 'warn' | 'missing'

export interface SetupCheck {
  label: string
  state: CheckState
  detail: string
}

export interface AdminOverview {
  /** Whether each thing the business needs is set up, and what to do when it isn't. */
  checks: SetupCheck[]
  numbers: {
    users: number
    newUsersThisMonth: number
    resumes: number
    tailorings: number
    freeRunsUsedThisMonth: number
    /** Credits spent on runs this month, less runs given back. */
    creditsSpentThisMonth: number
    creditsOutstanding: number
    activeSubscriptions: number
    revenueThisMonthPaise: number
    revenueTotalPaise: number
  }
  subscriptions: Array<{
    id: string
    email: string | null
    status: string
    currentEnd: string | null
    cancelAtCycleEnd: boolean
    createdAt: string | null
  }>
  payments: Array<{
    id: string
    email: string | null
    kind: string
    amount: number
    currency: string
    createdAt: string | null
  }>
}
