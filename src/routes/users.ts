import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

const router = Router();

// Zod schemas for validation
const createUserSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email().optional().nullable()
});

// POST /api/users - Create a new user
router.post('/', async (req: Request, res: Response) => {
  try {
    // Validate request body
    const validatedData = createUserSchema.parse(req.body);

    // Check if email already exists (if provided)
    if (validatedData.email) {
      const [existingUsers] = await db.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE email = ?',
        [validatedData.email]
      );

      if (existingUsers.length > 0) {
        return res.status(409).json({
          error: 'Email already exists'
        });
      }
    }

    // Insert new user
    const [result] = await db.query<ResultSetHeader>(
      'INSERT INTO users (name, email) VALUES (?, ?)',
      [validatedData.name, validatedData.email || null]
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

    console.error('Error creating user:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// GET /api/users/:id - Get user by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id || '0');

    if (isNaN(userId) || userId <= 0) {
      return res.status(400).json({
        error: 'Invalid user ID'
      });
    }

    const [users] = await db.query<RowDataPacket[]>(
      'SELECT id, name, email, created_at FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    return res.json(users[0]);

  } catch (error) {
    console.error('Error fetching user:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// GET /api/users - List all users (optional)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const [users] = await db.query<RowDataPacket[]>(
      'SELECT id, name, email, created_at FROM users ORDER BY id DESC'
    );

    return res.json(users);

  } catch (error) {
    console.error('Error fetching users:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

export default router;
