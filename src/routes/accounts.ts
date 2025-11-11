import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

const router = Router();

// Zod schemas for validation
const accountTypeEnum = z.enum(['cash', 'bank', 'credit', 'savings']);

const createAccountSchema = z.object({
  user_id: z.number().int().positive(),
  name: z.string().min(1, 'Account name is required'),
  type: accountTypeEnum,
  currency: z.string().length(3).optional().default('AUD'),
  is_active: z.boolean().optional().default(true)
});

const updateAccountSchema = z.object({
  name: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
  currency: z.string().length(3).optional()
});

// GET /api/accounts/user/:userId - Get all accounts for a user
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId || '0');

    if (isNaN(userId) || userId <= 0) {
      return res.status(400).json({
        error: 'Invalid user ID'
      });
    }

    const [accounts] = await db.query<RowDataPacket[]>(
      `SELECT id, user_id, name, type, currency, is_active, created_at
       FROM accounts
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );

    return res.json(accounts);

  } catch (error) {
    console.error('Error fetching accounts:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// POST /api/accounts - Create a new account
router.post('/', async (req: Request, res: Response) => {
  try {
    // Validate request body
    const validatedData = createAccountSchema.parse(req.body);

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

    // Insert new account
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO accounts (user_id, name, type, currency, is_active)
       VALUES (?, ?, ?, ?, ?)`,
      [
        validatedData.user_id,
        validatedData.name,
        validatedData.type,
        validatedData.currency,
        validatedData.is_active
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

    console.error('Error creating account:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// PATCH /api/accounts/:id - Update account (activate/deactivate, rename)
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.id || '0');

    if (isNaN(accountId) || accountId <= 0) {
      return res.status(400).json({
        error: 'Invalid account ID'
      });
    }

    // Validate request body
    const validatedData = updateAccountSchema.parse(req.body);

    // Check if there's anything to update
    if (Object.keys(validatedData).length === 0) {
      return res.status(400).json({
        error: 'No fields to update'
      });
    }

    // Check if account exists
    const [accounts] = await db.query<RowDataPacket[]>(
      'SELECT id FROM accounts WHERE id = ?',
      [accountId]
    );

    if (accounts.length === 0) {
      return res.status(404).json({
        error: 'Account not found'
      });
    }

    // Build dynamic UPDATE query
    const updates: string[] = [];
    const values: any[] = [];

    if (validatedData.name !== undefined) {
      updates.push('name = ?');
      values.push(validatedData.name);
    }
    if (validatedData.is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(validatedData.is_active);
    }
    if (validatedData.currency !== undefined) {
      updates.push('currency = ?');
      values.push(validatedData.currency);
    }

    values.push(accountId);

    await db.query(
      `UPDATE accounts SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    return res.json({
      updated: true
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.issues
      });
    }

    console.error('Error updating account:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

export default router;
