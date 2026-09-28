import type { VercelRequest, VercelResponse } from '@vercel/node';

const DEFAULT_ACCOUNT_ID = '101-001-40395350-001';
const DEFAULT_API_TOKEN = 'f2be2aaf1443ae8071a5982196c9e217-13d1b5a73efca27fd1c07b068bdd0832';
const DEFAULT_BASE_URL = 'https://api-fxpractice.oanda.com';

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function handleOptions(req: VercelRequest, res: VercelResponse) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export function getAccountId(): string {
  return process.env.OANDA_ACCOUNT_ID || DEFAULT_ACCOUNT_ID;
}

export function getBaseUrl(): string {
  return process.env.OANDA_BASE_URL || DEFAULT_BASE_URL;
}

export function getToken(): string {
  return process.env.OANDA_API_TOKEN || DEFAULT_API_TOKEN;
}

/**
 * Fetch from OANDA REST v20 API.
 * Uses RFC3339 datetime format (ISO 8601) so `new Date()` parses correctly.
 * Returns { json, dateHeader } so callers can extract the server Date for clock sync.
 */
export async function oandaFetch(
  path: string,
  options: RequestInit = {}
): Promise<any> {
  const accountId = getAccountId();
  const apiToken = getToken();
  const baseUrl = getBaseUrl();

  const url = `${baseUrl}${path.replace(/\{id\}/g, accountId)}`;

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiToken}`,
    'Accept-Datetime-Format': 'RFC3339',
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OANDA API ${response.status}: ${text}`);
  }

  return response.json();
}

/**
 * Same as oandaFetch but also returns the HTTP Date header for clock sync.
 */
export async function oandaFetchWithDate(
  path: string,
  options: RequestInit = {}
): Promise<{ data: any; serverDateMs: number }> {
  const accountId = getAccountId();
  const apiToken = getToken();
  const baseUrl = getBaseUrl();

  const url = `${baseUrl}${path.replace(/\{id\}/g, accountId)}`;

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiToken}`,
    'Accept-Datetime-Format': 'RFC3339',
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  const response = await fetch(url, { ...options, headers });

  // Extract OANDA server time from HTTP Date header
  const dateStr = response.headers.get('Date');
  const serverDateMs = dateStr ? new Date(dateStr).getTime() : Date.now();

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OANDA API ${response.status}: ${text}`);
  }

  const data = await response.json();
  return { data, serverDateMs };
}

export function translateResolution(resolution: string): string {
  const r = resolution.toUpperCase();
  switch (r) {
    case '1T': case '3T': case '5T':
    case '1S': case '3S': case '5S': return 'S5';
    case '10T': case '10S': return 'S10';
    case '15T': case '15S': return 'S15';
    case '30T': case '30S': return 'S30';
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
    default:
      // "1" could be 1 minute or 1 month — if it's just "1" from TradingView, it means 1 minute
      if (r === '1') return 'M1';
      return 'M1';
  }
}

export function toOandaSymbol(symbol: string): string {
  let s = symbol.replace(/^OANDA:/i, '').trim().toUpperCase();
  if (s.includes('_')) return s;

  // 6-char currency pairs: EURUSD -> EUR_USD, XAUUSD -> XAU_USD
  if (s.length === 6) {
    return s.slice(0, 3) + '_' + s.slice(3);
  }

  // Longer symbols ending in a 3-letter currency code: SPX500USD -> SPX500_USD
  const suffixes = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'HKD', 'SGD', 'CNH', 'ZAR', 'TRY', 'MXN', 'PLN', 'SEK', 'NOK', 'DKK', 'HUF', 'CZK', 'SAR', 'THB'];
  for (const suf of suffixes) {
    if (s.endsWith(suf) && s.length > suf.length + 2) {
      return s.slice(0, s.length - suf.length) + '_' + suf;
    }
  }

  return s;
}

export function toDisplaySymbol(oandaName: string): string {
  return oandaName.replace(/_/g, '');
}
