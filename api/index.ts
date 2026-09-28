import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  handleOptions,
  oandaFetch,
  toOandaSymbol,
  toDisplaySymbol,
  translateResolution,
} from './_lib/oanda';

const TV_CDN_BASE = process.env.CDN_URL || 'https://trading-terminal.tradingview-widget.com';

const SUPPORTED_RESOLUTIONS = [
  '1T', '3T', '10T',
  '1S', '3S', '5S', '10S', '15S', '30S',
  '1', '2', '3', '4', '5', '10', '15', '30', '45',
  '60', '120', '180', '240',
  'D', '1D', 'W', '1W', 'M', '1M',
];

const PRIORITY = [
  'XAU_USD', 'XAG_USD', 'BTC_USD', 'ETH_USD',
  'EUR_USD', 'GBP_USD', 'USD_JPY', 'USD_CHF', 'AUD_USD', 'USD_CAD',
  'SPX500_USD', 'NAS100_USD', 'US30_USD', 'WTICO_USD', 'BCO_USD',
];

const MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function getMimeType(filePath: string): string {
  const dotIdx = filePath.lastIndexOf('.');
  if (dotIdx !== -1) {
    const ext = filePath.slice(dotIdx).toLowerCase();
    if (MIME_TYPES[ext]) return MIME_TYPES[ext];
  }
  return 'application/octet-stream';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;

  const urlObj = new URL(req.url || '/', 'http://localhost');
  const rawRoute = Array.isArray(req.query.route)
    ? req.query.route.join('/')
    : (req.query.route as string || urlObj.pathname.replace(/^\/api\/?/, '').replace(/^\/+/, ''));
  const route = rawRoute.split('?')[0].replace(/^\/+|\/+$/g, '');

  // 1. Sub-1ms Time Sync Endpoint
  if (route === 'time') {
    const nowMs = performance.timeOrigin + performance.now();
    const nowSec = nowMs / 1000;
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Access-Control-Expose-Headers', 'X-Server-Time-Ms');
    res.setHeader('X-Server-Time-Ms', nowMs.toFixed(3));
    return res.status(200).json(nowSec);
  }

  // 2. UDF Config Endpoint
  if (route === 'config') {
    return res.status(200).json({
      supported_resolutions: SUPPORTED_RESOLUTIONS,
      supports_group_request: false,
      supports_marks: true,
      supports_search: true,
      supports_timescale_marks: true,
      supports_time: true,
      has_intraday: true,
      has_seconds: true,
      has_ticks: true,
      ticks_multipliers: ['1', '3', '10'],
      seconds_multipliers: ['1', '3', '5', '10', '15', '30'],
      intraday_multipliers: ['1', '2', '3', '4', '5', '10', '15', '30', '45', '60', '120', '180', '240'],
      daily_multipliers: ['1'],
      weekly_multipliers: ['1'],
      monthly_multipliers: ['1'],
      default_symbol: 'XAUUSD',
    });
  }

  // 3. UDF Symbols Endpoint
  if (route === 'symbols') {
    try {
      const symbol = (req.query.symbol as string) || 'XAUUSD';
      const oandaSym = toOandaSymbol(symbol);
      const data = await oandaFetch(`/v3/accounts/{id}/instruments?instruments=${oandaSym}`);
      if (!data.instruments || data.instruments.length === 0) {
        return res.status(404).json({ error: 'Instrument not found' });
      }
      const inst = data.instruments[0];
      const disp = toDisplaySymbol(inst.name);
      const pricescale = Math.pow(10, inst.displayPrecision ?? 5);
      return res.status(200).json({
        name: disp,
        ticker: disp,
        full_name: `OANDA:${disp}`,
        description: `${inst.displayName} (${inst.type})`,
        type: inst.type === 'CURRENCY' ? 'forex' : 'cfd',
        session: '24x7',
        timezone: 'Etc/UTC',
        exchange: 'OANDA',
        listed_exchange: 'OANDA',
        pricescale,
        minmov: 1,
        has_intraday: true,
        intraday_multipliers: ['1', '2', '3', '4', '5', '10', '15', '30', '45', '60', '120', '180', '240'],
        has_seconds: true,
        seconds_multipliers: ['1', '3', '5', '10', '15', '30'],
        has_ticks: true,
        ticks_multipliers: ['1', '3', '10'],
        has_daily: true,
        daily_multipliers: ['1'],
        has_weekly_and_monthly: true,
        weekly_multipliers: ['1'],
        monthly_multipliers: ['1'],
        has_empty_bars: false,
        supported_resolutions: SUPPORTED_RESOLUTIONS,
        data_status: 'streaming',
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  // 4. UDF History Endpoint
  if (route === 'history') {
    try {
      const symbol = req.query.symbol as string;
      const resolution = req.query.resolution as string;
      const countback = Number(req.query.countback) || 500;
      const toParam = Number(req.query.to) || 0;

      if (!symbol || !resolution) {
        return res.status(400).json({ s: 'error', errmsg: 'missing symbol or resolution' });
      }

      const oandaSym = toOandaSymbol(symbol);
      const resUpper = resolution.trim().toUpperCase();
      const granularity = translateResolution(resUpper);
      const is1s = resUpper === '1S' || resUpper === '1T';
      const is3s = resUpper === '3S' || resUpper === '3T';

      const isPoll = countback <= 10;
      const count = isPoll
        ? (is1s || is3s ? 4 : 3)
        : (is1s || is3s
            ? Math.max(100, Math.min(Math.ceil(countback / 5), 2500))
            : Math.max(100, Math.min(countback, 5000)));

      const nowSec = Date.now() / 1000;
      const useTo = !isPoll && toParam > 0 && toParam < (nowSec - 172800);

      let url = `/v3/instruments/${oandaSym}/candles?granularity=${granularity}&count=${count}&price=M`;
      if (useTo) {
        url += `&to=${encodeURIComponent(new Date(toParam * 1000).toISOString())}`;
      }

      let data: any;
      try {
        data = await oandaFetch(url);
      } catch {
        if (useTo) {
          data = await oandaFetch(`/v3/instruments/${oandaSym}/candles?granularity=${granularity}&count=${count}&price=M`);
        } else {
          return res.status(200).json({ s: 'no_data', t: [], o: [], h: [], l: [], c: [], v: [] });
        }
      }

      if ((!data?.candles || data.candles.length === 0) && useTo) {
        try {
          data = await oandaFetch(`/v3/instruments/${oandaSym}/candles?granularity=${granularity}&count=${count}&price=M`);
        } catch {
          return res.status(200).json({ s: 'no_data', t: [], o: [], h: [], l: [], c: [], v: [] });
        }
      }

      const candles = data?.candles || [];
      if (candles.length === 0) {
        return res.status(200).json({ s: 'no_data', t: [], o: [], h: [], l: [], c: [], v: [] });
      }

      const rawBars: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }> = [];

      for (let idx = 0; idx < candles.length; idx++) {
        const candle = candles[idx];
        const mid = candle.mid;
        if (!mid) continue;
        const isLast = idx === candles.length - 1;
        const timeSec = Math.floor(new Date(candle.time).getTime() / 1000);
        const oVal = parseFloat(mid.o);
        const hVal = parseFloat(mid.h);
        const lVal = parseFloat(mid.l);
        const cVal = parseFloat(mid.c);
        const vol = candle.volume || 1;

        if (is1s || is3s) {
          const isBull = cVal >= oVal;
          const p1 = isBull ? lVal : hVal;
          const p2 = (oVal + cVal) * 0.5;
          const p3 = isBull ? hVal : lVal;
          const p4 = (p3 + cVal) * 0.5;
          const pts = [oVal, p1, p2, p3, p4, cVal];
          const subVol = Math.max(1, Math.round(vol / 5));
          const maxSubIdx = (!isLast || candle.complete)
            ? 4
            : Math.min(4, Math.max(0, Math.floor(nowSec - timeSec)));

          for (let i = 0; i <= maxSubIdx; i++) {
            const sO = pts[i];
            const sC = i === maxSubIdx ? cVal : pts[i + 1];
            rawBars.push({
              t: timeSec + i,
              o: sO,
              h: Math.max(sO, sC),
              l: Math.min(sO, sC),
              c: sC,
              v: subVol,
            });
          }
        } else {
          rawBars.push({ t: timeSec, o: oVal, h: hVal, l: lVal, c: cVal, v: vol });
        }
      }

      const t: number[] = [];
      const o: number[] = [];
      const h: number[] = [];
      const l: number[] = [];
      const c: number[] = [];
      const v: number[] = [];

      for (const b of rawBars) {
        const barTime = is3s ? Math.floor(b.t / 3) * 3 : b.t;
        if (t.length > 0 && t[t.length - 1] === barTime) {
          const li = t.length - 1;
          h[li] = Math.max(h[li], b.h);
          l[li] = Math.min(l[li], b.l);
          c[li] = b.c;
          v[li] += b.v;
        } else if (t.length === 0 || barTime > t[t.length - 1]) {
          t.push(barTime);
          o.push(b.o);
          h.push(b.h);
          l.push(b.l);
          c.push(b.c);
          v.push(b.v);
        }
      }

      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res.status(200).json(
        t.length > 0 ? { s: 'ok', t, o, h, l, c, v } : { s: 'no_data', t: [], o: [], h: [], c: [], l: [], v: [] }
      );
    } catch (err: any) {
      return res.status(500).json({ s: 'error', errmsg: err.message });
    }
  }

  // 5. UDF Quotes Endpoint
  if (route === 'quotes') {
    try {
      const symbolsRaw = req.query.symbols as string;
      if (!symbolsRaw) return res.status(200).json({ s: 'ok', d: [] });
      const oandaSyms = Array.from(new Set(symbolsRaw.split(',').map(toOandaSymbol)));
      const data = await oandaFetch(`/v3/accounts/{id}/pricing?instruments=${oandaSyms.join(',')}`);
      const d: any[] = [];
      for (const p of (data.prices || [])) {
        const bid = parseFloat(p.bids?.[0]?.price || p.closeoutBid || '0');
        const ask = parseFloat(p.asks?.[0]?.price || p.closeoutAsk || '0');
        const lp = bid > 0 && ask > 0 ? (bid + ask) / 2 : Math.max(bid, ask);
        const spread = Math.abs(ask - bid);
        const dispSym = toDisplaySymbol(p.instrument);
        const vObj = {
          lp,
          bid,
          ask,
          spread,
          ch: 0,
          chp: 0,
          short_name: dispSym,
          exchange: 'OANDA',
          description: `${dispSym} (OANDA)`,
          original_name: `OANDA:${dispSym}`,
        };
        d.push({ s: 'ok', n: dispSym, p: lp, v: vObj });
        d.push({ s: 'ok', n: `OANDA:${dispSym}`, p: lp, v: vObj });
      }
      return res.status(200).json({ s: 'ok', d });
    } catch (err: any) {
      return res.status(500).json({ s: 'error', errmsg: err.message });
    }
  }

  // 6. UDF Search Endpoint
  if (route === 'search') {
    try {
      const query = ((req.query.query as string) || '').toLowerCase();
      const data = await oandaFetch('/v3/accounts/{id}/instruments');
      let results = (data.instruments || []).map((inst: any) => ({
        symbol: toDisplaySymbol(inst.name),
        full_name: `OANDA:${toDisplaySymbol(inst.name)}`,
        description: inst.displayName,
        exchange: 'OANDA',
        type: inst.type === 'CURRENCY' ? 'forex' : 'cfd',
      }));
      if (query) {
        results = results.filter(
          (r: any) => r.symbol.toLowerCase().includes(query) || r.description.toLowerCase().includes(query)
        );
      }
      return res.status(200).json(results);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  // 7. Instruments Endpoint
  if (route === 'instruments') {
    try {
      const data = await oandaFetch('/v3/accounts/{id}/instruments');
      const insts = (data.instruments || []).map((inst: any) => ({
        symbol: toDisplaySymbol(inst.name),
        oanda_name: inst.name,
        type: inst.type === 'CURRENCY' ? 'forex' : 'cfd',
      }));
      insts.sort((a: any, b: any) => {
        const idxA = PRIORITY.indexOf(a.oanda_name);
        const idxB = PRIORITY.indexOf(b.oanda_name);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.symbol.localeCompare(b.symbol);
      });
      return res.status(200).json({ instruments: insts });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  // 8. Compulsory TradingView CDN Proxy Fallback
  if (route === 'cdn' || route.startsWith('cdn/')) {
    const rawPath = Array.isArray(req.query.path)
      ? req.query.path.join('/')
      : (req.query.path as string || route.replace(/^cdn\/?/, ''));
    const cleanSubpath = rawPath.replace(/^\/+/, '').trim();
    if (!cleanSubpath) return res.status(400).send('Missing path parameter');

    const candidateUrls = cleanSubpath.startsWith('bundles/')
      ? [`${TV_CDN_BASE}/charting_library/${cleanSubpath}`, `${TV_CDN_BASE}/${cleanSubpath}`]
      : cleanSubpath.startsWith('charting_library/')
        ? [`${TV_CDN_BASE}/${cleanSubpath}`, `${TV_CDN_BASE}/${cleanSubpath.replace(/^charting_library\//, '')}`]
        : [`${TV_CDN_BASE}/charting_library/${cleanSubpath}`, `${TV_CDN_BASE}/${cleanSubpath}`];

    for (const remoteUrl of candidateUrls) {
      try {
        const response = await fetch(remoteUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': '*/*',
          },
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer());
          res.setHeader('Content-Type', getMimeType(cleanSubpath));
          res.setHeader('Content-Length', buffer.length);
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          return res.status(200).send(buffer);
        }
      } catch {
        // Try next candidate
      }
    }
    return res.status(404).send(`404 Not Found: ${cleanSubpath}`);
  }

  // 9. Trade Endpoints (/trade/*)
  if (route === 'trade' || route.startsWith('trade/')) {
    const subpath = Array.isArray(req.query.subpath)
      ? req.query.subpath.join('/')
      : (req.query.subpath as string || route.replace(/^trade\/?/, ''));

    try {
      if (subpath === 'bundle' || subpath === 'state') {
        const [summary, positions, orders] = await Promise.all([
          oandaFetch('/v3/accounts/{id}/summary'),
          oandaFetch('/v3/accounts/{id}/openPositions'),
          oandaFetch('/v3/accounts/{id}/pendingOrders'),
        ]);
        return res.status(200).json({
          s: 'ok',
          account: summary.account || {},
          positions: positions.positions || [],
          orders: orders.orders || [],
          serverTime: Math.floor(Date.now() / 1000),
        });
      }
      if (subpath === 'account') {
        return res.status(200).json(await oandaFetch('/v3/accounts/{id}/summary'));
      }
      if (subpath === 'positions') {
        return res.status(200).json(await oandaFetch('/v3/accounts/{id}/openPositions'));
      }
      if (subpath === 'orders') {
        return res.status(200).json(await oandaFetch('/v3/accounts/{id}/pendingOrders'));
      }
      if (subpath === 'order' && req.method === 'POST') {
        const { symbol, units, type, side, price, stopLoss, takeProfit } = req.body || {};
        const oandaSym = toOandaSymbol(symbol);
        const orderUnits = side === 'sell' ? -Math.abs(Number(units)) : Math.abs(Number(units));
        const orderReq: any = {
          order: {
            type: type === 'limit' ? 'LIMIT' : type === 'stop' ? 'STOP' : 'MARKET',
            instrument: oandaSym,
            units: String(orderUnits),
            timeInForce: type === 'market' ? 'FOK' : 'GTC',
            positionFill: 'DEFAULT',
          },
        };
        if (price && type !== 'market') orderReq.order.price = String(price);
        if (stopLoss) orderReq.order.stopLossOnFill = { price: String(stopLoss) };
        if (takeProfit) orderReq.order.takeProfitOnFill = { price: String(takeProfit) };
        return res.status(200).json(
          await oandaFetch('/v3/accounts/{id}/orders', { method: 'POST', body: JSON.stringify(orderReq) })
        );
      }
      if (subpath === 'close' && (req.method === 'POST' || req.method === 'PUT')) {
        const { ticket, units } = req.body || {};
        const reqBody: any = units ? { units: String(Math.abs(Number(units))) } : { units: 'ALL' };
        return res.status(200).json(
          await oandaFetch(`/v3/accounts/{id}/trades/${ticket}/close`, { method: 'PUT', body: JSON.stringify(reqBody) })
        );
      }
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(404).json({ error: `Unknown API route: ${route}` });
}
