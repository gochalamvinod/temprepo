import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleOptions, oandaFetch, toOandaSymbol, translateResolution } from './_lib/oanda';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;

  try {
    const symbol = req.query.symbol as string;
    const resolution = req.query.resolution as string;
    const countback = Number(req.query.countback) || 500;
    const toParam = Number(req.query.to) || 0;

    if (!symbol || !resolution) {
      return res.status(400).json({ s: 'error', errmsg: 'missing symbol or resolution' });
    }

    const oandaSym = toOandaSymbol(symbol);
    const resUpper = resolution.toUpperCase();
    const granularity = translateResolution(resolution);
    const is1s = ['1T', '3T', '5T', '1S', '3S', '5S'].includes(resUpper);

    // Clamp count — for 1s resolution, divide by 5 since each OANDA S5 candle becomes 5 bars
    let count = countback;
    if (is1s) {
      count = Math.max(100, Math.min(Math.floor(countback / 5), 5000));
    } else {
      count = Math.max(50, Math.min(count, 5000));
    }

    // Only use `to` for deep historical scrollback (>48h before now AND not a live poll)
    const nowSec = Math.floor(Date.now() / 1000);
    const isPoll = countback <= 10;
    const useTo = !isPoll && toParam > 0 && toParam < (nowSec - 172800);

    let url = `/v3/instruments/${oandaSym}/candles?granularity=${granularity}&count=${count}&price=M`;

    if (useTo) {
      const toIso = new Date(toParam * 1000).toISOString();
      url += `&to=${encodeURIComponent(toIso)}`;
    }

    let data: any;
    try {
      data = await oandaFetch(url);
    } catch {
      // Fallback: retry without `to` if the historical window had no data
      if (useTo) {
        const fallbackUrl = `/v3/instruments/${oandaSym}/candles?granularity=${granularity}&count=${count}&price=M`;
        data = await oandaFetch(fallbackUrl);
      } else {
        return res.status(200).json({ s: 'no_data', t: [], o: [], h: [], l: [], c: [], v: [] });
      }
    }

    const candles = data?.candles;
    if (!candles || candles.length === 0) {
      // If `to` was used and got no candles, retry without `to`
      if (useTo) {
        const fallbackUrl = `/v3/instruments/${oandaSym}/candles?granularity=${granularity}&count=${count}&price=M`;
        try {
          data = await oandaFetch(fallbackUrl);
        } catch {
          return res.status(200).json({ s: 'no_data', t: [], o: [], h: [], l: [], c: [], v: [] });
        }
        if (!data?.candles || data.candles.length === 0) {
          return res.status(200).json({ s: 'no_data', t: [], o: [], h: [], l: [], c: [], v: [] });
        }
      } else {
        return res.status(200).json({ s: 'no_data', t: [], o: [], h: [], l: [], c: [], v: [] });
      }
    }

    const t: number[] = [];
    const o: number[] = [];
    const h: number[] = [];
    const l: number[] = [];
    const c: number[] = [];
    const v: number[] = [];

    for (const candle of (data.candles || [])) {
      const mid = candle.mid;
      if (!mid) continue;

      // RFC3339 timestamp — new Date() handles this correctly
      const timeSec = Math.floor(new Date(candle.time).getTime() / 1000);
      const oVal = parseFloat(mid.o);
      const hVal = parseFloat(mid.h);
      const lVal = parseFloat(mid.l);
      const cVal = parseFloat(mid.c);
      const vol = candle.volume || 1;

      if (is1s) {
        // Split each 5-second OANDA candle into 5 synthetic 1-second bars
        // Interpolation points: [open, low, midpoint, high, close]
        const pts = [oVal, lVal, (oVal + cVal) / 2, hVal, cVal];
        const subVol = Math.max(1, Math.floor(vol / 5));

        for (let i = 0; i < 5; i++) {
          const sO = i === 0 ? pts[0] : pts[i - 1];
          const sC = pts[i];
          t.push(timeSec + i);
          o.push(sO);
          h.push(Math.max(sO, sC));
          l.push(Math.min(sO, sC));
          c.push(sC);
          v.push(subVol);
        }
      } else {
        t.push(timeSec);
        o.push(oVal);
        h.push(hVal);
        l.push(lVal);
        c.push(cVal);
        v.push(vol);
      }
    }

    if (t.length === 0) {
      return res.status(200).json({ s: 'no_data', t: [], o: [], h: [], l: [], c: [], v: [] });
    }

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.status(200).json({ s: 'ok', t, o, h, l, c, v });
  } catch (err: any) {
    res.status(500).json({ s: 'error', errmsg: err.message || 'Internal error' });
  }
}
