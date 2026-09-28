import React, { useMemo } from 'react';
import { useChartWidget } from './useChartWidget';
import { useThemeStore } from '../../stores/themeStore';
import { OandaBroker } from '../../services/broker/OandaBroker';

interface TradingViewChartProps {
  containerId?: string;
  datafeedUrl?: string;
}

export const TradingViewChart: React.FC<TradingViewChartProps> = ({ 
  containerId = 'tv_chart_container', 
  datafeedUrl = ''
}) => {
  const { theme } = useThemeStore();
  const tvTheme = theme === 'dark' ? 'Dark' : 'Light';

  // Instantiate broker factory
  const brokerFactory = useMemo(() => {
    return function(host: any) {
      return new (OandaBroker as any)(host, datafeedUrl);
    };
  }, [datafeedUrl]);

  // Instantiate save load adapter if needed (optional)
  const saveLoadAdapter = useMemo(() => {
    return null; // Or a custom adapter object
  }, []);

  const { isReady } = useChartWidget(containerId, datafeedUrl, tvTheme, brokerFactory, saveLoadAdapter);

  return (
    <div className="w-full h-full relative">
      <div id={containerId} className="w-full h-full" />
      {!isReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-tv-bg text-tv-text pointer-events-none z-10">
          Loading Chart...
        </div>
      )}
    </div>
  );
};
