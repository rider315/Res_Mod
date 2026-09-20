import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'

/**
 * Delete an account's personal data, in one transaction: its resumes, its
 * tailoring history and cover letters, its recruiters, emails and replies, its
 * outreach settings and connected mailbox, the jobs its browser extension
 * captured and the keys that extension held, and its name and email. Unused
 * credits are forfeited with a ledger entry, so the ledger still adds up.
 *
 * What stays holds nothing personal: payment, order and subscription records,
 * which accounting needs, and the usage counters, still under the anonymous
 * account id so that deleting and signing in again can't reset free runs.
 * Signing in again starts an empty account under that same id.
 */
export async function deleteAccountData(userId: string): Promise<void> {
  const db = getDb()
  await db.batch([
    // Directory claims give their places back, so a deleted account doesn't hold
    // a published recruiter closed against everyone else for good.
    db.execute(sql`
      update directory_recruiters set taken_count = greatest(0, taken_count - 1)
      where id in (select recruiter_id from directory_claims where user_id = ${userId})`),
    db.execute(sql`delete from directory_claims where user_id = ${userId}`),
    // Every browser extension connected to this account stops here. The rows
    // cascade from users, but this batch anonymises that row rather than
    // deleting it, so the cascade never fires — a key left behind would keep
    // answering for an account its owner believes is gone.
    db.execute(sql`delete from extension_tokens where user_id = ${userId}`),
    // Captured jobs say which roles somebody was applying for, which is as
    // personal as the rest of this. Before tailorings, which they point at.
    db.execute(sql`delete from captured_jobs where user_id = ${userId}`),
    // Outreach and history first: deleting a resume would otherwise update rows this batch is deleting.
    db.execute(sql`delete from outreach_replies where user_id = ${userId}`),
    db.execute(sql`delete from outreach_emails where user_id = ${userId}`),
    db.execute(sql`delete from recruiters where user_id = ${userId}`),
    db.execute(sql`delete from outreach_profiles where user_id = ${userId}`),
    db.execute(sql`delete from mail_accounts where user_id = ${userId}`),
    db.execute(sql`delete from cover_letters where user_id = ${userId}`),
    db.execute(sql`delete from tailorings where user_id = ${userId}`),
    db.execute(sql`delete from resumes where user_id = ${userId}`),
    db.execute(sql`
      insert into credit_ledger (user_id, delta, reason)
      select user_id, -balance, 'account_deleted' from credit_balances where user_id = ${userId} and balance > 0`),
    db.execute(sql`update credit_balances set balance = 0, updated_at = now() where user_id = ${userId}`),
    db.execute(sql`update users set email = 'deleted+' || id || '@deleted.invalid', name = null where id = ${userId}`),
  ])
}
