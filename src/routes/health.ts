import { Router } from 'express';
import { healthcheck } from '../db';

const router = Router();

router.get('/', async (_req, res) => {
  const db = await healthcheck();
  res.json({ ok: true, db });
});

export default router;

