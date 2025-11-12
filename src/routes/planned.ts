import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

const router = Router();

// Zod schemas for validation
const statusEnum = z.enum(['planned', 'executed', 'canceled']);

const createPlannedPaymentSchema = z.object({
  user_id: z.number().int().positive(),
  account_id: z.number().int().positive().nullable().optional(),
  description: z.string().min(1, 'Description is required'),
  amount_cents: z.number().int().positive('Amount must be positive'),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  auto_debit: z.boolean().optional().default(false)
});

const executePlannedPaymentSchema = z.object({
  txn_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  account_id: z.number().int().positive().optional(),
  category_id: z.number().int().positive().optional(),
  description: z.string().optional()
});

// GET /api/planned/user/:userId - Get planned payments for a user
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
    const status = req.query.status as string | undefined;

    // Build query
    let query = `
      SELECT id, user_id, account_id, description, amount_cents, due_date,
             auto_debit, status, linked_txn_id, created_at
      FROM planned_payments
      WHERE user_id = ?
    `;
    const params: any[] = [userId];

    if (from) {
      query += ' AND due_date >= ?';
      params.push(from);
    }

    if (to) {
      query += ' AND due_date <= ?';
      params.push(to);
    }

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY due_date ASC, created_at DESC';

    const [planned] = await db.query<RowDataPacket[]>(query, params);

    return res.json(planned);

  } catch (error) {
    console.error('Error fetching planned payments:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// POST /api/planned - Create a new planned payment
router.post('/', async (req: Request, res: Response) => {
  try {
    // Validate request body
    const validatedData = createPlannedPaymentSchema.parse(req.body);

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

    // Verify account exists and belongs to user (if provided)
    if (validatedData.account_id) {
      const [accounts] = await db.query<RowDataPacket[]>(
        'SELECT id FROM accounts WHERE id = ? AND user_id = ?',
        [validatedData.account_id, validatedData.user_id]
      );

      if (accounts.length === 0) {
        return res.status(404).json({
          error: 'Account not found or does not belong to user'
        });
      }
    }

    // Insert planned payment
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO planned_payments (user_id, account_id, description, amount_cents, due_date, auto_debit, status)
       VALUES (?, ?, ?, ?, ?, ?, 'planned')`,
      [
        validatedData.user_id,
        validatedData.account_id || null,
        validatedData.description,
        validatedData.amount_cents,
        validatedData.due_date,
        validatedData.auto_debit
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

    console.error('Error creating planned payment:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// PATCH /api/planned/:id/execute - Execute a planned payment
router.patch('/:id/execute', async (req: Request, res: Response) => {
  try {
    const plannedId = parseInt(req.params.id || '0');

    if (isNaN(plannedId) || plannedId <= 0) {
      return res.status(400).json({
        error: 'Invalid planned payment ID'
      });
    }

    // Validate request body
    const validatedData = executePlannedPaymentSchema.parse(req.body);

    // Get planned payment
    const [planned] = await db.query<RowDataPacket[]>(
      'SELECT id, user_id, account_id, description, amount_cents, status FROM planned_payments WHERE id = ?',
      [plannedId]
    );

    if (planned.length === 0) {
      return res.status(404).json({
        error: 'Planned payment not found'
      });
    }

    const plannedPayment = planned[0] as RowDataPacket;

    if (plannedPayment.status !== 'planned') {
      return res.status(400).json({
        error: `Cannot execute payment with status '${plannedPayment.status}'`
      });
    }

    // Use provided account_id or fallback to planned payment's account_id
    const accountId = validatedData.account_id || plannedPayment.account_id;

    if (!accountId) {
      return res.status(400).json({
        error: 'Account ID is required (either in request or in planned payment)'
      });
    }

    // Verify account belongs to user
    const [accounts] = await db.query<RowDataPacket[]>(
      'SELECT id FROM accounts WHERE id = ? AND user_id = ?',
      [accountId, plannedPayment.user_id]
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

    // Create transaction (expense with negative amount)
    const [txnResult] = await db.query<ResultSetHeader>(
      `INSERT INTO transactions (user_id, account_id, category_id, type, amount_cents, description, txn_date, planned_payment_id)
       VALUES (?, ?, ?, 'expense', ?, ?, ?, ?)`,
      [
        plannedPayment.user_id,
        accountId,
        validatedData.category_id || null,
        -Math.abs(plannedPayment.amount_cents), // Ensure negative for expense
        validatedData.description || plannedPayment.description,
        validatedData.txn_date,
        plannedId
      ]
    );

    // Update planned payment status
    await db.query(
      `UPDATE planned_payments SET status = 'executed', linked_txn_id = ? WHERE id = ?`,
      [txnResult.insertId, plannedId]
    );

    return res.json({
      executed: true,
      txn_id: txnResult.insertId
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.issues
      });
    }

    console.error('Error executing planned payment:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// PATCH /api/planned/:id/cancel - Cancel a planned payment
router.patch('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const plannedId = parseInt(req.params.id || '0');

    if (isNaN(plannedId) || plannedId <= 0) {
      return res.status(400).json({
        error: 'Invalid planned payment ID'
      });
    }

    // Check if planned payment exists
    const [planned] = await db.query<RowDataPacket[]>(
      'SELECT id, status FROM planned_payments WHERE id = ?',
      [plannedId]
    );

    if (planned.length === 0) {
      return res.status(404).json({
        error: 'Planned payment not found'
      });
    }

    const plannedPaymentCancel = planned[0] as RowDataPacket;

    if (plannedPaymentCancel.status !== 'planned') {
      return res.status(400).json({
        error: `Cannot cancel payment with status '${plannedPaymentCancel.status}'`
      });
    }

    // Update status to canceled
    await db.query(
      `UPDATE planned_payments SET status = 'canceled' WHERE id = ?`,
      [plannedId]
    );

    return res.json({
      canceled: true
    });

  } catch (error) {
    console.error('Error canceling planned payment:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

export default router;
