import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleOptions, oandaFetch, toOandaSymbol, toDisplaySymbol } from './_lib/oanda';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  
  try {
    const symbol = req.query.symbol as string;
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    
    const oandaSym = toOandaSymbol(symbol);
    const data = await oandaFetch(`/v3/accounts/{id}/instruments?instruments=${oandaSym}`);
    
    if (!data.instruments || data.instruments.length === 0) {
      return res.status(404).json({ error: 'Instrument not found' });
    }
    
    const inst = data.instruments[0];
    const pricescale = Math.pow(10, inst.displayPrecision);
    
    res.status(200).json({
      name: toDisplaySymbol(inst.name),
      ticker: toDisplaySymbol(inst.name),
      full_name: `OANDA:${toDisplaySymbol(inst.name)}`,
      description: `${inst.displayName} (${inst.type})`,
      type: inst.type === 'CURRENCY' ? 'forex' : 'cfd',
      session: '24x7',
      timezone: 'Etc/UTC',
      exchange: 'OANDA',
      listed_exchange: 'OANDA',
      pricescale: pricescale,
      minmov: 1,
      has_intraday: true,
      intraday_multipliers: ['1', '5', '15', '30', '60', '240'],
      has_seconds: true,
      seconds_multipliers: ['1', '5', '10', '15', '30'],
      has_ticks: true,
      ticks_multipliers: ['1'],
      has_daily: true,
      daily_multipliers: ['1'],
      has_weekly_and_monthly: true,
      weekly_multipliers: ['1'],
      monthly_multipliers: ['1'],
      has_empty_bars: false,
      supported_resolutions: ['1T','3T','10T','1S','3S','5S','10S','15S','30S','1','2','3','4','5','10','15','30','45','60','120','180','240','D','1D','W','1W','M','1M'],
      data_status: 'streaming'
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
