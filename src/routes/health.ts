import { Router } from 'express';
import { healthcheck } from '../db';

const router = Router();

// GET /api/health → { ok: true, service: 'wallet-api', ts }
router.get('/', async (_req, res) => {
  res.json({
    ok: true,
    service: 'wallet-api',
    ts: new Date().toISOString()
  });
});

// GET /api/health/db-ping → valida conexión MySQL
router.get('/db-ping', async (_req, res) => {
  try {
    const isHealthy = await healthcheck();
    if (isHealthy) {
      res.json({
        ok: true,
        database: 'connected',
        ts: new Date().toISOString()
      });
    } else {
      res.status(503).json({
        ok: false,
        database: 'disconnected',
        ts: new Date().toISOString()
      });
    }
  } catch (error) {
    res.status(503).json({
      ok: false,
      database: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      ts: new Date().toISOString()
    });
  }
});

export default router;

