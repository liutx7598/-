import type { TimeframeKey } from './timeframes'

export type PatternKey =
  | 'long_upper_shadow'
  | 'long_lower_shadow'
  | 'bullish_engulfing'
  | 'bearish_engulfing'
  | 'double_bottom'
  | 'rounded_bottom'
  | 'bull_flag_breakout'
  | 'lotus_breakout'
  | 'guillotine'
  | 'double_needle_bottom'
  | 'three_incense'

export interface PatternDefinition {
  key: PatternKey
  label: string
}

export const PATTERN_DEFINITIONS: PatternDefinition[] = [
  { key: 'long_upper_shadow', label: '\u957f\u4e0a\u5f71\u7ebf' },
  { key: 'long_lower_shadow', label: '\u957f\u4e0b\u5f71\u7ebf' },
  { key: 'bullish_engulfing', label: '\u9633\u7ebf\u53cd\u5305' },
  { key: 'bearish_engulfing', label: '\u9634\u7ebf\u53cd\u5305' },
  { key: 'double_bottom', label: 'W\u5e95' },
  { key: 'rounded_bottom', label: '\u5706\u5f27\u5e95' },
  { key: 'bull_flag_breakout', label: '\u65d7\u5f62\u7a81\u7834' },
  { key: 'lotus_breakout', label: '\u51fa\u6c34\u8299\u84c9' },
  { key: 'guillotine', label: '\u65ad\u5934\u94e1' },
  { key: 'double_needle_bottom', label: '\u53cc\u9488\u63a2\u5e95' },
  { key: 'three_incense', label: '\u4e09\u70b7\u9999' },
]

export type IndicatorKey =
  | 'ma'
  | 'macd'
  | 'boll'
  | 'kdj'
  | 'rsi'
  | 'bias'
  | 'volume'

export type AiRecommendationLabel = '\u504f\u591a' | '\u504f\u7a7a' | '\u89c2\u671b'

export type ConditionKind =
  | 'ma_convergence'
  | 'ma_trend'
  | 'ma_slope'
  | 'price_cross_ma'
  | 'ma_cross_ma'
  | 'price_above_ma'
  | 'price_below_ma'
  | 'ma_spread'
  | 'ma_adhesion'
  | 'ma_conflict'
  | 'macd_cross'
  | 'macd_above_zero'
  | 'macd_threshold'
  | 'boll_position'
  | 'boll_bandwidth'
  | 'kdj_cross'
  | 'kdj_threshold'
  | 'rsi_threshold'
  | 'bias_threshold'
  | 'volume_spike'
  | 'pattern_match'

export type ThresholdDirection = 'gt' | 'gte' | 'lt' | 'lte'
export type CrossDirection = 'up' | 'down'

export interface ConditionDefinition {
  id: string
  label: string
  kind: ConditionKind
  enabled: boolean
  params: Record<string, string | number | boolean | string[] | number[] | null>
}

export interface StrategyPreset {
  id: string
  name: string
  description: string
  favorite: boolean
  autoRun: boolean
  scheduleIntervalMinutes: number | null
  selectedTimeframes: TimeframeKey[]
  conditions: ConditionDefinition[]
  createdAt: string
  updatedAt: string
}

export interface WatchlistItem {
  instId: string
  note: string
  createdAt: string
}

export interface PriceChangeAlertRule {
  id: string
  label: string
  window: '1m' | '5m' | '1h' | '4h' | 'today'
  direction: ThresholdDirection
  thresholdPct: number
  enabled: boolean
  cooldownMinutes: number
}

export interface MarketCapSnapshot {
  marketCap: number | null
  marketCapRank: number | null
  circulatingSupply: number | null
  source: string | null
  degraded: boolean
  updatedAt: string | null
}

export interface IndicatorSnapshot {
  movingAverages: Record<string, number | null>
  intradayAverage: number | null
  macd: {
    dif: number | null
    dea: number | null
    histogram: number | null
  }
  boll: {
    upper: number | null
    middle: number | null
    lower: number | null
  }
  kdj: {
    k: number | null
    d: number | null
    j: number | null
  }
  rsi: {
    rsi6: number | null
    rsi14: number | null
    rsi24: number | null
  }
  bias: Record<string, number | null>
  volume: {
    current: number | null
    average5: number | null
    average20: number | null
  }
}

export interface PatternMatch {
  key: PatternKey
  label: string
  matched: boolean
  confidence: number
}
