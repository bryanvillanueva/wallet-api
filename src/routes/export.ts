import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

const router = Router();

// Zod schema for import data validation
const importDataSchema = z.object({
  dryRun: z.boolean().optional().default(false),
  data: z.object({
    accounts: z.array(z.any()).optional(),
    categories: z.array(z.any()).optional(),
    pay_periods: z.array(z.any()).optional(),
    transactions: z.array(z.any()).optional(),
    planned_payments: z.array(z.any()).optional(),
    saving_entries: z.array(z.any()).optional(),
    saving_goals: z.array(z.any()).optional(),
    saving_entry_goals: z.array(z.any()).optional()
  })
});

// GET /api/export/user/:userId - Export all user data
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId || '0');

    if (isNaN(userId) || userId <= 0) {
      return res.status(400).json({
        error: 'Invalid user ID'
      });
    }

    // Verify user exists
    const [users] = await db.query<RowDataPacket[]>(
      'SELECT id, name, email FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    // Export accounts
    const [accounts] = await db.query<RowDataPacket[]>(
      'SELECT id, user_id, name, type, currency, is_active, created_at FROM accounts WHERE user_id = ?',
      [userId]
    );

    // Export categories (only personal categories for this user)
    const [categories] = await db.query<RowDataPacket[]>(
      'SELECT id, user_id, name, kind FROM categories WHERE user_id = ?',
      [userId]
    );

    // Export pay_periods
    const [pay_periods] = await db.query<RowDataPacket[]>(
      'SELECT id, user_id, pay_date, gross_income_cents, note, created_at FROM pay_periods WHERE user_id = ?',
      [userId]
    );

    // Export transactions
    const [transactions] = await db.query<RowDataPacket[]>(
      `SELECT id, user_id, pay_period_id, account_id, category_id, type, amount_cents,
              description, txn_date, planned_payment_id, counterparty_user_id, created_at
       FROM transactions WHERE user_id = ?`,
      [userId]
    );

    // Export planned_payments
    const [planned_payments] = await db.query<RowDataPacket[]>(
      `SELECT id, user_id, account_id, description, amount_cents, due_date,
              auto_debit, status, linked_txn_id, created_at
       FROM planned_payments WHERE user_id = ?`,
      [userId]
    );

    // Export saving_entries
    const [saving_entries] = await db.query<RowDataPacket[]>(
      `SELECT id, user_id, pay_period_id, account_id, amount_cents, entry_date, note, created_at
       FROM saving_entries WHERE user_id = ?`,
      [userId]
    );

    // Export saving_goals
    const [saving_goals] = await db.query<RowDataPacket[]>(
      `SELECT id, user_id, name, target_amount_cents, target_date, created_at
       FROM saving_goals WHERE user_id = ?`,
      [userId]
    );

    // Export saving_entry_goals (only for this user's entries)
    const [saving_entry_goals] = await db.query<RowDataPacket[]>(
      `SELECT seg.saving_entry_id, seg.goal_id
       FROM saving_entry_goals seg
       JOIN saving_entries se ON seg.saving_entry_id = se.id
       WHERE se.user_id = ?`,
      [userId]
    );

    const exportData = {
      user: users[0],
      exported_at: new Date().toISOString(),
      data: {
        accounts,
        categories,
        pay_periods,
        transactions,
        planned_payments,
        saving_entries,
        saving_goals,
        saving_entry_goals
      }
    };

    return res.json(exportData);

  } catch (error) {
    console.error('Error exporting user data:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// POST /api/import - Import user data
router.post('/', async (req: Request, res: Response) => {
  try {
    // Validate request body
    const validatedData = importDataSchema.parse(req.body);
    const { dryRun, data } = validatedData;

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    const results = {
      dryRun,
      inserted: 0,
      updated: 0,
      skipped: 0,
      details: {} as Record<string, any>
    };

    // Helper function to process imports
    const processImport = async (
      tableName: string,
      records: any[] | undefined,
      insertQuery: string,
      updateQuery?: string
    ) => {
      if (!records || records.length === 0) return { inserted: 0, updated: 0, skipped: 0 };

      let localInserted = 0;
      let localUpdated = 0;
      let localSkipped = 0;

      for (const record of records) {
        try {
          if (dryRun) {
            // In dry-run mode, just count what would be done
            localInserted++;
          } else {
            // Try to insert
            const values = Object.values(record);
            await db.query(insertQuery, values);
            localInserted++;
          }
        } catch (error: any) {
          // If duplicate key error and we have an update query, try to update
          if (error.code === 'ER_DUP_ENTRY' && updateQuery) {
            if (!dryRun) {
              const values = Object.values(record);
              await db.query(updateQuery, values);
            }
            localUpdated++;
          } else {
            localSkipped++;
          }
        }
      }

      return { inserted: localInserted, updated: localUpdated, skipped: localSkipped };
    };

    // Import accounts
    if (data.accounts) {
      const accountsResult = await processImport(
        'accounts',
        data.accounts,
        `INSERT INTO accounts (id, user_id, name, type, currency, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        `UPDATE accounts SET name=?, type=?, currency=?, is_active=? WHERE id=?`
      );
      results.details.accounts = accountsResult;
      inserted += accountsResult.inserted;
      updated += accountsResult.updated;
      skipped += accountsResult.skipped;
    }

    // Import categories
    if (data.categories) {
      const categoriesResult = await processImport(
        'categories',
        data.categories,
        `INSERT INTO categories (id, user_id, name, kind) VALUES (?, ?, ?, ?)`,
        `UPDATE categories SET name=?, kind=? WHERE id=?`
      );
      results.details.categories = categoriesResult;
      inserted += categoriesResult.inserted;
      updated += categoriesResult.updated;
      skipped += categoriesResult.skipped;
    }

    // Import pay_periods
    if (data.pay_periods) {
      const payPeriodsResult = await processImport(
        'pay_periods',
        data.pay_periods,
        `INSERT INTO pay_periods (id, user_id, pay_date, gross_income_cents, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        `UPDATE pay_periods SET gross_income_cents=?, note=? WHERE id=?`
      );
      results.details.pay_periods = payPeriodsResult;
      inserted += payPeriodsResult.inserted;
      updated += payPeriodsResult.updated;
      skipped += payPeriodsResult.skipped;
    }

    // Import transactions
    if (data.transactions) {
      const transactionsResult = await processImport(
        'transactions',
        data.transactions,
        `INSERT INTO transactions (id, user_id, pay_period_id, account_id, category_id, type,
                                   amount_cents, description, txn_date, planned_payment_id,
                                   counterparty_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      results.details.transactions = transactionsResult;
      inserted += transactionsResult.inserted;
      updated += transactionsResult.updated;
      skipped += transactionsResult.skipped;
    }

    // Import planned_payments
    if (data.planned_payments) {
      const plannedResult = await processImport(
        'planned_payments',
        data.planned_payments,
        `INSERT INTO planned_payments (id, user_id, account_id, description, amount_cents,
                                       due_date, auto_debit, status, linked_txn_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `UPDATE planned_payments SET status=?, linked_txn_id=? WHERE id=?`
      );
      results.details.planned_payments = plannedResult;
      inserted += plannedResult.inserted;
      updated += plannedResult.updated;
      skipped += plannedResult.skipped;
    }

    // Import saving_entries
    if (data.saving_entries) {
      const savingEntriesResult = await processImport(
        'saving_entries',
        data.saving_entries,
        `INSERT INTO saving_entries (id, user_id, pay_period_id, account_id, amount_cents,
                                     entry_date, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      results.details.saving_entries = savingEntriesResult;
      inserted += savingEntriesResult.inserted;
      updated += savingEntriesResult.updated;
      skipped += savingEntriesResult.skipped;
    }

    // Import saving_goals
    if (data.saving_goals) {
      const goalsResult = await processImport(
        'saving_goals',
        data.saving_goals,
        `INSERT INTO saving_goals (id, user_id, name, target_amount_cents, target_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        `UPDATE saving_goals SET name=?, target_amount_cents=?, target_date=? WHERE id=?`
      );
      results.details.saving_goals = goalsResult;
      inserted += goalsResult.inserted;
      updated += goalsResult.updated;
      skipped += goalsResult.skipped;
    }

    // Import saving_entry_goals
    if (data.saving_entry_goals) {
      const entryGoalsResult = await processImport(
        'saving_entry_goals',
        data.saving_entry_goals,
        `INSERT INTO saving_entry_goals (saving_entry_id, goal_id) VALUES (?, ?)`
      );
      results.details.saving_entry_goals = entryGoalsResult;
      inserted += entryGoalsResult.inserted;
      updated += entryGoalsResult.updated;
      skipped += entryGoalsResult.skipped;
    }

    results.inserted = inserted;
    results.updated = updated;
    results.skipped = skipped;

    return res.json(results);

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.issues
      });
    }

    console.error('Error importing data:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

export default router;
