import type { AiRecommendationLabel, IndicatorSnapshot, PatternMatch } from '../shared/platform-types'
import type { ScreenerResult } from '../shared/types'

export function buildAiRecommendation(
  result: ScreenerResult,
  indicators: IndicatorSnapshot,
  patterns: PatternMatch[],
): {
  label: AiRecommendationLabel
  reason: string
} {
  const positiveSignals = [
    result.maTrendDirection === 'up',
    result.trendFlags.priceCrossedFastMa,
    (indicators.macd.dif ?? -1) > (indicators.macd.dea ?? 0),
    (indicators.rsi.rsi14 ?? 0) >= 50,
    patterns.some((item) => item.key === 'double_bottom' && item.matched),
    patterns.some((item) => item.key === 'long_lower_shadow' && item.matched),
  ].filter(Boolean).length

  const negativeSignals = [
    result.maTrendDirection === 'down',
    (indicators.macd.dif ?? 1) < (indicators.macd.dea ?? 0),
    (indicators.rsi.rsi14 ?? 100) < 45,
    patterns.some((item) => item.key === 'long_upper_shadow' && item.matched),
    patterns.some((item) => item.key === 'bearish_engulfing' && item.matched),
  ].filter(Boolean).length

  if (positiveSignals - negativeSignals >= 2) {
    return {
      label: '偏多',
      reason: '均线结构、MACD 和 RSI 组合偏强，当前解释标签偏多。',
    }
  }

  if (negativeSignals - positiveSignals >= 2) {
    return {
      label: '偏空',
      reason: '价格结构与动量指标偏弱，当前解释标签偏空。',
    }
  }

  return {
    label: '观望',
    reason: '多空指标没有形成明显优势，当前更适合继续观察。',
  }
}
