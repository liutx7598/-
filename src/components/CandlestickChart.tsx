import { memo, useMemo } from 'react'
import ReactECharts from 'echarts-for-react'

import type { ChartCandle } from '../../shared/types'

interface CandlestickChartProps {
  candles: ChartCandle[]
  compact?: boolean
}

function buildOption(candles: ChartCandle[], compact: boolean) {
  const labels = candles.map((candle) =>
    new Intl.DateTimeFormat('zh-CN', {
      month: compact ? undefined : '2-digit',
      day: compact ? undefined : '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(candle.timestamp)),
  )

  return {
    animation: false,
    backgroundColor: 'transparent',
    grid: compact
      ? { left: 2, right: 2, top: 8, bottom: 2 }
      : { left: 48, right: 16, top: 24, bottom: 48 },
    legend: compact
      ? undefined
      : {
          top: 0,
          textStyle: { color: '#cfe5df' },
        },
    tooltip: compact
      ? { show: false }
      : {
          trigger: 'axis',
        },
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: true,
      axisLine: { lineStyle: { color: '#2e4a46' } },
      axisLabel: { show: !compact, color: '#96bbb5' },
      axisTick: { show: false },
      splitLine: { show: false },
    },
    yAxis: {
      scale: true,
      axisLine: { show: false },
      axisLabel: { show: !compact, color: '#96bbb5' },
      axisTick: { show: false },
      splitLine: {
        lineStyle: {
          color: 'rgba(116, 155, 148, 0.15)',
        },
      },
    },
    visualMap: compact
      ? undefined
      : {
          show: false,
          seriesIndex: 0,
          dimension: 0,
          pieces: candles
            .map((candle, index) =>
              candle.isClosed
                ? null
                : {
                    gt: index - 1,
                    lte: index,
                    color: '#ffde59',
                  },
            )
            .filter(Boolean),
        },
    series: [
      {
        name: 'K线',
        type: 'candlestick',
        data: candles.map((candle) => [
          candle.open,
          candle.close,
          candle.low,
          candle.high,
        ]),
        itemStyle: {
          color: '#ff8a4a',
          color0: '#2ad4b5',
          borderColor: '#ff8a4a',
          borderColor0: '#2ad4b5',
        },
      },
      {
        name: 'MA5',
        type: 'line',
        data: candles.map((candle) => candle.fastMa),
        smooth: true,
        showSymbol: false,
        lineStyle: {
          color: '#f2d06b',
          width: compact ? 1.5 : 2,
        },
      },
      {
        name: 'MA20',
        type: 'line',
        data: candles.map((candle) => candle.slowMa),
        smooth: true,
        showSymbol: false,
        lineStyle: {
          color: '#66c3ff',
          width: compact ? 1.5 : 2,
        },
      },
    ],
  }
}

function CandlestickChartComponent({
  candles,
  compact = false,
}: CandlestickChartProps) {
  const option = useMemo(() => buildOption(candles, compact), [candles, compact])

  return (
    <ReactECharts
      option={option}
      style={{ height: compact ? 92 : 360, width: '100%' }}
      opts={{ renderer: 'canvas' }}
      lazyUpdate={compact}
    />
  )
}

export const CandlestickChart = memo(
  CandlestickChartComponent,
  (previousProps, nextProps) =>
    previousProps.compact === nextProps.compact &&
    previousProps.candles === nextProps.candles,
)
