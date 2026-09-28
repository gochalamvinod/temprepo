import type { WidgetOptions } from '../../types/tradingview';
import {
  getCalibratedServerTimeSec,
  startSync,
  waitForInitialSync,
} from '../../lib/serverTimeSync';
import {
  SUPPORTED_RESOLUTIONS,
  resolveSymbolMetaSync,
  fetchOandaHistory,
  fetchOandaQuotes,
  fetchInstruments,
  toDisplaySymbol,
  toOandaSymbol,
} from '../../services/oandaClient';
import { quoteWs } from '../../services/websocket';

// Start OANDA-synced clock immediately on module load
startSync();

interface BarState {
  time: number; // ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function createUniversalDatafeed(datafeedUrl: string) {
  const base = new (window as any).Datafeeds.UDFCompatibleDatafeed(datafeedUrl, 10);

  // Track last valid bar per (symbol|resolution) to guarantee zero time-violation errors at 10ms UDF speed
  const lastBarBySeries = new Map<string, BarState>();
  const activeRealtimeCleanups = new Map<string, () => void>();

  // Override internal UDF requester for 0ms config/symbol/time resolution & 1-hop direct OANDA calls
  if (base._requester) {
    base._requester.sendRequest = async (_url: string, endpoint: string, params?: Record<string, any>) => {
      switch (endpoint) {
        case 'config':
          return {
            supported_resolutions: SUPPORTED_RESOLUTIONS,
            supports_group_request: false,
            supports_marks: true,
            supports_search: true,
            supports_timescale_marks: true,
            supports_time: true,
            has_intraday: true,
            has_seconds: true,
            has_ticks: true,
            ticks_multipliers: ['1', '3', '10'],
            seconds_multipliers: ['1', '3', '5', '10', '15', '30'],
            intraday_multipliers: ['1', '2', '3', '4', '5', '10', '15', '30', '45', '60', '120', '180', '240'],
            daily_multipliers: ['1'],
            weekly_multipliers: ['1'],
            monthly_multipliers: ['1'],
            default_symbol: 'XAUUSD',
          };
        case 'time':
          await waitForInitialSync();
          return getCalibratedServerTimeSec();
        case 'symbols': {
          const sym = params?.symbol || 'XAUUSD';
          const m = resolveSymbolMetaSync(sym);
          const pricescale = Math.pow(10, m.displayPrecision);
          const symUpper = sym.toUpperCase().replace(/[^A-Z0-9]/g, '');
          const isCrypto = symUpper.startsWith('BTC') || symUpper.startsWith('ETH') || symUpper.startsWith('LTC') || symUpper.startsWith('SOL');
          const session = isCrypto ? '24x7' : '2200-2200:12345';
          return {
            name: m.symbol,
            ticker: m.symbol,
            full_name: `OANDA:${m.symbol}`,
            description: `${m.displayName} (${m.type})`,
            type: m.type === 'CURRENCY' ? 'forex' : 'cfd',
            session,
            timezone: 'Etc/UTC',
            exchange: 'OANDA',
            listed_exchange: 'OANDA',
            minmov: 1,
            pricescale,
            has_intraday: true,
            intraday_multipliers: ['1', '2', '3', '4', '5', '10', '15', '30', '45', '60', '120', '180', '240'],
            has_seconds: true,
            seconds_multipliers: ['1', '3', '5', '10', '15', '30'],
            has_ticks: true,
            ticks_multipliers: ['1', '3', '10'],
            has_daily: true,
            daily_multipliers: ['1'],
            has_weekly_and_monthly: true,
            weekly_multipliers: ['1'],
            monthly_multipliers: ['1'],
            has_empty_bars: false,
            supported_resolutions: SUPPORTED_RESOLUTIONS,
            data_status: 'streaming',
          };
        }
        case 'history': {
          const sym = params?.symbol || 'XAUUSD';
          const res = String(params?.resolution || '1');
          const from = Number(params?.from || 0);
          const to = Number(params?.to || 0);
          const countback = params?.countback !== undefined ? Number(params.countback) : 500;
          const firstDataRequest =
            params?.firstDataRequest === undefined
              ? countback > 10 && (!to || to >= getCalibratedServerTimeSec() - 60)
              : params.firstDataRequest === true || params.firstDataRequest === 'true';
          return fetchOandaHistory(sym, res, from, to, countback, firstDataRequest);
        }
        case 'quotes': {
          const raw = String(params?.symbols || '');
          const syms = raw.split(',').map(s => s.trim()).filter(Boolean);
          return fetchOandaQuotes(syms);
        }
        case 'search': {
          const q = String(params?.query || '').trim().toUpperCase();
          const limit = Number(params?.limit || 30);
          const list = await fetchInstruments();
          return list
            .filter(i => !q || i.symbol.includes(q) || i.name.includes(q) || i.displayName.toUpperCase().includes(q))
            .slice(0, limit)
            .map(i => ({
              symbol: i.symbol,
              full_name: `OANDA:${i.symbol}`,
              description: `${i.displayName} (${i.type})`,
              exchange: 'OANDA',
              type: i.type === 'CURRENCY' ? 'forex' : 'cfd',
            }));
        }
        default:
          return [];
      }
    };
  }

  const convertTicksToSeconds = (res: string): string => {
    if (typeof res === 'string' && /^(\d+)T$/i.test(res.trim())) {
      return res.trim().replace(/T$/i, 'S');
    }
    return res;
  };

  return {
    onReady: (cb: (config: any) => void) => {
      base.onReady((cfg: any) => {
        cb({
          ...cfg,
          supports_time: true,
          has_intraday: true,
          has_seconds: true,
          has_ticks: true,
          ticks_multipliers: ['1', '3', '10'],
          seconds_multipliers: ['1', '3', '5', '10', '15', '30'],
          intraday_multipliers: ['1', '2', '3', '4', '5', '10', '15', '30', '45', '60', '120', '180', '240'],
          daily_multipliers: ['1'],
          weekly_multipliers: ['1'],
          monthly_multipliers: ['1'],
        });
      });
    },
    searchSymbols: base.searchSymbols.bind(base),
    resolveSymbol: (symbolName: string, onResolved: (info: any) => void, onError: (err: any) => void, ext?: any) => {
      base.resolveSymbol(
        symbolName,
        (info: any) => {
          const symUpper = (symbolName || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          const isCrypto = symUpper.startsWith('BTC') || symUpper.startsWith('ETH') || symUpper.startsWith('LTC') || symUpper.startsWith('SOL');
          const session = isCrypto ? '24x7' : '2200-2200:12345';
          onResolved({
            ...info,
            session,
            timezone: 'Etc/UTC',
            has_intraday: true,
            intraday_multipliers: ['1', '2', '3', '4', '5', '10', '15', '30', '45', '60', '120', '180', '240'],
            has_seconds: true,
            seconds_multipliers: ['1', '3', '5', '10', '15', '30'],
            has_ticks: true,
            ticks_multipliers: ['1', '3', '10'],
            has_daily: true,
            daily_multipliers: ['1'],
            has_weekly_and_monthly: true,
            weekly_multipliers: ['1'],
            monthly_multipliers: ['1'],
          });
        },
        onError,
        ext
      );
    },
    getBars: (symbolInfo: any, resolution: string, periodParams: any, onHistory: any, onError: any) => {
      const effectiveRes = convertTicksToSeconds(resolution);
      const dispSym = toDisplaySymbol(toOandaSymbol(symbolInfo?.ticker || symbolInfo?.name || 'XAUUSD'));
      const seriesKey = `${dispSym}|${effectiveRes}`;

      return base.getBars(
        symbolInfo,
        effectiveRes,
        periodParams,
        (bars: BarState[], meta: any) => {
          if (Array.isArray(bars) && bars.length > 0) {
            const last = bars[bars.length - 1];
            const prev = lastBarBySeries.get(seriesKey);
            if (periodParams?.firstDataRequest || !prev || last.time >= prev.time) {
              lastBarBySeries.set(seriesKey, { ...last });
            }
          }
          onHistory(bars, meta);
        },
        onError
      );
    },
    subscribeBars: (symbolInfo: any, resolution: string, onRealtime: any, uid: string, onReset: any) => {
      const effectiveRes = convertTicksToSeconds(resolution);
      const dispSym = toDisplaySymbol(toOandaSymbol(symbolInfo?.ticker || symbolInfo?.name || 'XAUUSD'));
      const seriesKey = `${dispSym}|${effectiveRes}`;

      quoteWs.subscribe([dispSym]);

      // Monotonic bar emitter: guarantees no time-violation errors and preserves intra-bar high/low wicks
      const emitSafeBar = (incoming: BarState) => {
        const last = lastBarBySeries.get(seriesKey);
        // Do not emit realtime bars until initial getBars has seeded the series
        if (!last) return;

        if (incoming.time < last.time) {
          return; // Drop stale out-of-order bar
        }

        if (incoming.time === last.time) {
          const merged: BarState = {
            time: last.time,
            open: last.open,
            high: Math.max(last.high, incoming.high, incoming.close),
            low: Math.min(last.low, incoming.low, incoming.close),
            close: incoming.close,
            volume: Math.max(last.volume || 1, incoming.volume || 1),
          };
          lastBarBySeries.set(seriesKey, merged);
          onRealtime(merged);
        } else {
          const nextBar: BarState = {
            time: incoming.time,
            open: incoming.open,
            high: Math.max(incoming.open, incoming.high, incoming.close),
            low: Math.min(incoming.open, incoming.low, incoming.close),
            close: incoming.close,
            volume: incoming.volume || 1,
          };
          lastBarBySeries.set(seriesKey, nextBar);
          onRealtime(nextBar);
        }
      };

      const unsubQuote = quoteWs.onQuote(q => {
        if (q.symbol !== dispSym) return;
        const last = lastBarBySeries.get(seriesKey);
        if (!last) return;
        const lp = q.data?.v?.lp;
        if (!lp || lp <= 0) return;

        emitSafeBar({
          time: last.time,
          open: last.open,
          high: Math.max(last.high, lp),
          low: Math.min(last.low, lp),
          close: lp,
          volume: (last.volume || 1) + 1,
        });
      });

      const prevCleanup = activeRealtimeCleanups.get(uid);
      if (prevCleanup) prevCleanup();
      activeRealtimeCleanups.set(uid, () => {
        unsubQuote();
      });

      return base.subscribeBars(
        symbolInfo,
        effectiveRes,
        emitSafeBar,
        uid,
        onReset
      );
    },
    unsubscribeBars: (uid: string) => {
      const cleanup = activeRealtimeCleanups.get(uid);
      if (cleanup) {
        cleanup();
        activeRealtimeCleanups.delete(uid);
      }
      return base.unsubscribeBars(uid);
    },
    getMarks: base.getMarks?.bind(base),
    getTimescaleMarks: base.getTimescaleMarks?.bind(base),
    getServerTime: (cb: (time: number) => void) => {
      waitForInitialSync().then(() => {
        cb(getCalibratedServerTimeSec());
      });
    },
    getQuotes: base.getQuotes?.bind(base),
    subscribeQuotes: base.subscribeQuotes?.bind(base),
    unsubscribeQuotes: base.unsubscribeQuotes?.bind(base),
  };
}

export function getWidgetOptions(
  container: HTMLElement | string,
  datafeedUrl: string,
  theme: 'Dark' | 'Light' = 'Dark',
  brokerFactory?: (host: any) => any,
  saveLoadAdapter?: any,
  defaultSymbol: string = '',       // Fetched from server, never hardcoded
  watchlistSymbols: string[] = [],   // Fetched from server /instruments
  savedData?: any
): WidgetOptions {
  return {
    container,
    fullscreen: true,
    autosize: true,
    symbol: defaultSymbol,
    interval: "1D",
    library_path: "/charting_library/",
    locale: "en",
    datafeed: createUniversalDatafeed(datafeedUrl),
    theme,
    custom_css_url: "/custom.css",
    numeric_formatting: { decimal_sign: "." },
    save_load_adapter: saveLoadAdapter,
    saved_data: savedData || undefined,
    auto_save_delay: 2,
    load_last_chart: true,

    broker_factory: brokerFactory,
    broker_config: {
      configFlags: {
        supportReversePosition: true,
        supportPositionReverse: true,
        supportStopLoss: true,
        supportClosePosition: true,
        supportPartialClosePosition: true,
        supportEditAmount: false,
        supportLevel2Data: true,
        supportDOM: true,
        supportMarketOrders: true,
        supportLimitOrders: true,
        supportStopOrders: true,
        supportStopLimitOrders: true,
        supportPositionBrackets: true,
        showQuantityInsteadOfAmount: true,
        supportOrderBrackets: true,
        supportModifyOrder: true,
        supportModifyOrderPrice: true,
        supportCancelOrder: true,
        supportModifyBrackets: true,
        supportModifyPositionBrackets: true,
        supportModifyOrderBrackets: true,
        supportAddBracketsToExistingOrder: true,
        supportPlaceOrderPreview: false,
        supportModifyOrderPreview: false,
        supportOrdersHistory: true,
        supportExecutions: true,
        supportBalances: false,
        supportMarketBrackets: true,
        supportStopOrdersInBothDirections: true,
        supportStopLimitOrdersInBothDirections: true,
        supportTrailingStop: true,
        supportModifyTrailingStop: true,
        supportPositions: true,
        supportRiskControlsAndInfo: true,
        supportPLUpdate: true,
        showNotificationsLog: true,
        supportDemoLiveSwitcher: false
      }
    },

    overrides: {
      'tradingProperties.showOrders': true,
      'tradingProperties.showPositions': true,
      'tradingProperties.showReverse': true,
      'tradingProperties.showExecutions': true,
      'tradingProperties.extendLeft': true,
      'tradingProperties.horizontalAlignment': 2,
      'paneProperties.legendProperties.showSeriesTitle': true,
      'paneProperties.legendProperties.showSeriesOHLC': true,
      'paneProperties.legendProperties.showBarChange': true,
      'paneProperties.legendProperties.showLegend': true,
      'paneProperties.legendProperties.showTradingButtons': true,
      'paneProperties.legendProperties.showStudyArguments': true,
      'paneProperties.legendProperties.showStudyTitles': true,
      'paneProperties.legendProperties.showStudyValues': true,
      'mainSeriesProperties.statusViewStyle.symbolTextSource': 'ticker',
      'mainSeriesProperties.statusViewStyle.showExchange': true,
      'mainSeriesProperties.statusViewStyle.showInterval': true,
      'mainSeriesProperties.prePostMarket.preMarketColor': 'transparent',
      'mainSeriesProperties.prePostMarket.postMarketColor': 'transparent',
      'scalesProperties.showPrePostMarketPriceLabel': false
    },

    favorites: {
      intervals: ["1T", "3T", "10T", "1S", "5S", "15S", "30S", "1", "5", "15", "60", "240", "1D", "1W", "1M"],
      chartTypes: ["Area", "Candles", "Heikin Ashi"]
    },

    time_frames: [
      { text: "1d", resolution: "5S", description: "1 Day (5s)" },
      { text: "5d", resolution: "1", description: "5 Days (1m)" },
      { text: "1m", resolution: "15", description: "1 Month (15m)" },
      { text: "3m", resolution: "60", description: "3 Months (1h)" },
      { text: "1y", resolution: "1D", description: "1 Year (1d)" },
      { text: "5y", resolution: "1D", description: "5 Years (1d)" },
      { text: "10y", resolution: "1M", description: "10 Years (1M)" }
    ],

    widgetbar: {
      details: true,
      watchlist: true,
      datawindow: true,
      watchlist_settings: {
        default_symbols: watchlistSymbols,  // Dynamic — fetched from /instruments at startup
      }
    },
    watchlist: watchlistSymbols,  // Dynamic — no hardcoded symbols

    disabled_features: [
      "news_widget",
      "news_provider",
      "timescale_marks",
      "marks",
      "allow_supported_resolutions_set_only",
      "symbol_search_option_chain_selector",
      "volume_force_overlay",
      "intraday_inactivity_gaps",
      "pre_post_market_price_line",
      "header_compare", 
      "timeframes_toolbar",
      "popup_hints_candle_size", 
      "display_market_status"
    ],

    enabled_features: [
      "use_localstorage_for_settings",
      "side_toolbar_in_fullscreen_mode",
      "header_in_fullscreen_mode",
      "seconds_resolution",
      "tick_resolution",
      "pre_post_market_sessions",
      "show_symbol_logos",
      "save_chart_properties_to_local_storage",
      "create_volume_indicator_by_default",
      "trading_account_manager",
      "order_panel",
      "buy_sell_buttons",
      "show_trading_notifications_history",
      "multiple_watchlists",
      "dom_widget",
      
      "trading_terminal", "order_panel_close_button", "order_panel_undock",
      "open_account_manager",
      "trading_notifications",
      "chart_property_page_trading", "broker_button",
      "show_dom_first_time", "enable_dom_data_for_untradable_symbols",
      "always_pass_called_order_to_modify", "order_info",
      "snapshot_trading_drawings",

      "custom_resolutions",
      "show_average_close_price_line_and_label",
      "countdown",

      "japanese_chart_styles", "chart_style_hilo", "chart_style_hilo_last_price",
      "support_multicharts", "multi_chart_layout", "additional_multichart_layouts",
      "chart_crosshair_menu", "border_around_the_chart",

      "header_resolutions", "header_interval_dialog_button", "show_interval_dialog_on_key_press",
      "header_chart_type", "header_settings", "header_undo_redo",
      "header_quick_search", "header_symbol_search",
      "header_layouttoggle", "header_screenshot", "header_fullscreen_button",
      "header_indicators", "header_saveload",

      "left_toolbar", "right_toolbar",

      "watchlist_context_menu", "watchlist_import_export",
      "watchlist_sections", "watchlist_cross_tab_sync",
      "show_symbol_watchlist", "add_to_watchlist",
      "widgetbar_tabs", "show_right_widgets_panel_by_default",
      "details", "quote_summary", "data_window",

      "show_exchange_logos",
      "show_symbol_logo_in_account_manager",
      "symbol_info", "symbol_info_price_source",

      "legend_inplace_edit",
      "show_hide_button_in_legend", "study_buttons_in_legend",
      "format_button_in_legend", "delete_button_in_legend",
      "edit_buttons_in_legend", "items_favoriting",
      "study_on_study",

      "source_selection_markers",
      "show_object_tree", "lines_properties",
      "saveload_separate_drawings_storage"
    ]
  };
}
