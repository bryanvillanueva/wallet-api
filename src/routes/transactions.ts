import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

const router = Router();

// Zod schemas for validation
const transactionTypeEnum = z.enum(['income', 'expense', 'transfer', 'adjustment']);

const createTransactionSchema = z.object({
  user_id: z.number().int().positive(),
  pay_period_id: z.number().int().positive().nullable().optional(),
  account_id: z.number().int().positive(),
  category_id: z.number().int().positive().nullable().optional(),
  type: transactionTypeEnum,
  amount_cents: z.number().int(),
  description: z.string().optional().nullable(),
  txn_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  planned_payment_id: z.number().int().positive().nullable().optional(),
  counterparty_user_id: z.number().int().positive().nullable().optional()
});

// Validation function for amount_cents sign
function validateAmountSign(type: string, amount_cents: number): boolean {
  if (type === 'income' || type === 'adjustment') {
    // Should be positive (incoming money)
    return amount_cents > 0;
  } else if (type === 'expense' || type === 'transfer') {
    // Should be negative (outgoing money)
    return amount_cents < 0;
  }
  return false;
}

// GET /api/transactions/user/:userId - Get transactions with filters
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId || '0');

    if (isNaN(userId) || userId <= 0) {
      return res.status(400).json({
        error: 'Invalid user ID'
      });
    }

    // Parse query parameters
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const payPeriodId = req.query.pay_period_id ? parseInt(req.query.pay_period_id as string) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

    // Build query
    let query = `
      SELECT id, user_id, pay_period_id, account_id, category_id, type,
             amount_cents, description, txn_date, planned_payment_id,
             counterparty_user_id, created_at
      FROM transactions
      WHERE user_id = ?
    `;
    const params: any[] = [userId];

    if (from) {
      query += ' AND txn_date >= ?';
      params.push(from);
    }

    if (to) {
      query += ' AND txn_date <= ?';
      params.push(to);
    }

    if (payPeriodId) {
      query += ' AND pay_period_id = ?';
      params.push(payPeriodId);
    }

    query += ' ORDER BY txn_date DESC, created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [transactions] = await db.query<RowDataPacket[]>(query, params);

    return res.json(transactions);

  } catch (error) {
    console.error('Error fetching transactions:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// POST /api/transactions - Create a new transaction
router.post('/', async (req: Request, res: Response) => {
  try {
    // Validate request body
    const validatedData = createTransactionSchema.parse(req.body);

    // Validate amount_cents sign
    if (!validateAmountSign(validatedData.type, validatedData.amount_cents)) {
      return res.status(400).json({
        error: `Invalid amount sign for type '${validatedData.type}'. ` +
               `${validatedData.type === 'income' || validatedData.type === 'adjustment'
                 ? 'Amount must be positive (>0)'
                 : 'Amount must be negative (<0)'}`
      });
    }

    // Verify user exists
    const [users] = await db.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE id = ?',
      [validatedData.user_id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    // Verify account exists and belongs to user
    const [accounts] = await db.query<RowDataPacket[]>(
      'SELECT id FROM accounts WHERE id = ? AND user_id = ?',
      [validatedData.account_id, validatedData.user_id]
    );

    if (accounts.length === 0) {
      return res.status(404).json({
        error: 'Account not found or does not belong to user'
      });
    }

    // Verify category exists (if provided)
    if (validatedData.category_id) {
      const [categories] = await db.query<RowDataPacket[]>(
        'SELECT id FROM categories WHERE id = ?',
        [validatedData.category_id]
      );

      if (categories.length === 0) {
        return res.status(404).json({
          error: 'Category not found'
        });
      }
    }

    // Verify pay_period exists (if provided)
    if (validatedData.pay_period_id) {
      const [payPeriods] = await db.query<RowDataPacket[]>(
        'SELECT id FROM pay_periods WHERE id = ? AND user_id = ?',
        [validatedData.pay_period_id, validatedData.user_id]
      );

      if (payPeriods.length === 0) {
        return res.status(404).json({
          error: 'Pay period not found or does not belong to user'
        });
      }
    }

    // Insert transaction
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO transactions (
        user_id, pay_period_id, account_id, category_id, type,
        amount_cents, description, txn_date, planned_payment_id, counterparty_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        validatedData.user_id,
        validatedData.pay_period_id || null,
        validatedData.account_id,
        validatedData.category_id || null,
        validatedData.type,
        validatedData.amount_cents,
        validatedData.description || null,
        validatedData.txn_date,
        validatedData.planned_payment_id || null,
        validatedData.counterparty_user_id || null
      ]
    );

    return res.status(201).json({
      id: result.insertId
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.issues
      });
    }

    console.error('Error creating transaction:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// DELETE /api/transactions/:id - Delete a transaction (optional)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const transactionId = parseInt(req.params.id || '0');

    if (isNaN(transactionId) || transactionId <= 0) {
      return res.status(400).json({
        error: 'Invalid transaction ID'
      });
    }

    // Check if transaction exists
    const [transactions] = await db.query<RowDataPacket[]>(
      'SELECT id FROM transactions WHERE id = ?',
      [transactionId]
    );

    if (transactions.length === 0) {
      return res.status(404).json({
        error: 'Transaction not found'
      });
    }

    // Delete transaction
    await db.query('DELETE FROM transactions WHERE id = ?', [transactionId]);

    return res.json({
      deleted: true
    });

  } catch (error) {
    console.error('Error deleting transaction:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

export default router;
