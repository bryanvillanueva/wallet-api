import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

const router = Router();

// Zod schemas for validation
const upsertPayPeriodSchema = z.object({
  user_id: z.number().int().positive(),
  pay_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  gross_income_cents: z.number().int().min(0).optional().default(0),
  note: z.string().optional().nullable()
});

// GET /api/pay-periods/user/:userId - Get all pay periods for a user
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId || '0');

    if (isNaN(userId) || userId <= 0) {
      return res.status(400).json({
        error: 'Invalid user ID'
      });
    }

    const [payPeriods] = await db.query<RowDataPacket[]>(
      `SELECT id, user_id, pay_date, gross_income_cents, note, created_at
       FROM pay_periods
       WHERE user_id = ?
       ORDER BY pay_date DESC`,
      [userId]
    );

    return res.json(payPeriods);

  } catch (error) {
    console.error('Error fetching pay periods:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// POST /api/pay-periods - Create or update a pay period (upsert)
router.post('/', async (req: Request, res: Response) => {
  try {
    // Validate request body
    const validatedData = upsertPayPeriodSchema.parse(req.body);

    // Check if user exists
    const [users] = await db.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE id = ?',
      [validatedData.user_id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    // Upsert using ON DUPLICATE KEY UPDATE
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO pay_periods (user_id, pay_date, gross_income_cents, note)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         gross_income_cents = VALUES(gross_income_cents),
         note = VALUES(note)`,
      [
        validatedData.user_id,
        validatedData.pay_date,
        validatedData.gross_income_cents,
        validatedData.note || null
      ]
    );

    // Check if it was an insert or update
    const wasInsert = result.affectedRows === 1;
    const statusCode = wasInsert ? 201 : 200;

    // Get the ID (for insert it's insertId, for update we need to query)
    let id = result.insertId;
    if (!wasInsert) {
      const [existing] = await db.query<RowDataPacket[]>(
        'SELECT id FROM pay_periods WHERE user_id = ? AND pay_date = ?',
        [validatedData.user_id, validatedData.pay_date]
      );
      id = existing[0]?.id || id;
    }

    return res.status(statusCode).json({
      id,
      upserted: true
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.issues
      });
    }

    console.error('Error upserting pay period:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

export default router;
