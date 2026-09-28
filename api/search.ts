import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleOptions, oandaFetch, toDisplaySymbol } from './_lib/oanda';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  
  try {
    const query = (req.query.query as string || '').toLowerCase();
    
    const data = await oandaFetch('/v3/accounts/{id}/instruments');
    
    if (!data.instruments) {
      return res.status(200).json([]);
    }
    
    let results = data.instruments.map((inst: any) => ({
      symbol: toDisplaySymbol(inst.name),
      full_name: toDisplaySymbol(inst.name),
      description: inst.displayName,
      exchange: 'OANDA',
      type: inst.type === 'CURRENCY' ? 'forex' : 'cfd'
    }));
    
    if (query) {
      results = results.filter((r: any) => 
        r.symbol.toLowerCase().includes(query) || 
        r.description.toLowerCase().includes(query)
      );
    }
    
    res.status(200).json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
