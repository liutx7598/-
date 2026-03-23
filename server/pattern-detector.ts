import type { PatternMatch } from '../shared/platform-types'
import type { RawCandle } from './gate'

function bodySize(candle: RawCandle) {
  return Math.abs(candle.close - candle.open)
}

function upperShadow(candle: RawCandle) {
  return candle.high - Math.max(candle.open, candle.close)
}

function lowerShadow(candle: RawCandle) {
  return Math.min(candle.open, candle.close) - candle.low
}

export function detectPatterns(candles: RawCandle[]): PatternMatch[] {
  if (candles.length < 3) {
    return []
  }

  const last = candles[candles.length - 1]
  const previous = candles[candles.length - 2]
  const third = candles[candles.length - 3]
  const lastBody = Math.max(bodySize(last), 0.0000001)
  const lastUpperShadow = upperShadow(last)
  const lastLowerShadow = lowerShadow(last)
  const bullishEngulfing =
    previous.close < previous.open &&
    last.close > last.open &&
    last.close >= previous.open &&
    last.open <= previous.close
  const bearishEngulfing =
    previous.close > previous.open &&
    last.close < last.open &&
    last.open >= previous.close &&
    last.close <= previous.open
  const doubleBottom =
    Math.abs(previous.low - third.low) / Math.max(previous.low, third.low) <= 0.015 &&
    last.close > previous.high

  return [
    {
      key: 'long_upper_shadow',
      label: '长上影线',
      matched: lastUpperShadow >= lastBody * 1.8,
      confidence: lastUpperShadow >= lastBody * 2.4 ? 0.82 : 0.62,
    },
    {
      key: 'long_lower_shadow',
      label: '长下影线',
      matched: lastLowerShadow >= lastBody * 1.8,
      confidence: lastLowerShadow >= lastBody * 2.4 ? 0.82 : 0.62,
    },
    {
      key: 'bullish_engulfing',
      label: '阳线反包',
      matched: bullishEngulfing,
      confidence: bullishEngulfing ? 0.78 : 0.1,
    },
    {
      key: 'bearish_engulfing',
      label: '阴线反包',
      matched: bearishEngulfing,
      confidence: bearishEngulfing ? 0.78 : 0.1,
    },
    {
      key: 'double_bottom',
      label: '双针探底',
      matched: doubleBottom,
      confidence: doubleBottom ? 0.72 : 0.1,
    },
  ]
}
