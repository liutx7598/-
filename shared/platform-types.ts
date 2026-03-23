import type { TimeframeKey } from './timeframes'

export type IndicatorKey =
  | 'ma'
  | 'macd'
  | 'boll'
  | 'kdj'
  | 'rsi'
  | 'bias'
  | 'volume'

export type AiRecommendationLabel = '偏多' | '偏空' | '观望'

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
  | 'boll_position'
  | 'kdj_cross'
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
  key: string
  label: string
  matched: boolean
  confidence: number
}
