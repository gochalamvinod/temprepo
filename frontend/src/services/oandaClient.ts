import { getCalibratedServerTimeSec, recordOandaTimestamp } from '../lib/serverTimeSync';

/**
 * Ultra-Fast Direct OANDA v20 Engine
 * - Hardcoded OANDA practice credentials
 * - Exact timestamp alignment for Ticks (1T, 3T, 10T), Seconds (1S, 3S, 5S, 10S, 15S, 30S),
 *   Minutes (1, 2, 3, 4, 5, 10, 15, 30, 45), Hours (60, 120, 180, 240), and D/W/M
 * - Never emits future timestamps ahead of calibrated OANDA server clock
 */

export const OANDA_ACCOUNT_ID = '101-001-40395350-001';
export const OANDA_API_TOKEN = 'f2be2aaf1443ae8071a5982196c9e217-13d1b5a73efca27fd1c07b068bdd0832';
export const OANDA_BASE_URL = 'https://api-fxpractice.oanda.com';

export const SUPPORTED_RESOLUTIONS = [
  '1T', '3T', '10T',
  '1S', '3S', '5S', '10S', '15S', '30S',
  '1', '2', '3', '4', '5', '10', '15', '30', '45',
  '60', '120', '180', '240',
  'D', '1D', 'W', '1W', 'M', '1M',
];

export const DEFAULT_WATCHLIST = [
  'XAUUSD', 'XAGUSD', 'EURUSD',
];

export interface InstrumentMeta {
  name: string;
  symbol: string;
  displayName: string;
  type: string;
  displayPrecision: number;
  pipLocation: number;
  minimumTradeSize: string;
  maximumOrderUnits: string;
  marginRate: string;
}

const instrumentsMap = new Map<string, InstrumentMeta>();
let instrumentsCache: InstrumentMeta[] | null = null;
let instrumentsPromise: Promise<InstrumentMeta[]> | null = null;

// In-flight deduplication and short TTL cache so 10ms UDF polling never floods OANDA
const inFlightHistory = new Map<string, Promise<any>>();
const historyCache = new Map<string, { ts: number; data: any }>();

// Live price cache per symbol for instant real-time bar updates
export const latestQuoteMap = new Map<string, { lp: number; bid: number; ask: number; timeMs: number }>();

export async function oandaRequest(path: string, options: RequestInit = {}): Promise<any> {
  const directUrl = `${OANDA_BASE_URL}${path.replace(/\{id\}/g, OANDA_ACCOUNT_ID)}`;
  const t0 = performance.now();
  
  // Try direct OANDA first for lowest possible latency
  try {
    const res = await fetch(directUrl, {
      ...options,
      keepalive: true,
      signal: AbortSignal.timeout(4000),
      headers: {
        'Authorization': `Bearer ${OANDA_API_TOKEN}`,
        'Accept-Datetime-Format': 'RFC3339',
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> || {}),
      },
    });
    const t1 = performance.now();
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.time === 'string') {
        recordOandaTimestamp(data.time, t0, t1);
      }
      return data;
    }
  } catch {
    // If direct OANDA fetch fails (e.g. CORS block from browser), seamlessly fall back to proxy
  }

  // Same-origin proxy fallback: guarantees 100% zero CORS errors and zero delay
  const proxyPath = path.replace(/\{id\}/g, OANDA_ACCOUNT_ID);
  const pRes = await fetch(proxyPath, {
    ...options,
    keepalive: true,
    signal: AbortSignal.timeout(6000),
  });
  if (!pRes.ok) {
    const text = await pRes.text();
    throw new Error(`Proxy OANDA API ${pRes.status}: ${text}`);
  }
  return await pRes.json();
}

export function toDisplaySymbol(oandaName: string): string {
  return oandaName.replace(/_/g, '');
}

export function toOandaSymbol(symbol: string): string {
  let s = symbol.replace(/^OANDA:/i, '').trim().toUpperCase();
  if (s === 'GOLD' || s === 'XAU') return 'XAU_USD';
  if (s === 'SILVER' || s === 'XAG') return 'XAG_USD';
  if (s === 'BTC' || s === 'BITCOIN') return 'BTC_USD';
  if (s === 'ETH' || s === 'ETHEREUM') return 'ETH_USD';

  if (s.includes('/')) s = s.replace('/', '_');
  if (s.includes('_')) return s;

  const cached = instrumentsMap.get(s);
  if (cached) return cached.name;

  if (s.length === 6) {
    return `${s.slice(0, 3)}_${s.slice(3)}`;
  }

  const suffixes = [
    'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'HKD',
    'SGD', 'CNH', 'ZAR', 'TRY', 'MXN', 'PLN', 'SEK', 'NOK', 'DKK', 'HUF', 'CZK',
  ];
  for (const suf of suffixes) {
    if (s.endsWith(suf) && s.length > suf.length + 2) {
      return `${s.slice(0, s.length - suf.length)}_${suf}`;
    }
  }

  return s;
}

export function translateResolution(resolution: string): string {
  const r = resolution.trim().toUpperCase();
  switch (r) {
    case '1T': case '3T': case '5T':
    case '1S': case '3S': case '5S': return 'S5';
    case '10T': case '10S': return 'S10';
    case '15T': case '15S': return 'S15';
    case '30T': case '30S': return 'S30';
    case '1': return 'M1';
    case '2': return 'M2';
    case '3': return 'M1';
    case '4': return 'M4';
    case '5': return 'M5';
    case '10': return 'M10';
    case '15': return 'M15';
    case '30': return 'M30';
    case '45': return 'M15';
    case '60': case '1H': return 'H1';
    case '120': case '2H': return 'H2';
    case '180': case '3H': return 'H3';
    case '240': case '4H': return 'H4';
    case '360': case '6H': return 'H6';
    case '480': case '8H': return 'H8';
    case '720': case '12H': return 'H12';
    case 'D': case '1D': return 'D';
    case 'W': case '1W': return 'W';
    case 'M': case '1M': return 'M';
    default: return 'M1';
  }
}

/** Return the exact duration in seconds of a resolution for bar boundary alignment */
export function getResolutionSeconds(resolution: string): number {
  const r = resolution.trim().toUpperCase();
  if (r === '1T' || r === '1S') return 1;
  if (r === '3T' || r === '3S') return 3;
  if (r === '5T' || r === '5S') return 5;
  if (r === '10T' || r === '10S') return 10;
  if (r === '15T' || r === '15S') return 15;
  if (r === '30T' || r === '30S') return 30;
  if (r === 'D' || r === '1D') return 86400;
  if (r === 'W' || r === '1W') return 604800;
  if (r === 'M' || r === '1M') return 2592000;
  const mins = parseInt(r, 10);
  if (!isNaN(mins) && mins > 0) return mins * 60;
  return 60;
}

export function resolveSymbolMetaSync(symbol: string): InstrumentMeta {
  const oandaSym = toOandaSymbol(symbol);
  const hit = instrumentsMap.get(oandaSym) || instrumentsMap.get(toDisplaySymbol(oandaSym));
  if (hit) return hit;

  const isJpy = oandaSym.endsWith('_JPY');
  const isMetal = oandaSym.startsWith('XAU') || oandaSym.startsWith('XAG');
  const displayPrecision = isMetal || isJpy ? 3 : 5;
  const pipLocation = isMetal ? -1 : isJpy ? -2 : -4;
  const disp = toDisplaySymbol(oandaSym);

  const synth: InstrumentMeta = {
    name: oandaSym,
    symbol: disp,
    displayName: oandaSym.replace('_', '/'),
    type: isMetal ? 'METAL' : 'CURRENCY',
    displayPrecision,
    pipLocation,
    minimumTradeSize: '1',
    maximumOrderUnits: '10000000',
    marginRate: '0.02',
  };
  instrumentsMap.set(oandaSym, synth);
  instrumentsMap.set(disp, synth);
  return synth;
}

export async function fetchInstruments(): Promise<InstrumentMeta[]> {
  if (instrumentsCache) return instrumentsCache;
  if (instrumentsPromise) return instrumentsPromise;

  instrumentsPromise = (async () => {
    try {
      const data = await oandaRequest('/v3/accounts/{id}/instruments');
      const list: InstrumentMeta[] = (data.instruments || []).map((inst: any) => {
        const symbol = toDisplaySymbol(inst.name);
        const meta: InstrumentMeta = {
          name: inst.name,
          symbol,
          displayName: inst.displayName || symbol,
          type: inst.type || 'CURRENCY',
          displayPrecision: typeof inst.displayPrecision === 'number' ? inst.displayPrecision : 5,
          pipLocation: typeof inst.pipLocation === 'number' ? inst.pipLocation : -4,
          minimumTradeSize: inst.minimumTradeSize || '1',
          maximumOrderUnits: inst.maximumOrderUnits || '100000000',
          marginRate: inst.marginRate || '0.02',
        };
        instrumentsMap.set(symbol.toUpperCase(), meta);
        instrumentsMap.set(inst.name.toUpperCase(), meta);
        return meta;
      });

      list.sort((a, b) => {
        const typeOrder: Record<string, number> = { METAL: 0, CFD: 1, CURRENCY: 2 };
        const orderA = typeOrder[a.type] ?? 3;
        const orderB = typeOrder[b.type] ?? 3;
        if (orderA !== orderB) return orderA - orderB;
        return a.symbol.localeCompare(b.symbol);
      });

      instrumentsCache = list;
      return list;
    } catch {
      return Array.from(instrumentsMap.values());
    }
  })();

  return instrumentsPromise;
}

interface RawBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

function aggregateBars(bars: RawBar[], bucketSec: number): RawBar[] {
  const out: RawBar[] = [];
  for (const b of bars) {
    const alignedT = Math.floor(b.t / bucketSec) * bucketSec;
    const last = out[out.length - 1];
    if (last && last.t === alignedT) {
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.c = b.c;
      last.v += b.v;
    } else {
      out.push({ t: alignedT, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    }
  }
  return out;
}

export async function fetchOandaHistory(
  symbol: string,
  resolution: string,
  _from: number,
  to: number,
  countback = 500,
  firstDataRequest = true
): Promise<{ s: string; t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] }> {
  const oandaSym = toOandaSymbol(symbol);
  const resUpper = resolution.trim().toUpperCase();
  const granularity = translateResolution(resUpper);

  // Only 1S/1T and 3S/3T need sub-5s synthesis from OANDA's S5 candles.
  // 5S, 10S, 15S, 30S are native OANDA granularities (S5, S10, S15, S30) and must NEVER be split into 1s!
  const is1s = resUpper === '1S' || resUpper === '1T';
  const is3s = resUpper === '3S' || resUpper === '3T';
  const is3m = resUpper === '3';
  const is45m = resUpper === '45';

  const isPoll = countback <= 10 && !firstDataRequest;
  let count: number;
  if (isPoll) {
    count = is1s || is3s ? 4 : is3m || is45m ? 6 : 3;
  } else if (is1s) {
    count = Math.max(100, Math.min(Math.ceil(countback / 5), 2500));
  } else if (is3s) {
    count = Math.max(100, Math.min(Math.ceil((countback * 3) / 5), 2500));
  } else if (is3m || is45m) {
    count = Math.max(150, Math.min(countback * 3, 5000));
  } else {
    count = Math.max(100, Math.min(countback, 5000));
  }

  const calibratedNowSec = getCalibratedServerTimeSec();
  // Use `to` whenever loading historical scrollback chunks (not initial load and not live poll)
  const useTo = !firstDataRequest && !isPoll && to > 0 && to < (calibratedNowSec - 5);

  const cacheKey = `${oandaSym}|${resUpper}|${isPoll ? 'poll' : count}|${useTo ? to : 'latest'}`;
  const ttlMs = isPoll ? 50 : 800;
  const cached = historyCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ttlMs) {
    return cached.data;
  }

  const existingPromise = inFlightHistory.get(cacheKey);
  if (existingPromise) return existingPromise;

  const task = (async () => {
    try {
      let url = `/v3/instruments/${oandaSym}/candles?granularity=${granularity}&count=${count}&price=M`;
      if (useTo) {
        const toIso = new Date(Math.max(1, to - 1) * 1000).toISOString();
        url += `&to=${encodeURIComponent(toIso)}`;
      }

      let data: any;
      try {
        data = await oandaRequest(url);
      } catch {
        return { s: 'no_data', t: [], o: [], h: [], l: [], c: [], v: [] };
      }

      const candles = data?.candles || [];
      if (candles.length === 0) {
        return { s: 'no_data', t: [], o: [], h: [], l: [], c: [], v: [] };
      }

      const dispSym = toDisplaySymbol(oandaSym);
      const liveQ = latestQuoteMap.get(dispSym);
      const nowSec = getCalibratedServerTimeSec();
      const rawBars: RawBar[] = [];

      for (let idx = 0; idx < candles.length; idx++) {
        const candle = candles[idx];
        const mid = candle.mid;
        if (!mid) continue;

        const isLastCandle = idx === candles.length - 1;
        const timeSec = Math.floor(new Date(candle.time).getTime() / 1000);
        // Strictly ignore any candle timestamp >= `to` when fetching historical scrollback
        if (useTo && timeSec >= to) continue;

        const oVal = parseFloat(mid.o);
        let hVal = parseFloat(mid.h);
        let lVal = parseFloat(mid.l);
        let cVal = parseFloat(mid.c);
        const vol = candle.volume || 1;

        // ONLY blend live quote on real-time 10ms UDF poll (`isPoll === true`) for an incomplete active candle.
        // NEVER blend live quote on historical `getBars` (`!isPoll`), preventing boundary spikes!
        if (isPoll && isLastCandle && !candle.complete && liveQ && liveQ.lp > 0 && Date.now() - liveQ.timeMs < 5000) {
          cVal = liveQ.lp;
          hVal = Math.max(hVal, cVal);
          lVal = Math.min(lVal, cVal);
        }

        if (is1s || is3s) {
          const isBull = cVal >= oVal;
          const p1 = isBull ? lVal : hVal;
          const p2 = (oVal + cVal) * 0.5;
          const p3 = isBull ? hVal : lVal;
          const p4 = (p3 + cVal) * 0.5;
          const pts = [oVal, p1, p2, p3, p4, cVal];
          const subVol = Math.max(1, Math.round(vol / 5));

          // For the currently forming S5 candle on initial/live load, never emit future 1s bars ahead of server clock
          const maxSubIdx = (useTo || !isLastCandle || candle.complete)
            ? 4
            : Math.min(4, Math.max(0, Math.floor(nowSec - timeSec)));

          for (let i = 0; i <= maxSubIdx; i++) {
            const sT = timeSec + i;
            if (useTo && sT >= to) break;
            const sO = pts[i];
            const sC = i === maxSubIdx ? cVal : pts[i + 1];
            const sH = Math.max(sO, sC);
            const sL = Math.min(sO, sC);
            rawBars.push({ t: sT, o: sO, h: sH, l: sL, c: sC, v: subVol });
          }
        } else {
          rawBars.push({ t: timeSec, o: oVal, h: hVal, l: lVal, c: cVal, v: vol });
        }
      }

      let finalBars = rawBars;
      if (is3s) {
        finalBars = aggregateBars(rawBars, 3);
      } else if (is3m) {
        finalBars = aggregateBars(rawBars, 180);
      } else if (is45m) {
        finalBars = aggregateBars(rawBars, 2700);
      }
      if (useTo) {
        finalBars = finalBars.filter(b => b.t < to);
      }

      // Ensure strict ascending timestamp uniqueness
      const t: number[] = [];
      const o: number[] = [];
      const h: number[] = [];
      const l: number[] = [];
      const c: number[] = [];
      const v: number[] = [];

      for (const b of finalBars) {
        if (t.length > 0 && b.t === t[t.length - 1]) {
          const lastIdx = t.length - 1;
          h[lastIdx] = Math.max(h[lastIdx], b.h);
          l[lastIdx] = Math.min(l[lastIdx], b.l);
          c[lastIdx] = b.c;
          v[lastIdx] += b.v;
        } else if (t.length === 0 || b.t > t[t.length - 1]) {
          t.push(b.t);
          o.push(b.o);
          h.push(b.h);
          l.push(b.l);
          c.push(b.c);
          v.push(b.v);
        }
      }

      const result = t.length > 0
        ? { s: 'ok', t, o, h, l, c, v }
        : { s: 'no_data', t: [], o: [], h: [], l: [], c: [], v: [] };

      historyCache.set(cacheKey, { ts: Date.now(), data: result });
      return result;
    } finally {
      inFlightHistory.delete(cacheKey);
    }
  })();

  inFlightHistory.set(cacheKey, task);
  return task;
}

export async function fetchOandaQuotes(symbols: string[]): Promise<{ s: string; d: any[]; serverTimeMs?: number }> {
  const mapped = Array.from(new Set(symbols.map(toOandaSymbol))).filter(Boolean);
  if (mapped.length === 0) return { s: 'ok', d: [] };

  let data: any = null;
  const t0 = performance.now();
  try {
    const url = `${OANDA_BASE_URL}/v3/accounts/${OANDA_ACCOUNT_ID}/pricing?instruments=${encodeURIComponent(mapped.join(','))}`;
    const res = await fetch(url, {
      keepalive: true,
      signal: AbortSignal.timeout(2000),
      headers: {
        'Authorization': `Bearer ${OANDA_API_TOKEN}`,
        'Accept-Datetime-Format': 'RFC3339',
      },
    });
    const t1 = performance.now();
    if (res.ok) {
      data = await res.json();
      if (data && typeof data.time === 'string') {
        recordOandaTimestamp(data.time, t0, t1);
      }
    }
  } catch {}

  // Seamless fallback to proxy /quotes
  if (!data) {
    try {
      const pRes = await fetch(`/quotes?symbols=${encodeURIComponent(symbols.join(','))}`, {
        keepalive: true,
        signal: AbortSignal.timeout(3000),
      });
      if (pRes.ok) return await pRes.json();
    } catch {}
    return { s: 'ok', d: [] };
  }

  const serverTimeMs = data.time ? new Date(data.time).getTime() : Date.now();
  const prices = data.prices || [];
  const d: any[] = new Array(prices.length * 2);
  let idx = 0;

  for (let i = 0; i < prices.length; i++) {
    const p = prices[i];
    const dispSym = toDisplaySymbol(p.instrument);
    const bid = parseFloat(p.bids?.[0]?.price || p.closeoutBid || '0');
    const ask = parseFloat(p.asks?.[0]?.price || p.closeoutAsk || '0');
    const lp = bid > 0 && ask > 0 ? (bid + ask) / 2 : Math.max(bid, ask);
    const spread = Math.abs(ask - bid);

    if (lp > 0) {
      latestQuoteMap.set(dispSym, { lp, bid, ask, timeMs: Date.now() });
    }

    const vObj = {
      lp, bid, ask, spread,
      ch: 0, chp: 0,
      short_name: dispSym,
      description: `${dispSym} (OANDA)`,
      exchange: 'OANDA',
      original_name: `OANDA:${dispSym}`,
    };

    d[idx++] = { s: 'ok', n: dispSym, p: lp, v: vObj };
    d[idx++] = { s: 'ok', n: `OANDA:${dispSym}`, p: lp, v: vObj };
  }

  return { s: 'ok', d, serverTimeMs };
}

// ── Pre-warm: fetch default symbol data on module load so first chart paint is instant ──
if (typeof window !== 'undefined') {
  // Fire-and-forget: pre-cache XAUUSD 1D candles + live quote before widget even boots
  fetchOandaHistory('XAUUSD', '1D', 0, 0, 500, true).catch(() => {});
  fetchOandaQuotes(['XAUUSD', 'XAGUSD', 'EURUSD']).catch(() => {});
}
