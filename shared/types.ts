import type { TimeframeKey } from './timeframes'
import type {
  AiRecommendationLabel,
  IndicatorSnapshot,
  MarketCapSnapshot,
  PatternMatch,
  PriceChangeAlertRule,
  StrategyPreset,
  WatchlistItem,
} from './platform-types'

export type MatchMode = 'A_B_C' | 'A_B' | 'B_C' | 'A_ONLY'
export type MaUpStrategy = 'stair_up' | 'strict_positive'
export type ConvergenceRelation = 'and' | 'or'
export type WebhookType = 'generic' | 'dingtalk' | 'wecom'
export type AlertStatus =
  | 'not_matched'
  | 'disabled'
  | 'ready'
  | 'sent'
  | 'cooldown'

export interface ScreenerConfig {
  selectedTimeframes: TimeframeKey[]
  fastMaPeriod: number
  slowMaPeriod: number
  convergenceThresholdPct: number
  secondaryConvergenceEnabled: boolean
  secondaryFastMaPeriod: number
  secondarySlowMaPeriod: number
  convergenceRelation: ConvergenceRelation
  crossSlopeEnabled: boolean
  crossSlopeThresholdPct: number
  maSlopeLookback: number
  maUpStrategy: MaUpStrategy
  matchMode: MatchMode
  fetchLimit: number
  chartCandles: number
  monitoringEnabled: boolean
  refreshIntervalMinutes: number
  notificationCooldownMinutes: number
  webhookEnabled: boolean
  webhookUrl: string
  webhookType: WebhookType
}

export interface ChartCandle {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  isClosed: boolean
  fastMa: number | null
  slowMa: number | null
}

export interface ScreenerResult {
  signalKey: string
  signature: string
  instId: string
  instFamily: string
  instrumentName: string
  baseCcy: string
  quoteCcy: string
  contractType: 'SWAP'
  timeframe: TimeframeKey
  timeframeLabel: string
  synthetic: boolean
  lastPrice: number
  fastMa: number
  slowMa: number
  distanceRatio: number
  convergencePct: number
  secondaryFastMa: number | null
  secondarySlowMa: number | null
  secondaryDistanceRatio: number | null
  secondaryConvergencePct: number | null
  priceVsFastMaPct: number
  fastMaSlopePct: number
  crossSlopePct: number
  maTrendDirection: 'up' | 'flat' | 'down'
  crossedAt: string
  lastClosedTs: number
  analysisSource: 'rules'
  llmSummary: string | null
  isMatch: boolean
  alertStatus: AlertStatus
  marketCap?: MarketCapSnapshot | null
  priceChanges?: Partial<Record<'1m' | '5m' | '1h' | '4h' | 'today', number | null>>
  aiRecommendationLabel?: AiRecommendationLabel | null
  aiRecommendationReason?: string | null
  indicators?: IndicatorSnapshot
  patternMatches?: PatternMatch[]
  watchlisted?: boolean
  trendFlags: {
    primaryConverging: boolean
    secondaryConverging: boolean | null
    converging: boolean
    fastMaRising: boolean
    rawPriceCrossedFastMa: boolean
    crossSlopeQualified: boolean
    priceCrossedFastMa: boolean
  }
  chart: ChartCandle[]
}

export interface ScreenerStats {
  scannedInstruments: number
  analyzedRows: number
  matchedRows: number
  rawBarsFetched: number
  failures: number
  durationMs: number
}

export type RunReason = 'startup' | 'manual' | 'scheduled'

export interface MonitorStatus {
  isRunning: boolean
  lastRunReason: RunReason | null
  lastRunStartedAt: string | null
  lastCompletedAt: string | null
  lastSuccessfulAt: string | null
  nextScheduledRunAt: string | null
  lastError: string | null
  lastAlertedAt: string | null
  lastAlertCount: number
}

export interface AlertRecord {
  signalKey: string
  instId: string
  timeframe: TimeframeKey
  timeframeLabel: string
  alertStatus: Exclude<AlertStatus, 'not_matched' | 'ready'>
  webhookType: WebhookType
  message: string
  sentAt: string
}

export type AiOverviewStatus = 'disabled' | 'pending' | 'ready' | 'error'
export type AiOverviewSource = 'llm' | 'rules'

export interface AiOverviewTimeframeStat {
  timeframe: TimeframeKey
  label: string
  count: number
}

export interface AiOverviewSignalRef {
  instId: string
  timeframe: TimeframeKey
  timeframeLabel: string
}

export interface AiOverview {
  status: AiOverviewStatus
  source: AiOverviewSource
  summary: string | null
  generatedAt: string | null
  basedOnRunAt: string | null
  error: string | null
  totalMatches: number
  newMatches: number
  removedMatches: number
  leadingTimeframeLabel: string | null
  timeframeStats: AiOverviewTimeframeStat[]
  sampleSignals: AiOverviewSignalRef[]
}

export interface SnapshotPayload {
  config: ScreenerConfig
  results: ScreenerResult[]
  stats: ScreenerStats
  status: MonitorStatus
  llmAnalysisEnabled: boolean
  aiOverview: AiOverview | null
}

export interface ResultsQuery {
  page?: number
  pageSize?: number
  keyword?: string
  bars?: string
  onlyMatched?: boolean
  sortBy?:
    | 'instId'
    | 'timeframe'
    | 'lastPrice'
    | 'fastMa'
    | 'slowMa'
    | 'convergencePct'
    | 'fastMaSlopePct'
    | 'crossedAt'
  sortOrder?: 'asc' | 'desc'
}

export interface ResultsResponse {
  items: ScreenerResult[]
  total: number
  page: number
  pageSize: number
  lastRefreshedAt: string | null
  monitoringEnabled: boolean
}

export interface ChartResponse {
  item: ScreenerResult | null
  candles: ChartCandle[]
  latestSignal: string
}

export interface AlertsResponse {
  items: AlertRecord[]
}

export interface UpdateConfigPayload extends Partial<ScreenerConfig> {}

export interface StrategyPresetsResponse {
  items: StrategyPreset[]
}

export interface WatchlistResponse {
  items: WatchlistItem[]
}

export interface PriceAlertRulesResponse {
  items: PriceChangeAlertRule[]
}

export type LlmHistoryEntryType = 'overview' | 'signal'

export interface LlmHistoryItem {
  id: string
  type: LlmHistoryEntryType
  title: string
  generatedAt: string | null
  model: string | null
  summary: string
  markdown: string
  status: string | null
  source: string | null
  instId: string | null
  timeframe: string | null
  timeframeLabel: string | null
  signalKey: string | null
  totalMatches: number | null
  newMatches: number | null
  removedMatches: number | null
  leadingTimeframeLabel: string | null
}

export interface LlmHistoryResponse {
  items: LlmHistoryItem[]
  total: number
}
