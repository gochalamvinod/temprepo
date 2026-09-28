import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleOptions } from './_lib/oanda';

/**
 * GET /api/time
 *
 * Ultra-low-latency NTP-style UTC time endpoint (<1ms precision).
 * Uses Node.js high-resolution monotonic clock (performance.timeOrigin + performance.now())
 * with zero external blocking calls so RTT measurement on the client is symmetric and <1ms accurate.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;

  const nowMs = performance.timeOrigin + performance.now();
  const nowSec = nowMs / 1000;

  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Server-Time-Ms', nowMs.toFixed(3));
  res.status(200).json(nowSec);
}
