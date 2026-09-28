import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleOptions, oandaFetch, toOandaSymbol, toDisplaySymbol } from './_lib/oanda';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  
  try {
    const symbolsRaw = req.query.symbols as string;
    if (!symbolsRaw) {
      return res.status(200).json({ s: 'ok', d: [] });
    }
    
    const symbols = symbolsRaw.split(',');
    const oandaSyms = symbols.map(toOandaSymbol);
    
    const data = await oandaFetch(`/v3/accounts/{id}/pricing?instruments=${oandaSyms.join(',')}`);
    
    if (!data.prices) {
      return res.status(200).json({ s: 'ok', d: [] });
    }
    
    const d = data.prices.map((p: any) => {
      const bid = parseFloat(p.bids[0]?.price || '0');
      const ask = parseFloat(p.asks[0]?.price || '0');
      const lp = (bid + ask) / 2;
      const spread = ask - bid;
      const dispSym = toDisplaySymbol(p.instrument);
      
      return {
        s: 'ok',
        n: dispSym,
        v: {
          lp,
          bid,
          ask,
          spread,
          ch: 0,
          chp: 0,
          short_name: dispSym,
          exchange: 'OANDA',
          description: dispSym
        }
      };
    });
    
    res.status(200).json({ s: 'ok', d });
  } catch (err: any) {
    res.status(500).json({ s: 'error', errmsg: err.message });
  }
}
