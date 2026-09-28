import { useEffect, useRef, useState, useCallback } from 'react';
import { getWidgetOptions } from './chartConfig';
import { DEFAULT_WATCHLIST, fetchInstruments } from '../../services/oandaClient';
import { bindTradingViewClock } from '../../lib/serverTimeSync';

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

    try {
      localStorage.removeItem('tv_layout_state');
    } catch {}

    // Pre-warm full OANDA instruments catalog in background without blocking 0ms widget boot
    fetchInstruments().catch(() => {});

    setIsLoading(false);

    const options = getWidgetOptions(
      containerId,
      datafeedUrl,
      theme,
      brokerFactory,
      saveLoadAdapter,
      'XAUUSD',
      DEFAULT_WATCHLIST
    );

    const widget = new window.TradingView.widget(options);
    widgetRef.current = widget;
    (window as any).tvWidget = widget;
    bindTradingViewClock(containerId);

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
        try {
          widget.activeChart().removeAllShapes();
        } catch {}

        setIsReady(true);
      }
    });

    return () => {
      cancelled = true;
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

  const saveLayout = useCallback(() => {}, []);
  const loadLayout = useCallback(() => {}, []);

  return { widgetRef, isReady, isLoading, chartActions: { saveLayout, loadLayout } };
}
