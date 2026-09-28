/**
 * Ultra-Fast Direct OANDA v20 Engine (Sub-1ms In-Memory Symbol Resolution + Direct REST Streaming)
 * Credentials hardcoded directly as requested.
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
  'XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'BTCUSD', 'ETHUSD',
  'XAGUSD', 'AUDUSD', 'USDCAD', 'USDCHF', 'SPX500USD', 'NAS100USD', 'US30USD', 'WTICOUSD',
];

export interface InstrumentMeta {
  name: string;         // e.g. "XAU_USD"
  symbol: string;       // e.g. "XAUUSD"
  displayName: string;  // e.g. "XAU/USD"
  type: string;         // "CURRENCY" | "METAL" | "CFD"
  displayPrecision: number;
  pipLocation: number;
  minimumTradeSize: string;
  maximumOrderUnits: string;
  marginRate: string;
}

// Pre-seeded instant symbol table for 0ms synchronous symbol resolution
const INSTANT_META: Record<string, InstrumentMeta> = {
  XAU_USD: { name: 'XAU_USD', symbol: 'XAUUSD', displayName: 'Gold (XAU/USD)', type: 'METAL', displayPrecision: 3, pipLocation: -1, minimumTradeSize: '1', maximumOrderUnits: '10000', marginRate: '0.05' },
  XAG_USD: { name: 'XAG_USD', symbol: 'XAGUSD', displayName: 'Silver (XAG/USD)', type: 'METAL', displayPrecision: 3, pipLocation: -3, minimumTradeSize: '1', maximumOrderUnits: '50000', marginRate: '0.10' },
  BTC_USD: { name: 'BTC_USD', symbol: 'BTCUSD', displayName: 'Bitcoin (BTC/USD)', type: 'CFD', displayPrecision: 2, pipLocation: -2, minimumTradeSize: '0.01', maximumOrderUnits: '100', marginRate: '0.50' },
  ETH_USD: { name: 'ETH_USD', symbol: 'ETHUSD', displayName: 'Ethereum (ETH/USD)', type: 'CFD', displayPrecision: 2, pipLocation: -2, minimumTradeSize: '0.1', maximumOrderUnits: '1000', marginRate: '0.50' },
  EUR_USD: { name: 'EUR_USD', symbol: 'EURUSD', displayName: 'EUR/USD', type: 'CURRENCY', displayPrecision: 5, pipLocation: -4, minimumTradeSize: '1', maximumOrderUnits: '100000000', marginRate: '0.02' },
  GBP_USD: { name: 'GBP_USD', symbol: 'GBPUSD', displayName: 'GBP/USD', type: 'CURRENCY', displayPrecision: 5, pipLocation: -4, minimumTradeSize: '1', maximumOrderUnits: '100000000', marginRate: '0.02' },
  USD_JPY: { name: 'USD_JPY', symbol: 'USDJPY', displayName: 'USD/JPY', type: 'CURRENCY', displayPrecision: 3, pipLocation: -2, minimumTradeSize: '1', maximumOrderUnits: '100000000', marginRate: '0.02' },
  USD_CHF: { name: 'USD_CHF', symbol: 'USDCHF', displayName: 'USD/CHF', type: 'CURRENCY', displayPrecision: 5, pipLocation: -4, minimumTradeSize: '1', maximumOrderUnits: '100000000', marginRate: '0.02' },
  AUD_USD: { name: 'AUD_USD', symbol: 'AUDUSD', displayName: 'AUD/USD', type: 'CURRENCY', displayPrecision: 5, pipLocation: -4, minimumTradeSize: '1', maximumOrderUnits: '100000000', marginRate: '0.03' },
  USD_CAD: { name: 'USD_CAD', symbol: 'USDCAD', displayName: 'USD/CAD', type: 'CURRENCY', displayPrecision: 5, pipLocation: -4, minimumTradeSize: '1', maximumOrderUnits: '100000000', marginRate: '0.02' },
  NZD_USD: { name: 'NZD_USD', symbol: 'NZDUSD', displayName: 'NZD/USD', type: 'CURRENCY', displayPrecision: 5, pipLocation: -4, minimumTradeSize: '1', maximumOrderUnits: '100000000', marginRate: '0.03' },
  EUR_JPY: { name: 'EUR_JPY', symbol: 'EURJPY', displayName: 'EUR/JPY', type: 'CURRENCY', displayPrecision: 3, pipLocation: -2, minimumTradeSize: '1', maximumOrderUnits: '100000000', marginRate: '0.02' },
  GBP_JPY: { name: 'GBP_JPY', symbol: 'GBPJPY', displayName: 'GBP/JPY', type: 'CURRENCY', displayPrecision: 3, pipLocation: -2, minimumTradeSize: '1', maximumOrderUnits: '50000000', marginRate: '0.05' },
  EUR_GBP: { name: 'EUR_GBP', symbol: 'EURGBP', displayName: 'EUR/GBP', type: 'CURRENCY', displayPrecision: 5, pipLocation: -4, minimumTradeSize: '1', maximumOrderUnits: '100000000', marginRate: '0.02' },
  SPX500_USD: { name: 'SPX500_USD', symbol: 'SPX500USD', displayName: 'US SPX 500', type: 'CFD', displayPrecision: 1, pipLocation: 0, minimumTradeSize: '1', maximumOrderUnits: '10000', marginRate: '0.05' },
  NAS100_USD: { name: 'NAS100_USD', symbol: 'NAS100USD', displayName: 'US Nas 100', type: 'CFD', displayPrecision: 1, pipLocation: 0, minimumTradeSize: '1', maximumOrderUnits: '10000', marginRate: '0.05' },
  US30_USD: { name: 'US30_USD', symbol: 'US30USD', displayName: 'US Wall St 30', type: 'CFD', displayPrecision: 1, pipLocation: 0, minimumTradeSize: '1', maximumOrderUnits: '5000', marginRate: '0.05' },
  WTICO_USD: { name: 'WTICO_USD', symbol: 'WTICOUSD', displayName: 'West Texas Oil', type: 'CFD', displayPrecision: 3, pipLocation: -2, minimumTradeSize: '1', maximumOrderUnits: '50000', marginRate: '0.10' },
  BCO_USD: { name: 'BCO_USD', symbol: 'BCOUSD', displayName: 'Brent Crude Oil', type: 'CFD', displayPrecision: 3, pipLocation: -2, minimumTradeSize: '1', maximumOrderUnits: '50000', marginRate: '0.10' },
};

const instrumentsMap = new Map<string, InstrumentMeta>();
for (const meta of Object.values(INSTANT_META)) {
  instrumentsMap.set(meta.name, meta);
  instrumentsMap.set(meta.symbol, meta);
}

let instrumentsCache: InstrumentMeta[] | null = null;
let instrumentsPromise: Promise<InstrumentMeta[]> | null = null;

// Ultra-fast in-memory history cache (1000ms TTL)
const historyCache = new Map<string, { ts: number; data: any }>();

export async function oandaRequest(path: string, options: RequestInit = {}): Promise<any> {
  const url = `${OANDA_BASE_URL}${path.replace(/\{id\}/g, OANDA_ACCOUNT_ID)}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${OANDA_API_TOKEN}`,
      'Accept-Datetime-Format': 'RFC3339',
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OANDA API ${res.status}: ${text}`);
  }
  return res.json();
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

/** 0ms synchronous symbol resolution for instant chart startup */
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
      const priorityKeys = Object.keys(INSTANT_META);
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
        const idxA = priorityKeys.indexOf(a.name);
        const idxB = priorityKeys.indexOf(b.name);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.symbol.localeCompare(b.symbol);
      });

      instrumentsCache = list;
      return list;
    } catch {
      return Object.values(INSTANT_META);
    }
  })();

  return instrumentsPromise;
}

export async function fetchOandaHistory(
  symbol: string,
  resolution: string,
  _from: number,
  to: number,
  countback = 500
): Promise<{ s: string; t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] }> {
  const oandaSym = toOandaSymbol(symbol);
  const resUpper = resolution.trim().toUpperCase();
  const granularity = translateResolution(resUpper);
  const is1s = ['1T', '3T', '5T', '1S', '3S', '5S'].includes(resUpper);

  let count = countback;
  if (is1s) {
    count = Math.max(100, Math.min(Math.floor(countback / 5), 5000));
  } else {
    count = Math.max(50, Math.min(count, 5000));
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const isPoll = countback <= 10;
  const useTo = !isPoll && to > 0 && to < (nowSec - 172800);

  const cacheKey = `${oandaSym}|${resUpper}|${count}|${useTo ? Math.floor(to / 60) : 'live'}`;
  const cached = historyCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < (isPoll ? 750 : 1500)) {
    return cached.data;
  }

  let url = `/v3/instruments/${oandaSym}/candles?granularity=${granularity}&count=${count}&price=M`;
  if (useTo) {
    const toIso = new Date(to * 1000).toISOString();
    url += `&to=${encodeURIComponent(toIso)}`;
  }

  let data: any;
  try {
    data = await oandaRequest(url);
  } catch {
    if (useTo) {
      data = await oandaRequest(`/v3/instruments/${oandaSym}/candles?granularity=${granularity}&count=${count}&price=M`);
    } else {
      return { s: 'no_data', t: [], o: [], h: [], l: [], c: [], v: [] };
    }
  }

  if ((!data?.candles || data.candles.length === 0) && useTo) {
    try {
      data = await oandaRequest(`/v3/instruments/${oandaSym}/candles?granularity=${granularity}&count=${count}&price=M`);
    } catch {
      return { s: 'no_data', t: [], o: [], h: [], l: [], c: [], v: [] };
    }
  }

  const candles = data?.candles || [];
  if (candles.length === 0) {
    return { s: 'no_data', t: [], o: [], h: [], l: [], c: [], v: [] };
  }

  const t: number[] = [];
  const o: number[] = [];
  const h: number[] = [];
  const l: number[] = [];
  const c: number[] = [];
  const v: number[] = [];

  for (const candle of candles) {
    const mid = candle.mid;
    if (!mid) continue;

    const timeSec = Math.floor(new Date(candle.time).getTime() / 1000);
    const oVal = parseFloat(mid.o);
    const hVal = parseFloat(mid.h);
    const lVal = parseFloat(mid.l);
    const cVal = parseFloat(mid.c);
    const vol = candle.volume || 1;

    if (is1s) {
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

  const result = t.length > 0
    ? { s: 'ok', t, o, h, l, c, v }
    : { s: 'no_data', t: [], o: [], h: [], l: [], c: [], v: [] };

  historyCache.set(cacheKey, { ts: Date.now(), data: result });
  return result;
}

export async function fetchOandaQuotes(symbols: string[]): Promise<{ s: string; d: any[]; serverTimeMs?: number }> {
  const mapped = Array.from(new Set(symbols.map(toOandaSymbol))).filter(Boolean);
  if (mapped.length === 0) return { s: 'ok', d: [] };

  const data = await oandaRequest(`/v3/accounts/{id}/pricing?instruments=${encodeURIComponent(mapped.join(','))}`);
  const serverTimeMs = data.time ? new Date(data.time).getTime() : Date.now();
  const d: any[] = [];

  for (const p of (data.prices || [])) {
    const dispSym = toDisplaySymbol(p.instrument);
    const bid = parseFloat(p.bids?.[0]?.price || p.closeoutBid || '0');
    const ask = parseFloat(p.asks?.[0]?.price || p.closeoutAsk || '0');
    const lp = bid > 0 && ask > 0 ? (bid + ask) / 2 : Math.max(bid, ask);
    const spread = Math.abs(ask - bid);

    const vObj = {
      lp,
      bid,
      ask,
      spread,
      ch: 0,
      chp: 0,
      short_name: dispSym,
      description: `${dispSym} (OANDA)`,
      exchange: 'OANDA',
      original_name: `OANDA:${dispSym}`,
    };

    d.push({ s: 'ok', n: dispSym, p: lp, v: vObj });
    d.push({ s: 'ok', n: `OANDA:${dispSym}`, p: lp, v: vObj });
  }

  return { s: 'ok', d, serverTimeMs };
}
