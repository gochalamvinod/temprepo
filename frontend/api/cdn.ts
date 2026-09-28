import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleOptions } from './_lib/oanda';

const TV_CDN_BASE = process.env.CDN_URL || 'https://trading-terminal.tradingview-widget.com';

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

/**
 * GET /api/cdn?path=...
 *
 * Compulsory Vercel CDN Fallback Proxy for TradingView library chunks.
 * Automatically fetches missing /charting_library/* and /bundles/* chunks
 * from https://trading-terminal.tradingview-widget.com with edge caching headers.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;

  const rawPath = Array.isArray(req.query.path)
    ? req.query.path.join('/')
    : (req.query.path as string || '');

  let cleanSubpath = rawPath.replace(/^\/+/, '').trim();
  if (!cleanSubpath) {
    // Also check if path was in URL path (/api/cdn/...)
    const urlObj = new URL(req.url || '', 'http://localhost');
    const urlPath = urlObj.pathname.replace(/^\/api\/cdn\/?/, '');
    if (urlPath) cleanSubpath = urlPath;
  }

  if (!cleanSubpath) {
    res.status(400).send('Missing path parameter');
    return;
  }

  // Candidate remote paths on TV CDN
  const candidateUrls: string[] = [];
  if (cleanSubpath.startsWith('bundles/')) {
    candidateUrls.push(`${TV_CDN_BASE}/charting_library/${cleanSubpath}`);
    candidateUrls.push(`${TV_CDN_BASE}/${cleanSubpath}`);
  } else if (cleanSubpath.startsWith('charting_library/')) {
    candidateUrls.push(`${TV_CDN_BASE}/${cleanSubpath}`);
    candidateUrls.push(`${TV_CDN_BASE}/${cleanSubpath.replace(/^charting_library\//, '')}`);
  } else {
    candidateUrls.push(`${TV_CDN_BASE}/charting_library/${cleanSubpath}`);
    candidateUrls.push(`${TV_CDN_BASE}/${cleanSubpath}`);
  }

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
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const contentType = getMimeType(cleanSubpath) || response.headers.get('content-type') || 'application/octet-stream';

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.status(200).send(buffer);
        return;
      }
    } catch {
      // Try next candidate
    }
  }

  res.status(404).send(`404 Not Found: ${cleanSubpath}`);
}
