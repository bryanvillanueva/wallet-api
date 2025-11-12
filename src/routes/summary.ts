import { Router, Request, Response } from 'express';
import { db } from '../db';
import { RowDataPacket } from 'mysql2';

const router = Router();

// GET /api/summary/pay-period/:id - Get summary for a pay period
router.get('/pay-period/:id', async (req: Request, res: Response) => {
  try {
    const payPeriodId = parseInt(req.params.id || '0');

    if (isNaN(payPeriodId) || payPeriodId <= 0) {
      return res.status(400).json({
        error: 'Invalid pay period ID'
      });
    }

    // Get pay period info
    const [payPeriods] = await db.query<RowDataPacket[]>(
      'SELECT id, user_id, pay_date, gross_income_cents FROM pay_periods WHERE id = ?',
      [payPeriodId]
    );

    if (payPeriods.length === 0) {
      return res.status(404).json({
        error: 'Pay period not found'
      });
    }

    const payPeriod = payPeriods[0] as RowDataPacket;
    const payDate = new Date(payPeriod.pay_date as string);

    // Calculate end date (pay_date + 14 days)
    const endDate = new Date(payDate);
    endDate.setDate(endDate.getDate() + 14);

    const payDateStr = payDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // Get income + adjustments (positive amounts)
    const [incomeRows] = await db.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total
       FROM transactions
       WHERE pay_period_id = ?
         AND type IN ('income', 'adjustment')
         AND amount_cents > 0`,
      [payPeriodId]
    );

    const income_in_cents = Number(incomeRows[0]?.total || 0);

    // Get expenses + transfers (negative amounts, return as positive)
    const [expenseRows] = await db.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(ABS(amount_cents)), 0) AS total
       FROM transactions
       WHERE pay_period_id = ?
         AND type IN ('expense', 'transfer')
         AND amount_cents < 0`,
      [payPeriodId]
    );

    const expenses_out_cents = Number(expenseRows[0]?.total || 0);

    // Get savings (can be positive deposit or negative withdrawal)
    const [savingsRows] = await db.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total
       FROM saving_entries
       WHERE pay_period_id = ?`,
      [payPeriodId]
    );

    const savings_out_cents = Number(savingsRows[0]?.total || 0);

    // Get reserved planned payments in the date range [pay_date, pay_date+14)
    const [plannedRows] = await db.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total
       FROM planned_payments
       WHERE user_id = ?
         AND status = 'planned'
         AND due_date >= ?
         AND due_date < ?`,
      [payPeriod.user_id, payDateStr, endDateStr]
    );

    const reserved_planned_cents = Number(plannedRows[0]?.total || 0);

    // Calculate leftover
    const leftover_cents = income_in_cents - expenses_out_cents - savings_out_cents - reserved_planned_cents;

    return res.json({
      pay_period_id: payPeriodId,
      pay_date: payDateStr,
      income_in_cents,
      expenses_out_cents,
      reserved_planned_cents,
      savings_out_cents,
      leftover_cents
    });

  } catch (error) {
    console.error('Error fetching pay period summary:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// GET /api/summary/savings/user/:userId - Get savings consolidation for a user
router.get('/savings/user/:userId', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId || '0');

    if (isNaN(userId) || userId <= 0) {
      return res.status(400).json({
        error: 'Invalid user ID'
      });
    }

    // Get total deposits (positive amounts)
    const [depositsRows] = await db.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total
       FROM saving_entries
       WHERE user_id = ? AND amount_cents > 0`,
      [userId]
    );

    const total_saved_cents = Number(depositsRows[0]?.total || 0);

    // Get total withdrawals (negative amounts, return as positive)
    const [withdrawalsRows] = await db.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(ABS(amount_cents)), 0) AS total
       FROM saving_entries
       WHERE user_id = ? AND amount_cents < 0`,
      [userId]
    );

    const total_withdrawn_cents = Number(withdrawalsRows[0]?.total || 0);

    // Calculate net savings
    const net_saved_cents = total_saved_cents - total_withdrawn_cents;

    // Get breakdown by account
    const [breakdownRows] = await db.query<RowDataPacket[]>(
      `SELECT
        a.type AS account_type,
        a.name AS account_name,
        COALESCE(SUM(CASE WHEN se.amount_cents > 0 THEN se.amount_cents ELSE 0 END), 0) AS deposits,
        COALESCE(SUM(CASE WHEN se.amount_cents < 0 THEN ABS(se.amount_cents) ELSE 0 END), 0) AS withdrawals,
        COALESCE(SUM(se.amount_cents), 0) AS net
      FROM saving_entries se
      JOIN accounts a ON se.account_id = a.id
      WHERE se.user_id = ?
      GROUP BY a.id, a.type, a.name
      ORDER BY a.type, a.name`,
      [userId]
    );

    return res.json({
      total_saved_cents,
      total_withdrawn_cents,
      net_saved_cents,
      breakdown: breakdownRows
    });

  } catch (error) {
    console.error('Error fetching savings summary:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

export default router;
