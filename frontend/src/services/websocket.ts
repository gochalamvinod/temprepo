import type { LiveQuote } from '../types/quote';
import { fetchOandaQuotes } from './oandaClient';

type QuoteCallback = (quote: LiveQuote) => void;

/**
 * Direct OANDA Real-Time Quote Streamer (Vercel & Browser Ready)
 */
class QuoteStreamService {
  private subscriptions: Set<string> = new Set();
  private onQuoteCallbacks: Set<QuoteCallback> = new Set();
  private onConnectCallbacks: Set<() => void> = new Set();
  private onDisconnectCallbacks: Set<() => void> = new Set();
  private pollInterval: number | null = null;
  private isConnected = false;
  private isPolling = false;

  constructor() {
    this.startPolling();
  }

  private startPolling() {
    if (this.pollInterval !== null) return;
    this.isConnected = true;
    this.onConnectCallbacks.forEach(cb => cb());

    // 100ms poll = 10 ticks/sec — absolute fastest safe REST polling rate
    this.pollInterval = window.setInterval(() => {
      this.pollQuotes();
    }, 100);
  }

  private async pollQuotes() {
    if (this.subscriptions.size === 0 || this.isPolling) return;
    this.isPolling = true;

    try {
      const syms = Array.from(this.subscriptions);
      const data = await fetchOandaQuotes(syms);
      if (data && data.s === 'ok' && Array.isArray(data.d)) {
        const nowMs = data.serverTimeMs || Date.now();
        for (const item of data.d) {
          if (item && item.v && !item.n.includes(':')) {
            const lp = item.v.lp ?? 0;
            const bid = item.v.bid ?? lp;
            const ask = item.v.ask ?? lp;
            const spread = item.v.spread ?? Math.abs(ask - bid);
            const quote: LiveQuote = {
              type: 'quote',
              symbol: item.n,
              data: {
                s: 'ok',
                n: item.n,
                v: {
                  lp,
                  bid,
                  ask,
                  spread,
                  ch: 0,
                  chp: 0,
                  open_price: lp,
                  high_price: lp,
                  low_price: lp,
                  prev_close_price: lp,
                  volume: 0,
                },
              },
              time_msc: nowMs,
              time_utc_msc: nowMs,
            };
            this.onQuoteCallbacks.forEach(cb => cb(quote));
          }
        }
      }
    } catch {
      // Ignore transient errors
    } finally {
      this.isPolling = false;
    }
  }

  subscribe(symbols: string[]) {
    let added = false;
    symbols.forEach(s => {
      const clean = s.replace(/^OANDA:/i, '').trim();
      if (clean && !this.subscriptions.has(clean)) {
        this.subscriptions.add(clean);
        added = true;
      }
    });
    if (added) {
      this.pollQuotes();
    }
  }

  unsubscribe(symbols: string[]) {
    symbols.forEach(s => {
      const clean = s.replace(/^OANDA:/i, '').trim();
      this.subscriptions.delete(clean);
    });
  }

  onQuote(cb: QuoteCallback) {
    this.onQuoteCallbacks.add(cb);
    return () => this.onQuoteCallbacks.delete(cb);
  }

  onConnect(cb: () => void) {
    this.onConnectCallbacks.add(cb);
    if (this.isConnected) cb();
    return () => this.onConnectCallbacks.delete(cb);
  }

  onDisconnect(cb: () => void) {
    this.onDisconnectCallbacks.add(cb);
    return () => this.onDisconnectCallbacks.delete(cb);
  }
}

export const quoteWs = new QuoteStreamService();
