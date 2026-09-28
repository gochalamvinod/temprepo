import { useEffect, useRef, useState, useCallback } from 'react';
import { getWidgetOptions } from './chartConfig';
import { DEFAULT_WATCHLIST, fetchInstruments } from '../../services/oandaClient';
import { bindTradingViewClock } from '../../lib/serverTimeSync';
import {
  LocalStorageSaveLoadAdapter,
  getSavedChartState,
  saveActiveChartState,
} from '../../lib/saveLoadAdapter';

export function useChartWidget(
  containerId: string,
  datafeedUrl: string,
  theme: 'Dark' | 'Light',
  brokerFactory?: any,
  saveLoadAdapter?: any
) {
  const widgetRef = useRef<any>(null);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const container = document.getElementById(containerId);
    if (!container) return;

    if (!window.TradingView || !window.TradingView.widget) {
      console.error('TradingView library is not loaded globally.');
      return;
    }

    // Pre-warm full OANDA instruments catalog in background without blocking 0ms widget boot
    fetchInstruments().catch(() => {});

    setIsLoading(false);

    const adapter = saveLoadAdapter || new LocalStorageSaveLoadAdapter();
    const savedChartData = getSavedChartState();

    const options = getWidgetOptions(
      containerId,
      datafeedUrl,
      theme,
      brokerFactory,
      adapter,
      'XAUUSD',
      DEFAULT_WATCHLIST,
      savedChartData
    );

    const widget = new window.TradingView.widget(options);
    widgetRef.current = widget;
    (window as any).tvWidget = widget;
    bindTradingViewClock(containerId);

    // Auto-save debounced handler for all user drawings and layout changes
    let saveTimeout: ReturnType<typeof setTimeout> | null = null;
    const triggerSave = () => {
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        try {
          if (widget && typeof widget.save === 'function') {
            widget.save((state: any) => {
              if (state) {
                saveActiveChartState(state);
              }
            });
          }
        } catch (e) {
          console.warn('Auto-save failed', e);
        }
      }, 500);
    };

    const triggerSaveSync = () => {
      try {
        if (widget && typeof widget.save === 'function') {
          widget.save((state: any) => {
            if (state) {
              saveActiveChartState(state);
            }
          });
        }
      } catch {}
    };

    // Save on tab close, page refresh, or visibility change
    window.addEventListener('beforeunload', triggerSaveSync);
    const onVisibilityChange = () => {
      if (document.hidden) triggerSaveSync();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    widget.onChartReady(() => {
      if (!cancelled) {
        (window as any).tvWidget = widget;
        bindTradingViewClock(containerId);

        const stripLogoWatermark = () => {
          try {
            const chartObj = (widget as any).activeChart?.();
            const model = chartObj?._chartWidget?.model?.()?.model?.() || chartObj?._chartWidget?._model?.m_model;
            const sources = model?._dataSources || model?.dataSources?.() || [];
            for (const src of sources) {
              if (src && ('_tradingviewLogoLinkToPath' in src || '_customLogoSrc' in src || '_showBranding' in src)) {
                src.paneViews = () => [];
                model?.updateSource?.(src);
              }
            }
          } catch {}
        };
        stripLogoWatermark();
        setTimeout(stripLogoWatermark, 500);

        // Auto-save triggers on any user chart interaction or drawing
        try {
          widget.subscribe('onAutoSaveNeeded', triggerSave);
        } catch {}

        try {
          const chart = widget.activeChart();
          chart.onIntervalChanged?.().subscribe(null, triggerSave);
          chart.onSymbolResolved?.().subscribe(null, triggerSave);
          (chart as any).onSymbolChanged?.().subscribe(null, triggerSave);
        } catch {}

        // Periodic auto-save every 5 seconds to guarantee drawing persistence
        const periodicSaveInterval = setInterval(triggerSave, 5000);

        setIsReady(true);

        return () => {
          clearInterval(periodicSaveInterval);
        };
      }
    });

    return () => {
      cancelled = true;
      triggerSaveSync();
      window.removeEventListener('beforeunload', triggerSaveSync);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (saveTimeout) clearTimeout(saveTimeout);
      if (widgetRef.current) {
        try {
          widgetRef.current.remove();
        } catch (e) {
          console.error('Error removing widget', e);
        }
        widgetRef.current = null;
        setIsReady(false);
      }
    };
  }, [containerId, datafeedUrl, brokerFactory, saveLoadAdapter]);

  useEffect(() => {
    if (isReady && widgetRef.current) {
      widgetRef.current.changeTheme(theme);
    }
  }, [theme, isReady]);

  const saveLayout = useCallback(() => {
    if (widgetRef.current && typeof widgetRef.current.save === 'function') {
      widgetRef.current.save((state: any) => {
        if (state) saveActiveChartState(state);
      });
    }
  }, []);

  const loadLayout = useCallback(() => {
    const saved = getSavedChartState();
    if (saved && widgetRef.current && typeof widgetRef.current.load === 'function') {
      widgetRef.current.load(saved);
    }
  }, []);

  return { widgetRef, isReady, isLoading, chartActions: { saveLayout, loadLayout } };
}
