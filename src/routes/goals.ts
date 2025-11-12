import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

const router = Router();

// Zod schemas for validation
const createGoalSchema = z.object({
  user_id: z.number().int().positive(),
  name: z.string().min(1, 'Goal name is required'),
  target_amount_cents: z.number().int().positive('Target amount must be positive'),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
});

// GET /api/savings/goals/user/:userId - Get goals with progress
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId || '0');

    if (isNaN(userId) || userId <= 0) {
      return res.status(400).json({
        error: 'Invalid user ID'
      });
    }

    // Query to get goals with saved_cents calculated
    const [goals] = await db.query<RowDataPacket[]>(
      `SELECT
        sg.id,
        sg.user_id,
        sg.name,
        sg.target_amount_cents,
        sg.target_date,
        sg.created_at,
        COALESCE(SUM(se.amount_cents), 0) AS saved_cents,
        sg.target_amount_cents - COALESCE(SUM(se.amount_cents), 0) AS remaining_cents
      FROM saving_goals sg
      LEFT JOIN saving_entry_goals seg ON sg.id = seg.goal_id
      LEFT JOIN saving_entries se ON seg.saving_entry_id = se.id
      WHERE sg.user_id = ?
      GROUP BY sg.id, sg.user_id, sg.name, sg.target_amount_cents, sg.target_date, sg.created_at
      ORDER BY sg.target_date ASC, sg.created_at DESC`,
      [userId]
    );

    return res.json(goals);

  } catch (error) {
    console.error('Error fetching goals:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// POST /api/savings/goals - Create a new goal
router.post('/', async (req: Request, res: Response) => {
  try {
    // Validate request body
    const validatedData = createGoalSchema.parse(req.body);

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

    // Validate target_date is not in the past
    const targetDate = new Date(validatedData.target_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (targetDate < today) {
      return res.status(400).json({
        error: 'Target date cannot be in the past'
      });
    }

    // Insert goal
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO saving_goals (user_id, name, target_amount_cents, target_date)
       VALUES (?, ?, ?, ?)`,
      [
        validatedData.user_id,
        validatedData.name,
        validatedData.target_amount_cents,
        validatedData.target_date
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

    console.error('Error creating goal:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// DELETE /api/savings/goals/:id - Delete a goal (if no dependencies)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const goalId = parseInt(req.params.id || '0');

    if (isNaN(goalId) || goalId <= 0) {
      return res.status(400).json({
        error: 'Invalid goal ID'
      });
    }

    // Check if goal exists
    const [goals] = await db.query<RowDataPacket[]>(
      'SELECT id FROM saving_goals WHERE id = ?',
      [goalId]
    );

    if (goals.length === 0) {
      return res.status(404).json({
        error: 'Goal not found'
      });
    }

    // Check for dependencies
    const [links] = await db.query<RowDataPacket[]>(
      'SELECT saving_entry_id FROM saving_entry_goals WHERE goal_id = ?',
      [goalId]
    );

    if (links.length > 0) {
      return res.status(400).json({
        error: 'Cannot delete goal with linked saving entries. Remove links first.'
      });
    }

    // Delete goal
    await db.query('DELETE FROM saving_goals WHERE id = ?', [goalId]);

    return res.json({
      deleted: true
    });

  } catch (error) {
    console.error('Error deleting goal:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// POST /api/savings/entries/:entryId/assign-goal/:goalId - Link entry to goal
router.post('/entries/:entryId/assign-goal/:goalId', async (req: Request, res: Response) => {
  try {
    const entryId = parseInt(req.params.entryId || '0');
    const goalId = parseInt(req.params.goalId || '0');

    if (isNaN(entryId) || entryId <= 0) {
      return res.status(400).json({
        error: 'Invalid saving entry ID'
      });
    }

    if (isNaN(goalId) || goalId <= 0) {
      return res.status(400).json({
        error: 'Invalid goal ID'
      });
    }

    // Verify saving entry exists
    const [entries] = await db.query<RowDataPacket[]>(
      'SELECT id, user_id FROM saving_entries WHERE id = ?',
      [entryId]
    );

    if (entries.length === 0) {
      return res.status(404).json({
        error: 'Saving entry not found'
      });
    }

    // Verify goal exists and belongs to same user
    const entry = entries[0];
    const [goals] = await db.query<RowDataPacket[]>(
      'SELECT id FROM saving_goals WHERE id = ? AND user_id = ?',
      [goalId, entry?.user_id]
    );

    if (goals.length === 0) {
      return res.status(404).json({
        error: 'Goal not found or does not belong to same user'
      });
    }

    // Check if link already exists
    const [existing] = await db.query<RowDataPacket[]>(
      'SELECT saving_entry_id FROM saving_entry_goals WHERE saving_entry_id = ? AND goal_id = ?',
      [entryId, goalId]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        error: 'This entry is already linked to this goal'
      });
    }

    // Insert link
    await db.query(
      'INSERT INTO saving_entry_goals (saving_entry_id, goal_id) VALUES (?, ?)',
      [entryId, goalId]
    );

    return res.json({
      linked: true
    });

  } catch (error) {
    console.error('Error linking entry to goal:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// DELETE /api/savings/entries/:entryId/assign-goal/:goalId - Unlink entry from goal
router.delete('/entries/:entryId/assign-goal/:goalId', async (req: Request, res: Response) => {
  try {
    const entryId = parseInt(req.params.entryId || '0');
    const goalId = parseInt(req.params.goalId || '0');

    if (isNaN(entryId) || entryId <= 0) {
      return res.status(400).json({
        error: 'Invalid saving entry ID'
      });
    }

    if (isNaN(goalId) || goalId <= 0) {
      return res.status(400).json({
        error: 'Invalid goal ID'
      });
    }

    // Check if link exists
    const [links] = await db.query<RowDataPacket[]>(
      'SELECT saving_entry_id FROM saving_entry_goals WHERE saving_entry_id = ? AND goal_id = ?',
      [entryId, goalId]
    );

    if (links.length === 0) {
      return res.status(404).json({
        error: 'Link not found'
      });
    }

    // Delete link
    await db.query(
      'DELETE FROM saving_entry_goals WHERE saving_entry_id = ? AND goal_id = ?',
      [entryId, goalId]
    );

    return res.json({
      unlinked: true
    });

  } catch (error) {
    console.error('Error unlinking entry from goal:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

export default router;
