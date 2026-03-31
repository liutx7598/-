import type {
  AiRecommendationLabel,
  IndicatorSnapshot,
  PatternKey,
  PatternMatch,
} from '../shared/platform-types'
import type { ScreenerResult } from '../shared/types'

export function buildAiRecommendation(
  result: ScreenerResult,
  indicators: IndicatorSnapshot,
  patterns: PatternMatch[],
): {
  label: AiRecommendationLabel
  reason: string
} {
  const hasPattern = (key: PatternKey) =>
    patterns.some((item) => item.key === key && item.matched)

  const positiveSignals = [
    result.maTrendDirection === 'up',
    result.trendFlags.priceCrossedFastMa,
    (indicators.macd.dif ?? -1) > (indicators.macd.dea ?? 0),
    (indicators.rsi.rsi14 ?? 0) >= 50,
    hasPattern('double_bottom'),
    hasPattern('double_needle_bottom'),
    hasPattern('rounded_bottom'),
    hasPattern('bull_flag_breakout'),
    hasPattern('lotus_breakout'),
    hasPattern('three_incense'),
    hasPattern('long_lower_shadow'),
  ].filter(Boolean).length

  const negativeSignals = [
    result.maTrendDirection === 'down',
    (indicators.macd.dif ?? 1) < (indicators.macd.dea ?? 0),
    (indicators.rsi.rsi14 ?? 100) < 45,
    hasPattern('long_upper_shadow'),
    hasPattern('bearish_engulfing'),
    hasPattern('guillotine'),
  ].filter(Boolean).length

  if (positiveSignals - negativeSignals >= 2) {
    return {
      label: '\u504f\u591a',
      reason:
        '\u5747\u7ebf\u7ed3\u6784\u3001MACD \u548c RSI \u7ec4\u5408\u504f\u5f3a\uff0c\u5f53\u524d\u89e3\u91ca\u6807\u7b7e\u504f\u591a\u3002',
    }
  }

  if (negativeSignals - positiveSignals >= 2) {
    return {
      label: '\u504f\u7a7a',
      reason:
        '\u4ef7\u683c\u7ed3\u6784\u4e0e\u52a8\u91cf\u6307\u6807\u504f\u5f31\uff0c\u5f53\u524d\u89e3\u91ca\u6807\u7b7e\u504f\u7a7a\u3002',
    }
  }

  return {
    label: '\u89c2\u671b',
    reason:
      '\u591a\u7a7a\u6307\u6807\u6ca1\u6709\u5f62\u6210\u660e\u663e\u4f18\u52bf\uff0c\u5f53\u524d\u66f4\u9002\u5408\u7ee7\u7eed\u89c2\u5bdf\u3002',
  }
}
