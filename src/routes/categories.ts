import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

const router = Router();

// Zod schemas for validation
const categoryKindEnum = z.enum(['income', 'expense', 'transfer', 'adjustment']);

const createCategorySchema = z.object({
  user_id: z.number().int().positive().nullable().optional(),
  name: z.string().min(1, 'Category name is required'),
  kind: categoryKindEnum
});

// GET /api/categories - List categories (global + personal for user_id)
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.query.user_id ? parseInt(req.query.user_id as string) : null;

    let query = 'SELECT id, user_id, name, kind FROM categories';
    let params: any[] = [];

    if (userId) {
      query += ' WHERE user_id IS NULL OR user_id = ?';
      params = [userId];
    } else {
      query += ' WHERE user_id IS NULL';
    }

    query += ' ORDER BY kind, name';

    const [categories] = await db.query<RowDataPacket[]>(query, params);

    return res.json(categories);

  } catch (error) {
    console.error('Error fetching categories:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// POST /api/categories - Create a new category
router.post('/', async (req: Request, res: Response) => {
  try {
    // Validate request body
    const validatedData = createCategorySchema.parse(req.body);

    // If user_id is provided, verify user exists
    if (validatedData.user_id) {
      const [users] = await db.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE id = ?',
        [validatedData.user_id]
      );

      if (users.length === 0) {
        return res.status(404).json({
          error: 'User not found'
        });
      }
    }

    // Check for duplicate (user_id, name) - UNIQUE constraint
    const [existing] = await db.query<RowDataPacket[]>(
      'SELECT id FROM categories WHERE (user_id <=> ?) AND name = ?',
      [validatedData.user_id || null, validatedData.name]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        error: 'Category with this name already exists for this user'
      });
    }

    // Insert new category
    const [result] = await db.query<ResultSetHeader>(
      'INSERT INTO categories (user_id, name, kind) VALUES (?, ?, ?)',
      [validatedData.user_id || null, validatedData.name, validatedData.kind]
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

    console.error('Error creating category:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

export default router;
