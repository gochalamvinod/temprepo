import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleOptions, oandaFetch, toOandaSymbol } from '../_lib/oanda';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { symbol, units, type, side, price, stopLoss, takeProfit } = req.body || {};
    
    if (!symbol || !units || !type || !side) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    const oandaSym = toOandaSymbol(symbol);
    const orderUnits = side === 'sell' ? -Math.abs(Number(units)) : Math.abs(Number(units));
    
    const orderReq: any = {
      order: {
        type: type === 'limit' ? 'LIMIT' : (type === 'stop' ? 'STOP' : 'MARKET'),
        instrument: oandaSym,
        units: String(orderUnits),
        timeInForce: type === 'market' ? 'FOK' : 'GTC',
        positionFill: 'DEFAULT'
      }
    };
    
    if (price && type !== 'market') {
      orderReq.order.price = String(price);
    }
    
    if (stopLoss) {
      orderReq.order.stopLossOnFill = { price: String(stopLoss) };
    }
    
    if (takeProfit) {
      orderReq.order.takeProfitOnFill = { price: String(takeProfit) };
    }
    
    const data = await oandaFetch('/v3/accounts/{id}/orders', {
      method: 'POST',
      body: JSON.stringify(orderReq)
    });
    
    res.status(200).json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
