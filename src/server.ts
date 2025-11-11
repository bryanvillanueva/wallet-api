import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import healthRouter from './routes/health';
import usersRouter from './routes/users';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ name: 'wallet-api', status: 'ok' });
});

app.use('/api/health', healthRouter);
app.use('/api/users', usersRouter);

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`wallet-api listening on port:${PORT}`);
});

