/**
 * High-Performance Node.js OANDA v20 Engine, Static Server & CDN Fallback Proxy
 * 
 * Features:
 * - Sub-1ms NTP-style time synchronization endpoint (/time, /api/time)
 * - TradingView Autonomous CDN Fallback Downloader & Proxy (from https://trading-terminal.tradingview-widget.com)
 * - Automatic mirror caching of downloaded bundles to charting_library/bundles, frontend/public, and frontend/dist
 * - Direct OANDA v20 REST market data engine (config, symbols, history, quotes, instruments, search)
 * - Hardcoded credentials for instant zero-dependency execution
 * - Static file serving with GZIP pre-compression and in-memory RAM caching
 * - Vite HMR Dev Server proxy with automatic production dist fallback
 */

const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { parse: parseUrl } = require('url');

const WEBSITE_PORT = parseInt(process.env.WEBSITE_PORT || '9000', 10);
const PROXY_PORT = parseInt(process.env.PROXY_PORT || '9999', 10);
const VITE_PORT = parseInt(process.env.VITE_PORT || '5173', 10);
const PUBLIC_DIR = path.resolve(__dirname);

// Hardcoded OANDA v20 Credentials & Config
const OANDA_ACCOUNT_ID = process.env.OANDA_ACCOUNT_ID || '101-001-40395350-001';
const OANDA_API_TOKEN = process.env.OANDA_API_TOKEN || 'f2be2aaf1443ae8071a5982196c9e217-13d1b5a73efca27fd1c07b068bdd0832';
const OANDA_BASE_URL = process.env.OANDA_BASE_URL || 'https://api-fxpractice.oanda.com';
const TV_CDN_BASE = process.env.CDN_URL || 'https://trading-terminal.tradingview-widget.com';

// Process error handlers
process.on('uncaughtException', (err) => {
  console.error('[SERVER ERROR] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[SERVER ERROR] Unhandled Rejection at:', promise, 'reason:', reason);
});

// MIME Types Map
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
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
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

// ── In-Memory Trade State ───────────────────────────────────────────────
const tradeState = {
  positions: [],
  orders: [],
  account: {
    login: 101001,
    balance: 100000,
    equity: 100000,
    margin: 0,
    margin_free: 100000,
    margin_level: 0,
    profit: 0
  },
  version: 1,
  lastUpdated: Date.now(),
  backendOnline: true
};

// ── In-Memory Asset Cache ───────────────────────────────────────────────
const assetCache = new Map();

function getCachedAsset(filePath, isGzipSupported) {
  const cached = assetCache.get(filePath);
  if (!cached) return null;
  if (isGzipSupported && cached.gzip) {
    return { buffer: cached.gzip, isGzip: true, contentType: cached.contentType };
  }
  return { buffer: cached.raw, isGzip: false, contentType: cached.contentType };
}

function setCachedAsset(filePath, rawBuffer, contentType) {
  let gzipBuffer = null;
  try {
    gzipBuffer = zlib.gzipSync(rawBuffer, { level: 6 });
  } catch {}
  assetCache.set(filePath, {
    raw: rawBuffer,
    gzip: gzipBuffer,
    contentType,
  });
}

// ── OANDA Helper Utilities ───────────────────────────────────────────────
function toOandaSymbol(symbol) {
  let s = String(symbol || 'XAUUSD').replace(/^OANDA:/i, '').trim().toUpperCase();
  if (s === 'GOLD' || s === 'XAU') return 'XAU_USD';
  if (s === 'SILVER' || s === 'XAG') return 'XAG_USD';
  if (s === 'BTC' || s === 'BITCOIN') return 'BTC_USD';
  if (s === 'ETH' || s === 'ETHEREUM') return 'ETH_USD';

  if (s.includes('/')) s = s.replace('/', '_');
  if (s.includes('_')) return s;

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

function toDisplaySymbol(oandaName) {
  return String(oandaName || '').replace(/_/g, '');
}

function translateResolution(resolution) {
  const r = String(resolution || '1').trim().toUpperCase();
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

async function oandaFetch(subpath) {
  const url = `${OANDA_BASE_URL}${subpath.replace(/\{id\}/g, OANDA_ACCOUNT_ID)}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${OANDA_API_TOKEN}`,
      'Accept-Datetime-Format': 'RFC3339',
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OANDA API ${res.status}: ${text}`);
  }

  return res.json();
}

// ── Instant Instrument Metadata Table ────────────────────────────────────
const INSTANT_META = {
  XAU_USD: { name: 'XAU_USD', symbol: 'XAUUSD', displayName: 'Gold (XAU/USD)', type: 'METAL', displayPrecision: 3, pipLocation: -1 },
  XAG_USD: { name: 'XAG_USD', symbol: 'XAGUSD', displayName: 'Silver (XAG/USD)', type: 'METAL', displayPrecision: 3, pipLocation: -3 },
  BTC_USD: { name: 'BTC_USD', symbol: 'BTCUSD', displayName: 'Bitcoin (BTC/USD)', type: 'CFD', displayPrecision: 2, pipLocation: -2 },
  ETH_USD: { name: 'ETH_USD', symbol: 'ETHUSD', displayName: 'Ethereum (ETH/USD)', type: 'CFD', displayPrecision: 2, pipLocation: -2 },
  EUR_USD: { name: 'EUR_USD', symbol: 'EURUSD', displayName: 'EUR/USD', type: 'CURRENCY', displayPrecision: 5, pipLocation: -4 },
  GBP_USD: { name: 'GBP_USD', symbol: 'GBPUSD', displayName: 'GBP/USD', type: 'CURRENCY', displayPrecision: 5, pipLocation: -4 },
  USD_JPY: { name: 'USD_JPY', symbol: 'USDJPY', displayName: 'USD/JPY', type: 'CURRENCY', displayPrecision: 3, pipLocation: -2 },
  USD_CHF: { name: 'USD_CHF', symbol: 'USDCHF', displayName: 'USD/CHF', type: 'CURRENCY', displayPrecision: 5, pipLocation: -4 },
  AUD_USD: { name: 'AUD_USD', symbol: 'AUDUSD', displayName: 'AUD/USD', type: 'CURRENCY', displayPrecision: 5, pipLocation: -4 },
  USD_CAD: { name: 'USD_CAD', symbol: 'USDCAD', displayName: 'USD/CAD', type: 'CURRENCY', displayPrecision: 5, pipLocation: -4 },
  NZD_USD: { name: 'NZD_USD', symbol: 'NZDUSD', displayName: 'NZD/USD', type: 'CURRENCY', displayPrecision: 5, pipLocation: -4 },
  SPX500_USD: { name: 'SPX500_USD', symbol: 'SPX500USD', displayName: 'US SPX 500', type: 'CFD', displayPrecision: 1, pipLocation: 0 },
  NAS100_USD: { name: 'NAS100_USD', symbol: 'NAS100USD', displayName: 'US Nas 100', type: 'CFD', displayPrecision: 1, pipLocation: 0 },
  US30_USD: { name: 'US30_USD', symbol: 'US30USD', displayName: 'US Wall St 30', type: 'CFD', displayPrecision: 1, pipLocation: 0 },
  WTICO_USD: { name: 'WTICO_USD', symbol: 'WTICOUSD', displayName: 'West Texas Oil', type: 'CFD', displayPrecision: 3, pipLocation: -2 },
};

function resolveSymbolMeta(symbol) {
  const oandaSym = toOandaSymbol(symbol);
  if (INSTANT_META[oandaSym]) return INSTANT_META[oandaSym];

  const isJpy = oandaSym.endsWith('_JPY');
  const isMetal = oandaSym.startsWith('XAU') || oandaSym.startsWith('XAG');
  const displayPrecision = isMetal || isJpy ? 3 : 5;
  const pipLocation = isMetal ? -1 : isJpy ? -2 : -4;
  const disp = toDisplaySymbol(oandaSym);

  return {
    name: oandaSym,
    symbol: disp,
    displayName: oandaSym.replace('_', '/'),
    type: isMetal ? 'METAL' : 'CURRENCY',
    displayPrecision,
    pipLocation,
  };
}

// ── TradingView CDN Fallback & Proxy Downloader ────────────────────────
function fetchFromCdnAndServe(req, res, remoteSubpath, targetSavePath, safePath) {
  const remoteUrl = `${TV_CDN_BASE}${remoteSubpath.startsWith('/') ? '' : '/'}${remoteSubpath}`;
  console.log(`[CDN PROXY] Missing locally: ${safePath} -> Fetching from TV CDN: ${remoteUrl}`);

  const options = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://tradingview-widget.com/',
      'Accept': '*/*'
    }
  };

  https.get(remoteUrl, options, (cdnRes) => {
    if (cdnRes.statusCode !== 200) {
      // Try fallback URL without or with /charting_library/
      const altUrl = remoteSubpath.startsWith('/charting_library/')
        ? `${TV_CDN_BASE}${remoteSubpath.replace(/^\/charting_library\//, '/')}`
        : `${TV_CDN_BASE}/charting_library${remoteSubpath.startsWith('/') ? '' : '/'}${remoteSubpath}`;

      https.get(altUrl, options, (altRes) => {
        if (altRes.statusCode !== 200) {
          console.warn(`[CDN PROXY ${altRes.statusCode}] Remote CDN 404 for ${remoteUrl} and ${altUrl}`);
          if (!res.headersSent) {
            res.writeHead(altRes.statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`404 Not Found: ${safePath}`);
          }
          return;
        }
        processCdnSuccess(altRes, res, targetSavePath, safePath);
      }).on('error', (err) => {
        handleCdnError(res, remoteUrl, err);
      });
      return;
    }

    processCdnSuccess(cdnRes, res, targetSavePath, safePath);
  }).on('error', (err) => {
    handleCdnError(res, remoteUrl, err);
  });
}

function processCdnSuccess(cdnRes, res, targetSavePath, safePath) {
  const chunks = [];
  cdnRes.on('data', (c) => chunks.push(c));
  cdnRes.on('end', () => {
    const buffer = Buffer.concat(chunks);
    const cleanSubpath = safePath.replace(/^\/+/, '');

    // Synchronize to multiple target locations:
    // 1) root targetSavePath
    // 2) frontend/public/...
    // 3) frontend/dist/... (if dist exists)
    const targets = [targetSavePath];
    const pubTarget = path.join(PUBLIC_DIR, 'frontend', 'public', cleanSubpath.startsWith('bundles/') ? 'charting_library/' + cleanSubpath : cleanSubpath);
    targets.push(pubTarget);
    const distTarget = path.join(PUBLIC_DIR, 'frontend', 'dist', cleanSubpath.startsWith('bundles/') ? 'charting_library/' + cleanSubpath : cleanSubpath);
    if (fs.existsSync(path.join(PUBLIC_DIR, 'frontend', 'dist'))) {
      targets.push(distTarget);
    }

    for (const tPath of targets) {
      try {
        const dir = path.dirname(tPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(tPath, buffer);
      } catch (e) {
        console.warn(`[CDN SYNC WARN] Could not write to ${tPath}:`, e.message);
      }
    }
    console.log(`[CDN SAVED] Cached to local disk: ${targetSavePath} (${buffer.length} bytes)`);

    if (!res.headersSent) {
      const ext = path.extname(targetSavePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || cdnRes.headers['content-type'] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': buffer.length,
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=86400, immutable'
      });
      res.end(buffer);
    }
  });
}

function handleCdnError(res, remoteUrl, err) {
  console.error(`[CDN ERROR] Failed to fetch ${remoteUrl}:`, err.message);
  if (!res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`502 Bad Gateway: TV CDN fetch error: ${err.message}`);
  }
}

// ── Static File Server Handler ──────────────────────────────────────────
function handleStatic(req, res, pathname) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  let safePath = pathname === '/' ? '/index.html' : pathname;
  try {
    safePath = decodeURIComponent(safePath);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request');
    return;
  }

  const reactDistPath = path.normalize(path.join(PUBLIC_DIR, 'frontend', 'dist', safePath));
  let filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (fs.existsSync(reactDistPath) && !safePath.startsWith('/charting_library') && !safePath.startsWith('/datafeeds')) {
    filePath = reactDistPath;
  }

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Access Denied');
    return;
  }

  // Dynamic HTML Injection for index.html
  if (path.basename(filePath).toLowerCase() === 'index.html') {
    return handleDynamicHtml(req, res, filePath);
  }

  // Check In-Memory Cache
  const acceptEncoding = req.headers['accept-encoding'] || '';
  const isGzipSupported = acceptEncoding.includes('gzip');
  const cached = getCachedAsset(filePath, isGzipSupported);

  if (cached) {
    const headers = {
      'Content-Type': cached.contentType,
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    };
    if (cached.isGzip) headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = cached.buffer.length;
    headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    res.writeHead(200, headers);
    res.end(cached.buffer);
    return;
  }

  // Check filesystem
  fs.stat(filePath, (err, stats) => {
    if (err) {
      if (err.code === 'ENOENT') {
        const cleanSubpath = safePath.replace(/^\/+/, '');

        // Check if bundle exists under charting_library/bundles
        if (cleanSubpath.startsWith('bundles/')) {
          const altBundle = path.join(PUBLIC_DIR, 'charting_library', cleanSubpath);
          if (fs.existsSync(altBundle)) {
            return serveFile(req, res, altBundle);
          }
          const altPublicBundle = path.join(PUBLIC_DIR, 'frontend', 'public', 'charting_library', cleanSubpath);
          if (fs.existsSync(altPublicBundle)) {
            return serveFile(req, res, altPublicBundle);
          }
        }

        // CDN candidate check
        const isCdnCandidate = cleanSubpath.startsWith('bundles/') ||
                               cleanSubpath.startsWith('charting_library/');

        if (isCdnCandidate) {
          const remoteSubpath = cleanSubpath.startsWith('bundles/')
            ? '/charting_library/' + cleanSubpath
            : '/' + cleanSubpath;
          const targetSavePath = cleanSubpath.startsWith('bundles/')
            ? path.join(PUBLIC_DIR, 'charting_library', cleanSubpath)
            : filePath;
          return fetchFromCdnAndServe(req, res, remoteSubpath, targetSavePath, safePath);
        }

        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`404 Not Found: ${safePath}`);
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`500 Server Error: ${err.message}`);
      }
      return;
    }

    if (stats.isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      if (fs.existsSync(indexPath)) {
        return serveFile(req, res, indexPath);
      }
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Directory listing forbidden');
      return;
    }

    serveFile(req, res, filePath, stats);
  });
}

function serveFile(req, res, filePath, stats) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  const headers = {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  };

  const acceptEncoding = req.headers['accept-encoding'] || '';
  const isCompressible = /text|javascript|json|wasm|xml|svg/i.test(contentType);

  if (isCompressible && acceptEncoding.includes('gzip')) {
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    const rawStream = fs.createReadStream(filePath);
    const gzip = zlib.createGzip({ level: 6 });
    rawStream.pipe(gzip).pipe(res);
  } else {
    if (stats && stats.size !== undefined) {
      headers['Content-Length'] = stats.size;
    }
    res.writeHead(200, headers);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  }
}

function handleDynamicHtml(req, res, filePath) {
  try {
    const reactIndex = path.join(PUBLIC_DIR, 'frontend', 'dist', 'index.html');
    const targetFile = fs.existsSync(reactIndex) ? reactIndex : filePath;
    let html = fs.readFileSync(targetFile, 'utf-8');

    const bootstrapPayload = JSON.stringify({
      serverTime: Date.now(),
      brokerBackend: 'OANDA',
      priceType: 'MID',
      version: tradeState.version,
      backendOnline: true,
      positions: tradeState.positions,
      orders: tradeState.orders,
      account: tradeState.account
    });

    const injection = `
    <!-- Dynamic State Injected by OANDA Engine -->
    <script id="__NODE_POWERED_BOOTSTRAP__">
      window.__NODE_SERVER_STATE__ = ${bootstrapPayload};
    </script>
  </head>`;

    html = html.replace('</head>', injection);
    const buffer = Buffer.from(html, 'utf-8');
    const acceptEncoding = req.headers['accept-encoding'] || '';

    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Powered-By': 'NodeJS-OANDA-DynamicHTML'
    };

    if (acceptEncoding.includes('gzip')) {
      headers['Content-Encoding'] = 'gzip';
      const gzip = zlib.gzipSync(buffer, { level: 6 });
      headers['Content-Length'] = gzip.length;
      res.writeHead(200, headers);
      res.end(gzip);
    } else {
      headers['Content-Length'] = buffer.length;
      res.writeHead(200, headers);
      res.end(buffer);
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Dynamic HTML Generation Error: ' + err.message);
  }
}

// ── Native OANDA UDF Endpoints ──────────────────────────────────────────
async function handleConfig(req, res) {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  res.end(JSON.stringify({
    supported_resolutions: [
      '1T', '3T', '10T',
      '1S', '3S', '5S', '10S', '15S', '30S',
      '1', '2', '3', '4', '5', '10', '15', '30', '45',
      '60', '120', '180', '240',
      'D', '1D', 'W', '1W', 'M', '1M'
    ],
    supports_group_request: false,
    supports_marks: true,
    supports_search: true,
    supports_timescale_marks: true,
    supports_time: true,
    has_intraday: true,
    has_seconds: true,
    has_ticks: true,
    ticks_multipliers: ['1'],
    seconds_multipliers: ['1', '5', '10', '15', '30'],
    intraday_multipliers: ['1', '5', '15', '30', '60', '240'],
    daily_multipliers: ['1'],
    weekly_multipliers: ['1'],
    monthly_multipliers: ['1'],
    default_symbol: 'XAUUSD'
  }));
}

async function handleSymbols(req, res, query) {
  const symbol = query.symbol || 'XAUUSD';
  const meta = resolveSymbolMeta(symbol);
  const pricescale = Math.pow(10, meta.displayPrecision);

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  res.end(JSON.stringify({
    name: meta.symbol,
    ticker: meta.symbol,
    full_name: `OANDA:${meta.symbol}`,
    description: `${meta.displayName} (${meta.type})`,
    type: meta.type === 'CURRENCY' ? 'forex' : 'cfd',
    session: '24x7',
    timezone: 'Etc/UTC',
    exchange: 'OANDA',
    listed_exchange: 'OANDA',
    minmov: 1,
    pricescale,
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
    supported_resolutions: [
      '1T', '3T', '10T',
      '1S', '3S', '5S', '10S', '15S', '30S',
      '1', '2', '3', '4', '5', '10', '15', '30', '45',
      '60', '120', '180', '240',
      'D', '1D', 'W', '1W', 'M', '1M'
    ],
    data_status: 'streaming'
  }));
}

async function handleHistory(req, res, query) {
  try {
    const symbol = query.symbol || 'XAUUSD';
    const resolution = query.resolution || '1';
    const countback = Number(query.countback) || 500;
    const toParam = Number(query.to) || 0;

    const oandaSym = toOandaSymbol(symbol);
    const resUpper = resolution.toUpperCase();
    const granularity = translateResolution(resolution);
    const is1s = ['1T', '3T', '5T', '1S', '3S', '5S'].includes(resUpper);

    let count = countback;
    if (is1s) {
      count = Math.max(100, Math.min(Math.floor(countback / 5), 5000));
    } else {
      count = Math.max(50, Math.min(count, 5000));
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const isPoll = countback <= 10;
    const useTo = !isPoll && toParam > 0 && toParam < (nowSec - 172800);

    let subpath = `/v3/instruments/${oandaSym}/candles?granularity=${granularity}&count=${count}&price=M`;
    if (useTo) {
      subpath += `&to=${encodeURIComponent(new Date(toParam * 1000).toISOString())}`;
    }

    let data;
    try {
      data = await oandaFetch(subpath);
    } catch {
      if (useTo) {
        data = await oandaFetch(`/v3/instruments/${oandaSym}/candles?granularity=${granularity}&count=${count}&price=M`);
      } else {
        data = { candles: [] };
      }
    }

    const candles = data?.candles || [];
    const t = [], o = [], h = [], l = [], c = [], v = [];

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

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ s: 'error', errmsg: err.message }));
  }
}

async function handleQuotes(req, res, query) {
  try {
    const rawSymbols = query.symbols || 'XAUUSD,EURUSD';
    const syms = rawSymbols.split(',').map(toOandaSymbol).filter(Boolean);
    const uniqueSyms = Array.from(new Set(syms));

    const data = await oandaFetch(`/v3/accounts/{id}/pricing?instruments=${encodeURIComponent(uniqueSyms.join(','))}`);
    const d = [];

    for (const p of (data.prices || [])) {
      const dispSym = toDisplaySymbol(p.instrument);
      const bid = parseFloat(p.bids?.[0]?.price || p.closeoutBid || '0');
      const ask = parseFloat(p.asks?.[0]?.price || p.closeoutAsk || '0');
      const lp = bid > 0 && ask > 0 ? (bid + ask) / 2 : Math.max(bid, ask);
      const spread = Math.abs(ask - bid);

      const vObj = {
        lp, bid, ask, spread,
        ch: 0, chp: 0,
        short_name: dispSym,
        description: `${dispSym} (OANDA)`,
        exchange: 'OANDA',
        original_name: `OANDA:${dispSym}`,
      };

      d.push({ s: 'ok', n: dispSym, p: lp, v: vObj });
      d.push({ s: 'ok', n: `OANDA:${dispSym}`, p: lp, v: vObj });
    }

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(JSON.stringify({ s: 'ok', d }));
  } catch (err) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ s: 'ok', d: [] }));
  }
}

async function handleInstruments(req, res) {
  try {
    const data = await oandaFetch('/v3/accounts/{id}/instruments');
    const instruments = (data.instruments || []).map((i) => ({
      symbol: toDisplaySymbol(i.name),
      oanda_name: i.name,
      type: i.type || 'CURRENCY',
      display_name: i.displayName || toDisplaySymbol(i.name),
      pip: Math.pow(10, i.pipLocation || -4),
      display_precision: i.displayPrecision || 5,
      min_trade_size: i.minimumTradeSize || '1',
      max_trade_size: i.maximumOrderUnits || '100000000',
    }));

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(JSON.stringify({ instruments }));
  } catch (err) {
    const fallback = Object.values(INSTANT_META).map((m) => ({
      symbol: m.symbol,
      oanda_name: m.name,
      type: m.type,
      display_name: m.displayName,
      pip: Math.pow(10, m.pipLocation),
      display_precision: m.displayPrecision,
      min_trade_size: '1',
      max_trade_size: '100000000',
    }));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ instruments: fallback }));
  }
}

async function handleSearch(req, res, query) {
  const q = String(query.query || '').trim().toUpperCase();
  const limit = Number(query.limit) || 30;

  try {
    const data = await oandaFetch('/v3/accounts/{id}/instruments');
    const results = (data.instruments || [])
      .filter((i) => !q || i.name.includes(q) || toDisplaySymbol(i.name).includes(q) || (i.displayName && i.displayName.toUpperCase().includes(q)))
      .slice(0, limit)
      .map((i) => ({
        symbol: toDisplaySymbol(i.name),
        full_name: `OANDA:${toDisplaySymbol(i.name)}`,
        description: `${i.displayName || toDisplaySymbol(i.name)} (${i.type || 'forex'})`,
        exchange: 'OANDA',
        type: i.type === 'CURRENCY' ? 'forex' : 'cfd',
      }));

    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(results));
  } catch {
    const results = Object.values(INSTANT_META)
      .filter((m) => !q || m.symbol.includes(q) || m.name.includes(q))
      .slice(0, limit)
      .map((m) => ({
        symbol: m.symbol,
        full_name: `OANDA:${m.symbol}`,
        description: `${m.displayName} (${m.type})`,
        exchange: 'OANDA',
        type: m.type === 'CURRENCY' ? 'forex' : 'cfd',
      }));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(results));
  }
}

// ── Vite HMR Dev Server Proxy ───────────────────────────────────────────
function isVitePath(pathname) {
  return (
    pathname === '/' ||
    pathname === '/index.html' ||
    pathname.startsWith('/@vite') ||
    pathname.startsWith('/@react-refresh') ||
    pathname.startsWith('/@fs') ||
    pathname.startsWith('/@id') ||
    pathname.startsWith('/src/') ||
    pathname.startsWith('/node_modules/')
  );
}

function proxyToViteOrFallback(req, res, pathname) {
  const viteReq = http.request(
    {
      hostname: '127.0.0.1',
      port: VITE_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${VITE_PORT}` },
      timeout: 1000
    },
    (viteRes) => {
      if (viteRes.statusCode === 404 && !pathname.startsWith('/src/') && !pathname.startsWith('/@')) {
        viteRes.resume();
        return handleStatic(req, res, pathname);
      }
      res.writeHead(viteRes.statusCode, {
        ...viteRes.headers,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      viteRes.pipe(res);
    }
  );
  viteReq.on('error', () => {
    handleStatic(req, res, pathname);
  });
  req.pipe(viteReq);
}

// ── Master HTTP Request Router ──────────────────────────────────────────
function handleHttpRequest(req, res) {
  // Global CORS Preflight Handler
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  const parsed = parseUrl(req.url, true);
  const pathname = parsed.pathname || '/';
  const query = parsed.query || {};
  // Static Custom CSS
  if (pathname === '/custom.css') {
    res.writeHead(200, {
      'Content-Type': 'text/css; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400',
    });
    res.end('/* Custom TV CSS */\nbody { margin: 0; background-color: #131722; }\n');
    return;
  }

  // Intercept study_templates requests
  if (pathname.includes('study_templates')) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ status: 'ok', data: [] }));
    return;
  }

  // 1. Sub-1ms NTP-style Time Endpoint
  if (pathname === '/time' || pathname === '/api/time') {
    const nowMs = performance.timeOrigin + performance.now();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'X-Server-Time-Ms',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Server-Time-Ms': nowMs.toFixed(3),
    });
    res.end(JSON.stringify(nowMs / 1000));
    return;
  }

  // 2. Direct OANDA UDF Endpoints
  if (pathname === '/config' || pathname === '/api/config') {
    return handleConfig(req, res);
  }
  if (pathname === '/symbols' || pathname === '/api/symbols') {
    return handleSymbols(req, res, query);
  }
  if (pathname === '/history' || pathname === '/api/history') {
    return handleHistory(req, res, query);
  }
  if (pathname === '/quotes' || pathname === '/api/quotes') {
    return handleQuotes(req, res, query);
  }
  if (pathname === '/instruments' || pathname === '/api/instruments') {
    return handleInstruments(req, res);
  }
  if (pathname === '/search' || pathname === '/api/search') {
    return handleSearch(req, res, query);
  }

  // 3. CDN Fallback Direct API Endpoint (/api/cdn)
  if (pathname === '/api/cdn') {
    const rawPath = query.path || '';
    const cleanSubpath = Array.isArray(rawPath) ? rawPath.join('/') : String(rawPath).replace(/^\/+/, '');
    const remoteSubpath = cleanSubpath.startsWith('bundles/') ? '/charting_library/' + cleanSubpath : '/' + cleanSubpath;
    const targetSavePath = path.join(PUBLIC_DIR, 'charting_library', cleanSubpath.startsWith('bundles/') ? cleanSubpath : cleanSubpath.replace(/^charting_library\//, ''));
    return fetchFromCdnAndServe(req, res, remoteSubpath, targetSavePath, '/' + cleanSubpath);
  }

  // 4. Trade Account / Order / Position Endpoints (Mock broker state)
  if (pathname.startsWith('/trade/') || pathname.startsWith('/api/trade/')) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    if (pathname.endsWith('/account')) {
      return res.end(JSON.stringify(tradeState.account));
    }
    if (pathname.endsWith('/positions')) {
      return res.end(JSON.stringify(tradeState.positions));
    }
    if (pathname.endsWith('/orders')) {
      return res.end(JSON.stringify(tradeState.orders));
    }
    return res.end(JSON.stringify({ s: 'ok' }));
  }

  // 5. Check if Vite dev server is running, or fall back to static
  if (isVitePath(pathname)) {
    proxyToViteOrFallback(req, res, pathname);
  } else {
    handleStatic(req, res, pathname);
  }
}

// ── WebSocket Upgrade Handler ───────────────────────────────────────────
function handleUpgrade(req, clientSocket, head) {
  const isViteHmr =
    (req.headers['sec-websocket-protocol'] && req.headers['sec-websocket-protocol'].includes('vite-hmr')) ||
    (req.url && req.url.startsWith('/@vite'));

  if (isViteHmr) {
    const viteSocket = net.connect(VITE_PORT, '127.0.0.1', () => {
      viteSocket.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const key = req.rawHeaders[i];
        const val = req.rawHeaders[i + 1];
        if (key.toLowerCase() === 'host') {
          viteSocket.write(`Host: 127.0.0.1:${VITE_PORT}\r\n`);
        } else {
          viteSocket.write(`${key}: ${val}\r\n`);
        }
      }
      viteSocket.write('\r\n');
      if (head && head.length > 0) viteSocket.write(head);
      viteSocket.pipe(clientSocket);
      clientSocket.pipe(viteSocket);
    });
    viteSocket.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => viteSocket.destroy());
    return;
  }

  clientSocket.destroy();
}

// ── Create Website & Proxy HTTP Servers ───────────────────────────────────
const websiteServer = http.createServer(handleHttpRequest);
websiteServer.on('error', (err) => console.error('[SERVER ERROR] websiteServer error:', err));
websiteServer.on('upgrade', handleUpgrade);

const proxyServer = http.createServer(handleHttpRequest);
proxyServer.on('error', (err) => console.error('[SERVER ERROR] proxyServer error:', err));
proxyServer.on('upgrade', handleUpgrade);

let serversStarted = 0;
function onServerStarted() {
  serversStarted++;
  if (serversStarted === 2) {
    console.log('================================================================================');
    console.log('  OANDA V20 TRADING TERMINAL SERVER ONLINE & READY');
    console.log('================================================================================');
    console.log(`  1. Website Server:   http://localhost:${WEBSITE_PORT}`);
    console.log(`  2. Proxy / API:      http://127.0.0.1:${PROXY_PORT}`);
    console.log(`  3. Direct OANDA:     ${OANDA_BASE_URL} (Account: ${OANDA_ACCOUNT_ID})`);
    console.log(`  4. TV CDN Fallback:  ${TV_CDN_BASE}`);
    console.log('================================================================================');
  }
}

websiteServer.listen(WEBSITE_PORT, '0.0.0.0', onServerStarted);
proxyServer.listen(PROXY_PORT, '0.0.0.0', onServerStarted);

process.on('SIGINT', () => {
  websiteServer.close();
  proxyServer.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  websiteServer.close();
  proxyServer.close();
  process.exit(0);
});
