import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleOptions, oandaFetch } from '../_lib/oanda';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { ticket, units } = req.body || {};
    
    if (!ticket) {
      return res.status(400).json({ error: 'Ticket required' });
    }
    
    const reqBody: any = {};
    if (units) {
      reqBody.units = String(Math.abs(Number(units)));
    }
    
    // OANDA uses position/trade closing logic. Assuming ticket is a Trade ID.
    // In OANDA v20, closing a specific trade: PUT /v3/accounts/{id}/trades/{tradeSpecifier}/close
    const data = await oandaFetch(`/v3/accounts/{id}/trades/${ticket}/close`, {
      method: 'PUT',
      body: JSON.stringify(reqBody)
    });
    
    res.status(200).json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
