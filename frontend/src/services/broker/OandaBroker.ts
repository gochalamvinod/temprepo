import { api } from '../api';
import { useTradeStore } from '../../stores/tradeStore';
import { quoteWs } from '../websocket';

class Delegate {
  private _listeners: Array<{ caller: any, fn: Function }> = [];

  subscribe(caller: any, fn?: Function) {
    if (typeof fn === 'function') {
      this._listeners.push({ caller, fn });
    } else if (typeof caller === 'function') {
      this._listeners.push({ caller: null, fn: caller });
    }
  }

  unsubscribe(caller: any, fn?: Function) {
    this._listeners = this._listeners.filter(l => {
      if (fn) return !(l.caller === caller && l.fn === fn);
      return l.caller !== caller && l.fn !== caller;
    });
  }

  fire(...args: any[]) {
    for (const l of this._listeners.slice()) {
      try {
        l.fn.apply(l.caller, args);
      } catch (e) {
        console.warn("[Broker Delegate Error]", e);
      }
    }
  }
}

class BrokerWatchedValue {
  private _listeners: Function[] = [];
  private _value: any;

  constructor(val: any) {
    this._value = val;
  }

  value() {
    return this._value;
  }

  setValue(val: any) {
    if (this._value === val) return;
    this._value = val;
    for (const fn of this._listeners.slice()) {
      try { fn(this._value); } catch (e) {}
    }
  }

  subscribe(caller: any, fn?: Function) {
    const cb = typeof fn === 'function' ? fn : caller;
    if (typeof cb === 'function' && !this._listeners.includes(cb)) {
      this._listeners.push(cb);
    }
  }

  unsubscribe(caller: any, fn?: Function) {
    const cb = typeof fn === 'function' ? fn : caller;
    this._listeners = this._listeners.filter(l => l !== cb);
  }

  readonly() {
    return this;
  }

  destroy() {
    this._listeners = [];
  }
}

export class OandaBroker {
  private _host: any;
  
  public connectionStatusUpdate = new Delegate();
  public currentAccountUpdate = new Delegate();
  public orderUpdate = new Delegate();
  public orderPartialUpdate = new Delegate();
  public positionUpdate = new Delegate();
  public executionUpdate = new Delegate();

  private _positions: any[] = [];
  private _orders: any[] = [];
  private _summaryWVs: any;
  private _pollTimer: number | null = null;
  private _destroyed = false;

  private _subscribedSymbols = new Set<string>();
  private _wsUnsubscribe: (() => void) | null = null;

  constructor(host: any, _datafeedUrl: string) {
    this._host = host;

    const makeWV = (val: any) => {
      if (this._host && this._host.factory && typeof this._host.factory.createWatchedValue === 'function') {
        return this._host.factory.createWatchedValue(val);
      }
      return new BrokerWatchedValue(val);
    };

    this._summaryWVs = {
      accountId: makeWV("101-001-40395350-001"),
      balance: makeWV("$0.00"),
      equity: makeWV("$0.00"),
      profit: makeWV("$0.00"),
      margin: makeWV("$0.00"),
      marginFree: makeWV("$0.00"),
      leverage: makeWV("50:1")
    };

    setTimeout(() => {
      try {
        if (this._host && typeof this._host.connectionStatusUpdate === 'function') {
          this._host.connectionStatusUpdate(1);
        }
        this.connectionStatusUpdate.fire(1);
      } catch (e) {}
    }, 50);

    this._syncAccountAndState();
    this._startPolling();

    // Listen to WS quotes
    this._wsUnsubscribe = quoteWs.onQuote((quote: any) => {
      if (!quote) return;
      const v = quote.data?.v || quote.data || quote.v || quote;
      const ask = Number(v?.ask ?? v?.lp ?? 0);
      const bid = Number(v?.bid ?? v?.lp ?? 0);
      const spread = Number(v?.spread ?? Math.abs(ask - bid));
      const trade = Number(v?.lp ?? v?.trade ?? (bid + ask) * 0.5);
      const symbol = quote.symbol || quote.n || '';

      if (symbol) {
        this._broadcastQuote(symbol, {
          ask,
          bid,
          spread,
          trade
        });
      }
    });
  }

  metainfo() {
    return {
      id: "Broker",
      name: "OANDA",
      description: "OANDA v20 REST + WebSocket Streaming",
      configFlags: {
        supportPositions: true,
        supportPositionNetting: false,
        supportOrders: true,
        supportOrdersHistory: true,
        supportTradeHistoryTabInAccountManager: true,
        supportExecutions: true,
        supportLevel2Data: true,
        supportDOM: true,
        supportMarketOrders: true,
        supportLimitOrders: true,
        supportStopOrders: true,
        supportStopLimitOrders: true,
        supportPositionBrackets: true,
        supportOrderBrackets: true,
        supportModifyOrder: true,
        supportModifyOrderPrice: true,
        supportCancelOrder: true,
        supportClosePosition: true,
        supportQuotes: true
      }
    };
  }

  async isTradable(_symbol: string) {
    return { tradable: true };
  }

  currentAccount() {
    return "101-001-40395350-001";
  }

  async accountsList() {
    return [{ id: "101-001-40395350-001", name: "OANDA Practice", currency: "USD" }];
  }

  async accountsMetainfo() {
    return [{ id: "101-001-40395350-001", name: "OANDA Practice", currency: "USD", currencySign: "$" }];
  }

  async accountMetainfo() {
    return { id: "101-001-40395350-001", name: "OANDA Practice", currency: "USD", currencySign: "$" };
  }

  async symbolInfo(symbol: string) {
    return {
      name: symbol,
      ticker: symbol,
      description: symbol,
      type: "forex",
      session: "24x7",
      timezone: "Etc/UTC",
      exchange: "OANDA",
      minmov: 1,
      pricescale: 100000,
      minTick: 0.0001,
      pipSize: 0.0001,
      pipValue: 1,
      hasQuotes: true,
      qty: { min: 1, max: 10000000, step: 1, default: 1 },
      currency: "USD"
    };
  }

  connectionStatus() {
    return 1;
  }

  private _startPolling() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = window.setInterval(() => {
      if (this._destroyed) return;
      this._syncAccountAndState();
    }, 1500);
  }

  private async _syncAccountAndState() {
    try {
      const [acc, pos, ord] = await Promise.all([
        api.getAccount().catch(() => null),
        api.getPositions().catch(() => null),
        api.getOrders().catch(() => null)
      ]);

      if (acc) {
        this._summaryWVs.balance.setValue(`$${(acc.balance || 0).toLocaleString()}`);
        this._summaryWVs.equity.setValue(`$${(acc.equity || 0).toLocaleString()}`);
        this._summaryWVs.profit.setValue(`$${(acc.profit || 0).toLocaleString()}`);
        this._summaryWVs.margin.setValue(`$${(acc.margin || 0).toLocaleString()}`);
        this._summaryWVs.marginFree.setValue(`$${(acc.margin_free || 0).toLocaleString()}`);
        this._summaryWVs.leverage.setValue(`${acc.leverage || 50}:1`);
        
        if (this._host && typeof this._host.equityUpdate === 'function') {
          this._host.equityUpdate(acc.equity || acc.balance);
        }

        // Sync with zustand
        useTradeStore.setState({ account: acc });
      }

      if (pos) {
        this._positions = pos.map(p => this._normalizePosition(p));
        this._positions.forEach(p => {
          if (this._host && typeof this._host.positionUpdate === 'function') {
            this._host.positionUpdate(p);
          }
        });
        useTradeStore.setState({ positions: pos });
      }

      if (ord) {
        this._orders = ord.map(o => this._normalizeOrder(o));
        this._orders.forEach(o => {
          if (this._host && typeof this._host.orderUpdate === 'function') {
            this._host.orderUpdate(o);
          }
        });
        useTradeStore.setState({ orders: ord });
      }
    } catch (e) {}
  }

  private _normalizePosition(p: any) {
    const side = (p.type === 0 || p.side === 'buy' || p.side === 1) ? 1 : -1;
    return {
      id: String(p.ticket),
      ticket: String(p.ticket),
      symbol: p.symbol || "EURUSD",
      qty: parseFloat(p.volume || 1.0),
      side,
      avgPrice: parseFloat(p.price_open || 0.0),
      price: parseFloat(p.price_current || 0.0),
      profit: parseFloat(p.profit || 0.0),
      stopLoss: p.sl ? parseFloat(p.sl) : undefined,
      takeProfit: p.tp ? parseFloat(p.tp) : undefined,
      canBeClosed: true
    };
  }

  private _normalizeOrder(o: any) {
    const side = (o.type === 0 || o.side === 'buy' || o.side === 1) ? 1 : -1;
    return {
      id: String(o.ticket),
      ticket: String(o.ticket),
      symbol: o.symbol || "EURUSD",
      qty: parseFloat(o.volume_current || o.volume_initial || 1.0),
      side,
      type: o.type_name || "LIMIT",
      limitPrice: o.price_open ? parseFloat(o.price_open) : undefined,
      stopPrice: o.price_open ? parseFloat(o.price_open) : undefined,
      stopLoss: o.sl ? parseFloat(o.sl) : undefined,
      takeProfit: o.tp ? parseFloat(o.tp) : undefined,
      status: 6
    };
  }

  accountManagerInfo() {
    return {
      accountTitle: "OANDA v20 (Practice)",
      summary: [
        { text: "Account ID", wValue: this._summaryWVs.accountId, value: "101-001-40395350-001", formatter: "text" },
        { text: "Balance", wValue: this._summaryWVs.balance, value: "$0.00", formatter: "text" },
        { text: "Equity", wValue: this._summaryWVs.equity, value: "$0.00", formatter: "text" },
        { text: "Unrealized P&L", wValue: this._summaryWVs.profit, value: "$0.00", formatter: "text" },
        { text: "Margin Used", wValue: this._summaryWVs.margin, value: "$0.00", formatter: "text" },
        { text: "Free Margin", wValue: this._summaryWVs.marginFree, value: "$0.00", formatter: "text" },
        { text: "Leverage", wValue: this._summaryWVs.leverage, value: "50:1", formatter: "text" }
      ],
      orderColumns: [
        { id: "ticket", label: "Ticket", formatter: "text" },
        { id: "symbol", label: "Symbol", formatter: "symbol" },
        { id: "side", label: "Side", formatter: "side" },
        { id: "type", label: "Type", formatter: "text" },
        { id: "qty", label: "Qty", formatter: "quantity" },
        { id: "limitPrice", label: "Price", formatter: "price" },
        { id: "stopLoss", label: "SL", formatter: "price" },
        { id: "takeProfit", label: "TP", formatter: "price" }
      ],
      positionColumns: [
        { id: "ticket", label: "Ticket", formatter: "text" },
        { id: "symbol", label: "Symbol", formatter: "symbol" },
        { id: "side", label: "Side", formatter: "side" },
        { id: "qty", label: "Qty", formatter: "quantity" },
        { id: "avgPrice", label: "Avg Price", formatter: "price" },
        { id: "price", label: "Current Price", formatter: "price" },
        { id: "profit", label: "Profit", formatter: "profit" },
        { id: "stopLoss", label: "SL", formatter: "price" },
        { id: "takeProfit", label: "TP", formatter: "price" }
      ],
      historyColumns: [],
      pages: []
    };
  }

  async orders() {
    await this._syncAccountAndState();
    return this._orders;
  }

  async ordersHistory() {
    try {
      const res = await api.getTradeHistory(7);
      if (res && res.orders) {
        return res.orders.map(item => ({
          id: String(item.ticket),
          ticket: String(item.ticket),
          symbol: item.symbol,
          side: item.type === 0 ? 1 : -1,
          type: item.type_name || "MARKET",
          qty: item.volume_initial || 1,
          price: item.price_open || 0,
          profit: item.profit || 0,
          status: 2
        }));
      }
    } catch (e) {}
    return [];
  }

  async positions() {
    await this._syncAccountAndState();
    return this._positions;
  }

  async executions(_symbol: string) {
    return [];
  }

  async placeOrder(order: any) {
    const isMarket = !order.limitPrice && !order.stopPrice;
    
    if (isMarket) {
      await api.placeOrder({
        symbol: order.symbol,
        action: order.side > 0 ? "BUY" : "SELL",
        volume: order.qty || 1.0,
        sl: order.stopLoss || undefined,
        tp: order.takeProfit || undefined
      });
    } else {
      await api.placePending({
        symbol: order.symbol,
        order_type: order.limitPrice ? (order.side > 0 ? "BUY_LIMIT" : "SELL_LIMIT") : (order.side > 0 ? "BUY_STOP" : "SELL_STOP"),
        price: order.limitPrice || order.stopPrice,
        volume: order.qty || 1.0,
        sl: order.stopLoss || undefined,
        tp: order.takeProfit || undefined
      });
    }

    await this._syncAccountAndState();
    return { orderId: String(Date.now()) };
  }

  async modifyOrder(order: any) {
    await api.modifyOrder({
      ticket: parseInt(order.id, 10),
      sl: order.stopLoss || undefined,
      tp: order.takeProfit || undefined,
      price: order.limitPrice || order.stopPrice || undefined
    });
    await this._syncAccountAndState();
    return true;
  }

  async cancelOrder(orderId: string) {
    await api.closePosition({ ticket: parseInt(orderId, 10) });
    await this._syncAccountAndState();
    return true;
  }

  async closePosition(positionId: string) {
    return this.cancelOrder(positionId);
  }

  subscribeRealtime(symbol: string, _listener: any) {
    this._subscribedSymbols.add(symbol);
    quoteWs.subscribe([symbol]);
  }

  unsubscribeRealtime(symbol: string, _listener: any) {
    this._subscribedSymbols.delete(symbol);
    quoteWs.unsubscribe([symbol]);
  }

  private _broadcastQuote(symbol: string, quote: any) {
    if (this._host) {
      if (typeof this._host.realtimeUpdate === 'function') {
        this._host.realtimeUpdate(symbol, quote);
      }
    }
  }

  destroy() {
    this._destroyed = true;
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = null;
    if (this._wsUnsubscribe) this._wsUnsubscribe();
  }
}
