import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleOptions, oandaFetch } from '../_lib/oanda';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  
  try {
    const [summary, positions, orders] = await Promise.all([
      oandaFetch('/v3/accounts/{id}/summary'),
      oandaFetch('/v3/accounts/{id}/openPositions'),
      oandaFetch('/v3/accounts/{id}/pendingOrders')
    ]);
    
    res.status(200).json({
      s: 'ok',
      account: summary.account || {},
      positions: positions.positions || [],
      orders: orders.orders || [],
      serverTime: Math.floor(Date.now() / 1000)
    });
  } catch (err: any) {
    res.status(500).json({ s: 'error', errmsg: err.message });
  }
}
