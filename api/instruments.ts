import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleOptions, oandaFetch, toDisplaySymbol } from './_lib/oanda';

const PRIORITY = ['XAU_USD', 'XAG_USD', 'BTC_USD', 'ETH_USD', 'EUR_USD', 'GBP_USD', 'USD_JPY', 'USD_CHF', 'AUD_USD', 'USD_CAD', 'SPX500_USD', 'NAS100_USD', 'US30_USD', 'WTICO_USD', 'BCO_USD'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  
  try {
    const data = await oandaFetch('/v3/accounts/{id}/instruments');
    
    if (!data.instruments) {
      return res.status(200).json({ instruments: [] });
    }
    
    const insts = data.instruments.map((inst: any) => ({
      symbol: toDisplaySymbol(inst.name),
      oanda_name: inst.name,
      type: inst.type === 'CURRENCY' ? 'forex' : 'cfd'
    }));
    
    insts.sort((a: any, b: any) => {
      const idxA = PRIORITY.indexOf(a.oanda_name);
      const idxB = PRIORITY.indexOf(b.oanda_name);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.symbol.localeCompare(b.symbol);
    });
    
    res.status(200).json({ instruments: insts });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
