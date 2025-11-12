import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import healthRouter from './routes/health';
import usersRouter from './routes/users';
import accountsRouter from './routes/accounts';
import categoriesRouter from './routes/categories';
import payPeriodsRouter from './routes/payPeriods';
import transactionsRouter from './routes/transactions';
import plannedRouter from './routes/planned';
import savingsRouter from './routes/savings';
import goalsRouter from './routes/goals';
import summaryRouter from './routes/summary';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ name: 'wallet-api', status: 'ok' });
});

app.use('/api/health', healthRouter);
app.use('/api/users', usersRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/pay-periods', payPeriodsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/planned', plannedRouter);
app.use('/api/savings', savingsRouter);
app.use('/api/savings/goals', goalsRouter);
app.use('/api/summary', summaryRouter);

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`wallet-api listening on port:${PORT}`);
});

