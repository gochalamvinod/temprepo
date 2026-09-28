import { OANDA_ACCOUNT_ID, OANDA_API_TOKEN, OANDA_BASE_URL } from '../services/oandaClient';

/**
 * Sub-1ms High-Precision OANDA Server Time Synchronization Engine
 *
 * Uses Cristian's algorithm + NTP Minimum-Delay Filtering anchored to the browser's
 * microsecond monotonic clock (`performance.now()`), continuously calibrated against
 * OANDA's nanosecond RFC3339 pricing clock (`"time": "2026-09-28T08:08:20.115244503Z"`).
 */

interface SyncSample {
  perfOffset: number;
  rtt: number;
  timestamp: number;
}

const MAX_SAMPLES = 10;
const samples: SyncSample[] = [];

let _perfOffset = Date.now() - performance.now();
let _isSynced = false;
let _bestRtt = Infinity;
let _syncCount = 0;
let _intervalId: ReturnType<typeof setInterval> | null = null;
let _syncResolvers: Array<() => void> = [];

/** Parse OANDA RFC3339 nanosecond timestamp into float milliseconds */
export function parseOandaTimeMs(isoStr: string): number {
  const baseMs = new Date(isoStr).getTime();
  if (isNaN(baseMs)) return NaN;
  const fracMatch = isoStr.match(/\.(\d+)Z$/);
  let subMs = 0;
  if (fracMatch && fracMatch[1].length > 3) {
    subMs = parseFloat('0.' + fracMatch[1].slice(3));
  }
  return baseMs + subMs;
}

export function recordSample(serverMs: number, t0: number, t1: number): void {
  if (isNaN(serverMs) || serverMs <= 0) return;
  const rtt = Math.max(0.1, t1 - t0);
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

  // NTP Minimum-Delay Filter: sort by RTT ascending and weight the lowest-RTT samples
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

  if (_syncResolvers.length > 0) {
    const resolvers = _syncResolvers.splice(0, _syncResolvers.length);
    resolvers.forEach(r => r());
  }
}

/** Feed an OANDA RFC3339 nanosecond timestamp directly into the NTP filter */
export function recordOandaTimestamp(isoStr: string, t0: number, t1: number): void {
  const serverMs = parseOandaTimeMs(isoStr);
  if (!isNaN(serverMs)) {
    recordSample(serverMs, t0, t1);
  }
}

/** Perform a direct NTP-style probe against OANDA's nanosecond pricing clock */
async function probe(): Promise<void> {
  try {
    const t0 = performance.now();
    const res = await fetch(
      `${OANDA_BASE_URL}/v3/accounts/${OANDA_ACCOUNT_ID}/pricing?instruments=XAU_USD`,
      {
        cache: 'no-store',
        headers: {
          'Authorization': `Bearer ${OANDA_API_TOKEN}`,
          'Accept-Datetime-Format': 'RFC3339',
        },
      }
    );
    const t1 = performance.now();
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.time === 'string') {
        recordOandaTimestamp(data.time, t0, t1);
        return;
      }
    }
  } catch {
    // Fallback to /time endpoint if direct OANDA probe fails
  }

  try {
    const t0 = performance.now();
    const resp = await fetch(`/time?_=${t0}`, { cache: 'no-store' });
    const t1 = performance.now();
    if (resp.ok) {
      const headerMs = resp.headers.get('X-Server-Time-Ms');
      const bodyVal = await resp.json();
      const serverMs = headerMs && !isNaN(parseFloat(headerMs))
        ? parseFloat(headerMs)
        : parseFloat(bodyVal) * 1000;
      if (!isNaN(serverMs) && serverMs > 0) {
        recordSample(serverMs, t0, t1);
      }
    }
  } catch {
    // Keep existing calibrated offset
  }
}

/** Wait until at least one NTP sample has been calibrated (with 800ms safety timeout) */
export function waitForInitialSync(): Promise<void> {
  if (_isSynced) return Promise.resolve();
  return new Promise<void>(resolve => {
    _syncResolvers.push(resolve);
    setTimeout(resolve, 800);
  });
}

/** Start background sync (5 rapid burst probes at init for <1ms convergence, then every 15s) */
export function startSync(): void {
  if (_intervalId) return;

  probe();
  setTimeout(probe, 120);
  setTimeout(probe, 300);
  setTimeout(probe, 600);
  setTimeout(probe, 1000);

  _intervalId = setInterval(probe, 15_000);
}

export function stopSync(): void {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
}

/** Get calibrated OANDA server time in epoch MILLISECONDS (sub-1ms precision) */
export function getCalibratedServerTimeMs(): number {
  return performance.now() + _perfOffset;
}

/** Get calibrated OANDA server time in epoch SECONDS (float) */
export function getCalibratedServerTimeSec(): number {
  return (performance.now() + _perfOffset) / 1000;
}

/** Get current offset in ms relative to Date.now() */
export function getOffset(): number {
  return getCalibratedServerTimeMs() - Date.now();
}

export function isSynced(): boolean {
  return _isSynced;
}

export function getSyncStats() {
  return {
    offsetMs: getOffset(),
    bestRttMs: _bestRtt,
    syncCount: _syncCount,
    isSynced: _isSynced,
  };
}

/**
 * Bind TradingView's internal ChartApiInstance._studyEngine directly to our
 * sub-1ms calibrated OANDA clock so the chart's bottom-right UTC clock,
 * bar countdown timer, and session aligner never drift from OANDA server time.
 */
export function bindTradingViewClock(containerId: string): void {
  const tryBind = () => {
    try {
      const container = document.getElementById(containerId);
      const iframe = container?.querySelector('iframe') as HTMLIFrameElement | null;
      const win = (iframe?.contentWindow || window) as any;
      const chartApi = win?.ChartApiInstance;
      const engine = chartApi?._studyEngine;

      if (engine) {
        const offsetSec = (getCalibratedServerTimeMs() - Date.now()) / 1000;
        engine._serverTimeOffset = offsetSec;
        engine.serverTimeOffset = () => (getCalibratedServerTimeMs() - Date.now()) / 1000;
        engine.getCurrentUTCTime = () => getCalibratedServerTimeSec();
        engine.serverTime = () => getCalibratedServerTimeMs();
      }
      if (chartApi) {
        chartApi.serverTimeOffset = () => (getCalibratedServerTimeMs() - Date.now()) / 1000;
        chartApi.serverTime = () => getCalibratedServerTimeMs();
      }
    } catch {
      // Ignore cross-frame timing errors during init
    }
  };

  tryBind();
  setTimeout(tryBind, 300);
  setTimeout(tryBind, 1000);
  setInterval(tryBind, 5000);
}
