import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'

/**
 * Delete an account's personal data, in one transaction: its resumes, its
 * tailoring history, and its name and email. Unused credits are forfeited with a
 * ledger entry, so the ledger still adds up.
 *
 * What stays holds nothing personal: payment, order and subscription records,
 * which accounting needs, and the usage counters, still under the anonymous
 * account id so that deleting and signing in again can't reset free runs.
 * Signing in again starts an empty account under that same id.
 */
export async function deleteAccountData(userId: string): Promise<void> {
  const db = getDb()
  await db.batch([
    // History first: deleting a resume would otherwise update history rows this batch is deleting.
    db.execute(sql`delete from tailorings where user_id = ${userId}`),
    db.execute(sql`delete from resumes where user_id = ${userId}`),
    db.execute(sql`
      insert into credit_ledger (user_id, delta, reason)
      select user_id, -balance, 'account_deleted' from credit_balances where user_id = ${userId} and balance > 0`),
    db.execute(sql`update credit_balances set balance = 0, updated_at = now() where user_id = ${userId}`),
    db.execute(sql`update users set email = 'deleted+' || id || '@deleted.invalid', name = null where id = ${userId}`),
  ])
}
