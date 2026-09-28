import { OANDA_ACCOUNT_ID, OANDA_API_TOKEN, OANDA_BASE_URL } from '../services/oandaClient';

/**
 * Sub-1ms High-Precision Server Time Synchronization Engine (NTP Minimum-Delay Filter)
 *
 * Anchors the browser's microsecond-resolution monotonic clock (`performance.now()`)
 * to the server's UTC clock using Cristian's algorithm + NTP minimum-RTT filtering:
 *
 *   t0 = performance.now()
 *   fetch('/time' or OANDA nanosecond pricing time) -> serverTimeMs (sub-ms float)
 *   t1 = performance.now()
 *   rtt = t1 - t0
 *   midpointPerfNow = (t0 + t1) / 2
 *   perfOffset = serverTimeMs - midpointPerfNow
 *
 * At any subsequent moment:
 *   calibratedServerMs = performance.now() + perfOffset
 */

interface SyncSample {
  perfOffset: number;
  rtt: number;
  timestamp: number;
}

const MAX_SAMPLES = 8;
const samples: SyncSample[] = [];

let _perfOffset = Date.now() - performance.now();
let _isSynced = false;
let _bestRtt = Infinity;
let _syncCount = 0;
let _intervalId: ReturnType<typeof setInterval> | null = null;

function recordSample(serverMs: number, t0: number, t1: number): void {
  if (isNaN(serverMs) || serverMs <= 0) return;
  const rtt = t1 - t0;
  const midpointPerf = (t0 + t1) / 2;
  const samplePerfOffset = serverMs - midpointPerf;

  samples.push({
    perfOffset: samplePerfOffset,
    rtt,
    timestamp: Date.now(),
  });
  if (samples.length > MAX_SAMPLES) {
    samples.shift();
  }

  // NTP Clock Filter: sort samples by RTT ascending and weight lowest-RTT samples
  const sorted = [...samples].sort((a, b) => a.rtt - b.rtt);
  const bestCount = Math.min(3, sorted.length);
  let weightedSum = 0;
  let weightTotal = 0;

  for (let i = 0; i < bestCount; i++) {
    const w = 1 / Math.max(0.1, sorted[i].rtt);
    weightedSum += sorted[i].perfOffset * w;
    weightTotal += w;
  }

  _perfOffset = weightedSum / weightTotal;
  _bestRtt = sorted[0].rtt;
  _isSynced = true;
  _syncCount++;
}

/** Perform a single NTP-style probe against /time (with direct OANDA nanosecond fallback) */
async function probe(): Promise<void> {
  try {
    const t0 = performance.now();
    const resp = await fetch(`/time?_=${t0}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    const t1 = performance.now();

    if (resp.ok) {
      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('json') || contentType.includes('text/plain')) {
        const headerMs = resp.headers.get('X-Server-Time-Ms');
        const bodyVal = await resp.json();
        const serverMs = headerMs && !isNaN(parseFloat(headerMs))
          ? parseFloat(headerMs)
          : (typeof bodyVal === 'object' && bodyVal !== null
              ? (bodyVal.ms ?? (bodyVal.time ? bodyVal.time * 1000 : NaN))
              : parseFloat(bodyVal) * 1000);

        if (!isNaN(serverMs) && serverMs > 0) {
          recordSample(serverMs, t0, t1);
          return;
        }
      }
    }
  } catch {
    // Fall through to direct OANDA nanosecond clock probe
  }

  // Direct OANDA nanosecond clock probe (returns RFC3339 with nanosecond fraction)
  try {
    const t0 = performance.now();
    const res = await fetch(
      `${OANDA_BASE_URL}/v3/accounts/${OANDA_ACCOUNT_ID}/pricing?instruments=EUR_USD`,
      {
        cache: 'no-store',
        headers: {
          'Authorization': `Bearer ${OANDA_API_TOKEN}`,
          'Accept-Datetime-Format': 'RFC3339',
        },
      }
    );
    const t1 = performance.now();
    if (!res.ok) return;
    const data = await res.json();
    if (data && typeof data.time === 'string') {
      // Parse sub-millisecond fraction from e.g. "2026-09-28T06:37:16.132213412Z"
      const baseMs = new Date(data.time).getTime();
      const fracMatch = data.time.match(/\.(\d+)Z$/);
      let subMs = 0;
      if (fracMatch && fracMatch[1].length > 3) {
        subMs = parseFloat('0.' + fracMatch[1].slice(3));
      }
      recordSample(baseMs + subMs, t0, t1);
    }
  } catch {
    // Keep existing calibrated offset
  }
}

/** Start background sync (5 rapid burst probes at init for <1ms convergence, then every 20s) */
export function startSync(): void {
  if (_intervalId) return;

  probe();
  setTimeout(probe, 150);
  setTimeout(probe, 350);
  setTimeout(probe, 700);
  setTimeout(probe, 1200);

  _intervalId = setInterval(probe, 20_000);
}

/** Stop background sync */
export function stopSync(): void {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
}

/** Get calibrated server time in epoch MILLISECONDS (sub-1ms precision) */
export function getCalibratedServerTimeMs(): number {
  return performance.now() + _perfOffset;
}

/** Get calibrated server time in epoch SECONDS (for TradingView getServerTime callback) */
export function getCalibratedServerTimeSec(): number {
  return (performance.now() + _perfOffset) / 1000;
}

/** Get current offset in ms relative to Date.now() */
export function getOffset(): number {
  return getCalibratedServerTimeMs() - Date.now();
}

/** Check if at least one sync has completed */
export function isSynced(): boolean {
  return _isSynced;
}

/** Get sync stats for debugging */
export function getSyncStats() {
  return {
    offsetMs: getOffset(),
    bestRttMs: _bestRtt,
    syncCount: _syncCount,
    isSynced: _isSynced,
  };
}

if (typeof window !== 'undefined') {
  (window as any).__SERVER_TIME_SYNC__ = {
    getCalibratedServerTimeMs,
    getCalibratedServerTimeSec,
    getOffset,
    isSynced,
    getSyncStats,
  };
}

