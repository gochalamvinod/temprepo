import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleOptions, oandaFetch } from '../_lib/oanda';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  
  try {
    const data = await oandaFetch('/v3/accounts/{id}/openPositions');
    res.status(200).json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
