import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

const router = Router();

// Zod schemas for validation
const createSavingEntrySchema = z.object({
  user_id: z.number().int().positive(),
  pay_period_id: z.number().int().positive().nullable().optional(),
  account_id: z.number().int().positive(),
  amount_cents: z.number().int().refine(val => val !== 0, 'Amount cannot be zero'),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  note: z.string().optional().nullable()
});

// GET /api/savings/entries/user/:userId - Get saving entries for a user
router.get('/entries/user/:userId', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId || '0');

    if (isNaN(userId) || userId <= 0) {
      return res.status(400).json({
        error: 'Invalid user ID'
      });
    }

    // Parse query parameters
    const payPeriodId = req.query.pay_period_id ? parseInt(req.query.pay_period_id as string) : undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    // Build query
    let query = `
      SELECT id, user_id, pay_period_id, account_id, amount_cents, entry_date, note, created_at
      FROM saving_entries
      WHERE user_id = ?
    `;
    const params: any[] = [userId];

    if (payPeriodId) {
      query += ' AND pay_period_id = ?';
      params.push(payPeriodId);
    }

    if (from) {
      query += ' AND entry_date >= ?';
      params.push(from);
    }

    if (to) {
      query += ' AND entry_date <= ?';
      params.push(to);
    }

    query += ' ORDER BY entry_date DESC, created_at DESC';

    const [entries] = await db.query<RowDataPacket[]>(query, params);

    return res.json(entries);

  } catch (error) {
    console.error('Error fetching saving entries:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// POST /api/savings/entries - Create a new saving entry
router.post('/entries', async (req: Request, res: Response) => {
  try {
    // Validate request body
    const validatedData = createSavingEntrySchema.parse(req.body);

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
      'SELECT id, type FROM accounts WHERE id = ? AND user_id = ?',
      [validatedData.account_id, validatedData.user_id]
    );

    if (accounts.length === 0) {
      return res.status(404).json({
        error: 'Account not found or does not belong to user'
      });
    }

    // Verify pay_period exists and belongs to user (if provided)
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

    // Insert saving entry
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO saving_entries (user_id, pay_period_id, account_id, amount_cents, entry_date, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        validatedData.user_id,
        validatedData.pay_period_id || null,
        validatedData.account_id,
        validatedData.amount_cents,
        validatedData.entry_date,
        validatedData.note || null
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

    console.error('Error creating saving entry:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

export default router;
