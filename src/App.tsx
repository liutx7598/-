import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Bell,
  BellRing,
  Bot,
  CandlestickChart as ChartIcon,
  LoaderCircle,
  RefreshCcw,
  Save,
  Send,
  Settings2,
  Star,
} from 'lucide-react'

import './App.css'

import {
  fetchChart,
  fetchResults,
  fetchSnapshot,
  fetchStrategyPresets,
  fetchWatchlist,
  saveSettings,
  saveStrategyPreset,
  testWebhook,
  toggleMonitor,
  toggleWatchlist as toggleWatchlistApi,
  triggerScan,
} from './api'
import { CandlestickChart } from './components/CandlestickChart'
import { LlmHistoryPanel } from './components/LlmHistoryPanel'
import {
  formatDateTime,
  formatDuration,
  formatPercent,
  formatPrice,
} from './lib/format'
import {
  buildPingMessage,
  buildRealtimeArgsKey,
  buildRealtimeSubscriptionArgs,
  buildSubscriptionMessage,
  GATE_PUBLIC_WS_URLS,
  mergeRealtimeCandleSeries,
  parseRealtimeMessage,
} from './lib/gateRealtime'
import {
  PATTERN_DEFINITIONS,
  type ConditionDefinition,
  type ConditionKind,
  type PatternKey,
  type PriceChangeAlertRule,
  type StrategyPreset,
  type ThresholdDirection,
  type WatchlistItem,
} from '../shared/platform-types'
import {
  TIMEFRAME_DEFINITIONS,
  type TimeframeKey,
} from '../shared/timeframes'
import type {
  AlertRecord,
  AlertStatus,
  ChartResponse,
  MatchMode,
  MaUpStrategy,
  ResultsResponse,
  ScreenerConfig,
  ScreenerResult,
  SnapshotPayload,
  StrategyRunState,
} from '../shared/types'

const PAGE_SIZE = 25

const MATCH_MODE_OPTIONS: Array<{ value: MatchMode; label: string }> = [
  { value: 'A_B_C', label: 'A and B and C' },
  { value: 'A_B', label: 'A and B' },
  { value: 'B_C', label: 'B and C' },
  { value: 'A_ONLY', label: 'A only' },
]

const MA_UP_STRATEGIES: Array<{ value: MaUpStrategy; label: string }> = [
  { value: 'stair_up', label: 'MA5[-1] > MA5[-2] 且 MA5[-2] >= MA5[-3]' },
  { value: 'strict_positive', label: '只要求当前斜率为正' },
]

const CONDITION_LIBRARY: Array<{ kind: ConditionKind; label: string }> = [
  { kind: 'ma_convergence', label: '均线收拢' },
  { kind: 'ma_trend', label: '均线方向' },
  { kind: 'ma_slope', label: '均线斜率' },
  { kind: 'price_cross_ma', label: 'K线实体穿均线' },
  { kind: 'ma_cross_ma', label: '均线穿均线' },
  { kind: 'price_above_ma', label: 'K线在均线之上' },
  { kind: 'price_below_ma', label: 'K线在均线之下' },
  { kind: 'ma_spread', label: '均线发散度' },
  { kind: 'ma_adhesion', label: '多均线粘合度' },
  { kind: 'ma_conflict', label: '均线相悖' },
  { kind: 'macd_cross', label: 'MACD 金叉/死叉' },
  { kind: 'macd_above_zero', label: 'MACD 零轴之上' },
  { kind: 'macd_threshold', label: 'MACD 数值区间' },
  { kind: 'boll_position', label: 'BOLL 位置' },
  { kind: 'boll_bandwidth', label: 'BOLL 带宽' },
  { kind: 'kdj_cross', label: 'KDJ 金叉/死叉' },
  { kind: 'kdj_threshold', label: 'KDJ 数值区间' },
  { kind: 'rsi_threshold', label: 'RSI 阈值' },
  { kind: 'bias_threshold', label: 'BIAS 阈值' },
  { kind: 'volume_spike', label: '成交量放大' },
]

const PRICE_WINDOWS: Array<{ value: PriceChangeAlertRule['window']; label: string }> = [
  { value: '1m', label: '1分钟' },
  { value: '5m', label: '5分钟' },
  { value: '1h', label: '1小时' },
  { value: '4h', label: '4小时' },
  { value: 'today', label: '今日' },
]

const THRESHOLD_DIRECTIONS: Array<{ value: ThresholdDirection; label: string }> = [
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于等于' },
]

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function cloneCondition(condition: ConditionDefinition): ConditionDefinition {
  return {
    ...condition,
    params: deepClone(condition.params),
  }
}

function cloneConfig(config: ScreenerConfig): ScreenerConfig {
  return {
    ...config,
    selectedTimeframes: Array.isArray(config.selectedTimeframes) ? [...config.selectedTimeframes] : [],
    extraConditions: Array.isArray(config.extraConditions)
      ? config.extraConditions.map(cloneCondition)
      : [],
    priceAlertRules: Array.isArray(config.priceAlertRules)
      ? config.priceAlertRules.map((rule) => ({ ...rule }))
      : [],
  }
}

function createStableId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function parseMovingAverageList(input: string) {
  return input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item.toLowerCase() === 'intraday' ? 'intraday' : String(Number(item))))
    .filter(
      (value): value is string =>
        value === 'intraday' || (Number.isFinite(Number(value)) && Number(value) > 0),
    )
}

function formatCompactNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '--'
  }

  if (Math.abs(value) >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`
  }

  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`
  }

  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`
  }

  return value.toFixed(2)
}

function formatPriceChange(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '--'
  }

  return formatPercent(value)
}

function formatWindowLabel(window: PriceChangeAlertRule['window']) {
  return PRICE_WINDOWS.find((item) => item.value === window)?.label ?? window
}

function formatDirectionLabel(direction: ThresholdDirection) {
  return THRESHOLD_DIRECTIONS.find((item) => item.value === direction)?.label ?? direction
}

function getPatternLabel(patternKey: PatternKey) {
  return PATTERN_DEFINITIONS.find((item) => item.key === patternKey)?.label ?? patternKey
}

const MOVING_AVERAGE_OPTIONS = [
  { value: 'intraday', label: '分时均线' },
  { value: '5', label: 'MA5' },
  { value: '10', label: 'MA10' },
  { value: '20', label: 'MA20' },
  { value: '30', label: 'MA30' },
  { value: '60', label: 'MA60' },
  { value: '120', label: 'MA120' },
]

function toMovingAverageOptionValue(value: unknown, fallback = '5') {
  if (value === 'intraday') {
    return 'intraday'
  }

  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return String(value)
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'intraday') {
      return 'intraday'
    }

    if (MOVING_AVERAGE_OPTIONS.some((option) => option.value === value.trim())) {
      return value.trim()
    }
  }

  return fallback
}

function parseMovingAverageOptionValue(value: string) {
  return value === 'intraday' ? 'intraday' : Number(value)
}

function getMovingAverageLabel(value: unknown) {
  const optionValue = toMovingAverageOptionValue(value)
  return MOVING_AVERAGE_OPTIONS.find((option) => option.value === optionValue)?.label ?? `MA${optionValue}`
}

function createCondition(kind: ConditionKind): ConditionDefinition {
  const id = createStableId(kind)

  switch (kind) {
    case 'ma_convergence':
      return {
        id,
        label: '均线收拢',
        kind,
        enabled: true,
        params: { fast: 5, slow: 20, thresholdPct: 0.8 },
      }
    case 'ma_trend':
      return {
        id,
        label: '均线方向',
        kind,
        enabled: true,
        params: { period: 5, direction: 'up' },
      }
    case 'ma_slope':
      return {
        id,
        label: '均线斜率',
        kind,
        enabled: true,
        params: {
          period: 5,
          mode: 'compare',
          direction: 'gt',
          thresholdPct: 0.03,
          min: -0.2,
          max: 0.2,
        },
      }
    case 'price_cross_ma':
      return {
        id,
        label: 'K线实体穿均线',
        kind,
        enabled: true,
        params: { period: 5, direction: 'up' },
      }
    case 'ma_cross_ma':
      return {
        id,
        label: '均线穿均线',
        kind,
        enabled: true,
        params: { fast: 5, slow: 20, direction: 'up' },
      }
    case 'price_above_ma':
      return {
        id,
        label: 'K线在均线之上',
        kind,
        enabled: true,
        params: { period: 20 },
      }
    case 'price_below_ma':
      return {
        id,
        label: 'K线在均线之下',
        kind,
        enabled: true,
        params: { period: 20 },
      }
    case 'ma_spread':
    case 'ma_adhesion':
      return {
        id,
        label: kind === 'ma_spread' ? '均线发散度' : '多均线粘合度',
        kind,
        enabled: true,
        params: { periods: [5, 10, 20], thresholdPct: kind === 'ma_spread' ? 1 : 0.6 },
      }
    case 'ma_conflict':
      return {
        id,
        label: '均线相悖',
        kind,
        enabled: true,
        params: { referencePeriod: 5, comparePeriod: 20 },
      }
    case 'macd_cross':
      return {
        id,
        label: 'MACD 金叉/死叉',
        kind,
        enabled: true,
        params: { direction: 'up' },
      }
    case 'macd_above_zero':
      return {
        id,
        label: 'MACD 零轴之上',
        kind,
        enabled: true,
        params: {},
      }
    case 'macd_threshold':
      return {
        id,
        label: 'MACD 数值区间',
        kind,
        enabled: true,
        params: {
          line: 'histogram',
          mode: 'compare',
          direction: 'gte',
          threshold: 0,
          min: -0.2,
          max: 0.2,
        },
      }
    case 'boll_position':
      return {
        id,
        label: 'BOLL 位置',
        kind,
        enabled: true,
        params: { position: 'middle_or_above' },
      }
    case 'boll_bandwidth':
      return {
        id,
        label: 'BOLL 带宽',
        kind,
        enabled: true,
        params: {
          mode: 'compare',
          direction: 'gte',
          thresholdPct: 2,
          min: 1,
          max: 8,
        },
      }
    case 'kdj_cross':
      return {
        id,
        label: 'KDJ 金叉/死叉',
        kind,
        enabled: true,
        params: { direction: 'up' },
      }
    case 'kdj_threshold':
      return {
        id,
        label: 'KDJ 数值区间',
        kind,
        enabled: true,
        params: {
          line: 'k',
          mode: 'compare',
          direction: 'gte',
          threshold: 50,
          min: 20,
          max: 80,
        },
      }
    case 'rsi_threshold':
      return {
        id,
        label: 'RSI 阈值',
        kind,
        enabled: true,
        params: { period: 14, mode: 'compare', direction: 'gte', threshold: 50, min: 40, max: 60 },
      }
    case 'bias_threshold':
      return {
        id,
        label: 'BIAS 阈值',
        kind,
        enabled: true,
        params: { period: 5, mode: 'compare', direction: 'gte', threshold: 0, min: -2, max: 2 },
      }
    case 'volume_spike':
      return {
        id,
        label: '成交量放大',
        kind,
        enabled: true,
        params: {
          reference: 'average5',
          mode: 'compare',
          direction: 'gte',
          multiplier: 1.5,
          minMultiplier: 1.2,
          maxMultiplier: 2.5,
        },
      }
    case 'pattern_match':
      return {
        id,
        label: '形态匹配',
        kind,
        enabled: true,
        params: { patternKey: PATTERN_DEFINITIONS[0]?.key ?? 'long_upper_shadow' },
      }
    default:
      return {
        id,
        label: '附加条件',
        kind,
        enabled: true,
        params: {},
      }
  }
}

function describeCondition(condition: ConditionDefinition) {
  if (condition.kind === 'pattern_match') {
    return getPatternLabel(String(condition.params.patternKey ?? '') as PatternKey)
  }

  if (condition.kind === 'ma_convergence') {
    return `${getMovingAverageLabel(condition.params.fast)}/${getMovingAverageLabel(condition.params.slow)} 收拢 <= ${condition.params.thresholdPct}%`
  }

  if (condition.kind === 'ma_slope') {
    if (String(condition.params.mode ?? 'compare') === 'range') {
      return `${getMovingAverageLabel(condition.params.period ?? 5)} 斜率区间 ${condition.params.min}% ~ ${condition.params.max}%`
    }
    return `${getMovingAverageLabel(condition.params.period ?? 5)} 斜率 ${formatDirectionLabel(String(condition.params.direction ?? 'gte') as ThresholdDirection)} ${condition.params.thresholdPct}%`
  }

  if (condition.kind === 'ma_trend') {
    return `${getMovingAverageLabel(condition.params.period ?? 5)} ${String(condition.params.direction ?? 'up') === 'down' ? '向下' : '向上'}`
  }

  if (condition.kind === 'price_cross_ma') {
    return `K线实体${String(condition.params.direction ?? 'up') === 'down' ? '下穿' : '上穿'} ${getMovingAverageLabel(condition.params.period ?? 5)}`
  }

  if (condition.kind === 'ma_conflict') {
    return `${getMovingAverageLabel(condition.params.referencePeriod ?? 5)} 与 ${getMovingAverageLabel(condition.params.comparePeriod ?? 20)} 方向相悖`
  }

  if (condition.kind === 'rsi_threshold') {
    if (String(condition.params.mode ?? 'compare') === 'range') {
      return `RSI${condition.params.period} 区间 ${condition.params.min} ~ ${condition.params.max}`
    }
    return `RSI${condition.params.period} ${formatDirectionLabel(String(condition.params.direction ?? 'gte') as ThresholdDirection)} ${condition.params.threshold}`
  }

  if (condition.kind === 'macd_threshold') {
    if (String(condition.params.mode ?? 'compare') === 'range') {
      return `MACD ${String(condition.params.line ?? 'histogram')} 区间 ${condition.params.min} ~ ${condition.params.max}`
    }
    return `MACD ${String(condition.params.line ?? 'histogram')} ${formatDirectionLabel(String(condition.params.direction ?? 'gte') as ThresholdDirection)} ${condition.params.threshold}`
  }

  if (condition.kind === 'boll_bandwidth') {
    if (String(condition.params.mode ?? 'compare') === 'range') {
      return `BOLL 带宽区间 ${condition.params.min}% ~ ${condition.params.max}%`
    }
    return `BOLL 带宽 ${formatDirectionLabel(String(condition.params.direction ?? 'gte') as ThresholdDirection)} ${condition.params.thresholdPct}%`
  }

  if (condition.kind === 'kdj_threshold') {
    if (String(condition.params.mode ?? 'compare') === 'range') {
      return `KDJ ${String(condition.params.line ?? 'k')} 区间 ${condition.params.min} ~ ${condition.params.max}`
    }
    return `KDJ ${String(condition.params.line ?? 'k')} ${formatDirectionLabel(String(condition.params.direction ?? 'gte') as ThresholdDirection)} ${condition.params.threshold}`
  }

  if (condition.kind === 'bias_threshold') {
    if (String(condition.params.mode ?? 'compare') === 'range') {
      return `BIAS${condition.params.period} 区间 ${condition.params.min} ~ ${condition.params.max}`
    }
    return `BIAS${condition.params.period} ${formatDirectionLabel(String(condition.params.direction ?? 'gte') as ThresholdDirection)} ${condition.params.threshold}`
  }

  if (condition.kind === 'volume_spike') {
    if (String(condition.params.mode ?? 'compare') === 'range') {
      return `成交量倍数区间 ${condition.params.minMultiplier} ~ ${condition.params.maxMultiplier}`
    }
    return `成交量倍数 ${formatDirectionLabel(String(condition.params.direction ?? 'gte') as ThresholdDirection)} ${condition.params.multiplier}`
  }

  return condition.label
}

function describePriceAlertRule(rule: PriceChangeAlertRule) {
  const name = rule.label.trim() || `${formatWindowLabel(rule.window)} 涨跌幅提醒`
  return `${name} · ${formatWindowLabel(rule.window)} ${formatDirectionLabel(rule.direction)} ${rule.thresholdPct}%`
}

function buildNotificationTitle(record: AlertRecord) {
  return record.category === 'price_change'
    ? `价格提醒 · ${record.instId}`
    : `新信号 · ${record.instId}`
}

function buildNotificationBody(record: AlertRecord) {
  if (record.category === 'price_change') {
    return `${record.priceWindowLabel ?? record.timeframeLabel} ${record.priceChangePct ?? 0}%`
  }

  return `${record.timeframeLabel} ${record.strategyPresetName ? `· ${record.strategyPresetName}` : ''}`.trim()
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  )
}

function AlertBadge({ status }: { status: AlertStatus }) {
  const labelMap: Record<AlertStatus, string> = {
    not_matched: '未命中',
    disabled: '未启用',
    ready: '待提醒',
    sent: '已提醒',
    cooldown: '冷却中',
  }

  return (
    <span className={`alert-badge alert-${status.replace('_', '-')}`}>
      {labelMap[status]}
    </span>
  )
}

function StrategyRunCard({ item }: { item: StrategyRunState }) {
  return (
    <div className="strategy-run-card">
      <strong>{item.strategyPresetName}</strong>
      <small>最近成功 {item.lastSuccessfulAt ? formatDateTime(item.lastSuccessfulAt) : '--'}</small>
      <small>下次执行 {item.nextScheduledRunAt ? formatDateTime(item.nextScheduledRunAt) : '--'}</small>
      <small>最近命中 {item.lastMatchCount}</small>
      {item.lastError ? <small className="negative">{item.lastError}</small> : null}
    </div>
  )
}

function App() {
  const [activeView, setActiveView] = useState<'screener' | 'llm-history'>('screener')
  const [snapshot, setSnapshot] = useState<SnapshotPayload | null>(null)
  const [resultsResponse, setResultsResponse] = useState<ResultsResponse | null>(null)
  const [draftConfig, setDraftConfig] = useState<ScreenerConfig | null>(null)
  const [searchText, setSearchText] = useState('')
  const [onlyMatched, setOnlyMatched] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedResult, setSelectedResult] = useState<ScreenerResult | null>(null)
  const [selectedChart, setSelectedChart] = useState<ChartResponse | null>(null)
  const [isChartLoading, setIsChartLoading] = useState(false)
  const [chartError, setChartError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [connectionState, setConnectionState] = useState<'ok' | 'degraded'>('ok')
  const [liveConnectionState, setLiveConnectionState] = useState<'idle' | 'connecting' | 'open' | 'reconnecting'>('idle')
  const [isBusy, setIsBusy] = useState(false)
  const [isTestingWebhook, setIsTestingWebhook] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState(
    typeof Notification === 'undefined' ? 'denied' : Notification.permission,
  )
  const [strategyPresets, setStrategyPresets] = useState<StrategyPreset[]>([])
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([])
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null)
  const [strategyName, setStrategyName] = useState('')
  const [strategyDescription, setStrategyDescription] = useState('')
  const [strategyFavorite, setStrategyFavorite] = useState(false)
  const [strategyAutoRun, setStrategyAutoRun] = useState(false)
  const [strategyScheduleMinutes, setStrategyScheduleMinutes] = useState(15)
  const [selectedConditionKind, setSelectedConditionKind] = useState<ConditionKind>('ma_convergence')
  const [priceAlertDraft, setPriceAlertDraft] = useState<{
    window: PriceChangeAlertRule['window']
    direction: ThresholdDirection
    thresholdPct: number
    cooldownMinutes: number
    label: string
  }>({
    window: '1h',
    direction: 'gt',
    thresholdPct: 3,
    cooldownMinutes: 30,
    label: '',
  })

  const snapshotRequestRef = useRef<AbortController | null>(null)
  const resultsRequestRef = useRef<AbortController | null>(null)
  const chartRequestRef = useRef<AbortController | null>(null)
  const seededAlertsRef = useRef(false)
  const seenAlertIdsRef = useRef(new Set<string>())
  const audioContextRef = useRef<AudioContext | null>(null)
  const strategyHydratedRef = useRef(false)

  const deferredSearchText = useDeferredValue(searchText.trim())
  const selectedBarsKey = draftConfig?.selectedTimeframes.join(',') ?? ''
  const selectedPatterns = useMemo(
    () =>
      (draftConfig?.extraConditions ?? [])
        .filter((condition) => condition.kind === 'pattern_match' && condition.enabled)
        .map((condition) => String(condition.params.patternKey ?? ''))
        .filter(Boolean) as PatternKey[],
    [draftConfig?.extraConditions],
  )
  const selectedPatternsKey = selectedPatterns.join(',')
  const editableConditions = useMemo(
    () => (draftConfig?.extraConditions ?? []).filter((condition) => condition.kind !== 'pattern_match'),
    [draftConfig?.extraConditions],
  )
  const liveFastMaPeriod = snapshot?.config.fastMaPeriod ?? draftConfig?.fastMaPeriod ?? 5
  const liveSlowMaPeriod = snapshot?.config.slowMaPeriod ?? draftConfig?.slowMaPeriod ?? 20
  const liveChartCandles = snapshot?.config.chartCandles ?? draftConfig?.chartCandles ?? 80
  const snapshotVersion = snapshot
    ? `${snapshot.status.lastSuccessfulAt ?? 'none'}:${snapshot.results.length}`
    : 'empty'
  const recentAlertVersion = (snapshot?.recentAlerts ?? []).map((item) => item.id).join('|')
  const realtimeSubscriptionKey = useMemo(() => {
    const instrumentIds = [...new Set((resultsResponse?.items ?? []).map((item) => item.instId))]
      .sort()
      .join('|')
    const selectedKey = selectedResult ? `${selectedResult.instId}:${selectedResult.timeframe}` : 'none'
    return `${instrumentIds}::${selectedKey}`
  }, [resultsResponse?.items, selectedResult?.instId, selectedResult?.timeframe])
  const realtimeArgs = useMemo(
    () => buildRealtimeSubscriptionArgs(resultsResponse?.items ?? [], selectedResult),
    [realtimeSubscriptionKey],
  )
  const realtimeArgsKey = useMemo(() => buildRealtimeArgsKey(realtimeArgs), [realtimeArgs])

  function isAbortError(error: unknown) {
    return (
      (typeof DOMException !== 'undefined' &&
        error instanceof DOMException &&
        error.name === 'AbortError') ||
      (error instanceof Error && error.name === 'AbortError')
    )
  }

  function updateDraftConfig(updater: (current: ScreenerConfig) => ScreenerConfig) {
    setDraftConfig((current) => (current ? updater(current) : current))
  }

  function playAlertSound() {
    if (!snapshot?.config.soundAlertsEnabled || typeof window === 'undefined') {
      return
    }

    const AudioContextCtor = window.AudioContext
    if (!AudioContextCtor) {
      return
    }

    const audioContext = audioContextRef.current ?? new AudioContextCtor()
    audioContextRef.current = audioContext

    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = 880
    gainNode.gain.value = 0.06
    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)
    oscillator.start()
    oscillator.stop(audioContext.currentTime + 0.18)
  }

  function hydrateStrategyEditor(preset: StrategyPreset | null) {
    setSelectedStrategyId(preset?.id ?? null)
    setStrategyName(preset?.name ?? '')
    setStrategyDescription(preset?.description ?? '')
    setStrategyFavorite(Boolean(preset?.favorite))
    setStrategyAutoRun(Boolean(preset?.autoRun))
    setStrategyScheduleMinutes(preset?.scheduleIntervalMinutes ?? 15)
  }

  function toggleTimeframe(timeframe: TimeframeKey) {
    if (!draftConfig) {
      return
    }

    const hasTimeframe = draftConfig.selectedTimeframes.includes(timeframe)
    const nextTimeframes = hasTimeframe
      ? draftConfig.selectedTimeframes.filter((item) => item !== timeframe)
      : [...draftConfig.selectedTimeframes, timeframe].sort(
          (left, right) =>
            TIMEFRAME_DEFINITIONS.findIndex((item) => item.key === left) -
            TIMEFRAME_DEFINITIONS.findIndex((item) => item.key === right),
        )

    if (nextTimeframes.length === 0) {
      setMessage('至少保留一个筛选周期。')
      return
    }

    updateDraftConfig((current) => ({
      ...current,
      selectedTimeframes: nextTimeframes,
    }))
    setCurrentPage(1)
  }

  function updateCondition(conditionId: string, updater: (condition: ConditionDefinition) => ConditionDefinition) {
    updateDraftConfig((current) => ({
      ...current,
      extraConditions: current.extraConditions.map((condition) =>
        condition.id === conditionId ? updater(condition) : condition,
      ),
    }))
  }

  function removeCondition(conditionId: string) {
    updateDraftConfig((current) => ({
      ...current,
      extraConditions: current.extraConditions.filter((condition) => condition.id !== conditionId),
    }))
  }

  function togglePattern(patternKey: PatternKey) {
    if (!draftConfig) {
      return
    }

    const existing = draftConfig.extraConditions.find(
      (condition) =>
        condition.kind === 'pattern_match' && String(condition.params.patternKey ?? '') === patternKey,
    )

    if (existing) {
      removeCondition(existing.id)
      return
    }

    updateDraftConfig((current) => ({
      ...current,
      extraConditions: [
        ...current.extraConditions,
        {
          id: createStableId(`pattern-${patternKey}`),
          label: `形态：${getPatternLabel(patternKey)}`,
          kind: 'pattern_match',
          enabled: true,
          params: { patternKey },
        },
      ],
    }))
    setCurrentPage(1)
  }

  function addCondition() {
    updateDraftConfig((current) => ({
      ...current,
      extraConditions: [...current.extraConditions, createCondition(selectedConditionKind)],
    }))
  }

  function addPriceAlertRule() {
    updateDraftConfig((current) => ({
      ...current,
      priceAlertRules: [
        ...current.priceAlertRules,
        {
          id: createStableId('price-alert'),
          label: priceAlertDraft.label.trim(),
          window: priceAlertDraft.window,
          direction: priceAlertDraft.direction,
          thresholdPct: Number(priceAlertDraft.thresholdPct),
          enabled: true,
          cooldownMinutes: Number(priceAlertDraft.cooldownMinutes),
        },
      ],
    }))
  }

  function removePriceAlertRule(ruleId: string) {
    updateDraftConfig((current) => ({
      ...current,
      priceAlertRules: current.priceAlertRules.filter((rule) => rule.id !== ruleId),
    }))
  }

  const loadSnapshot = useEffectEvent(async (silent = false) => {
    const controller = new AbortController()
    snapshotRequestRef.current?.abort()
    snapshotRequestRef.current = controller

    try {
      if (!silent) {
        setIsBusy(true)
      }

      const nextSnapshot = await fetchSnapshot({ signal: controller.signal })
      if (controller.signal.aborted) {
        return
      }

      startTransition(() => {
        setSnapshot(nextSnapshot)
        setDraftConfig((current) => current ?? cloneConfig(nextSnapshot.config))
        setConnectionState('ok')
      })
    } catch (error) {
      if (!isAbortError(error)) {
        if (!silent) {
          setMessage(error instanceof Error ? error.message : '加载快照失败')
        }
        setConnectionState('degraded')
      }
    } finally {
      if (!silent) {
        setIsBusy(false)
      }
      if (snapshotRequestRef.current === controller) {
        snapshotRequestRef.current = null
      }
    }
  })

  const loadResults = useEffectEvent(async (silent = false) => {
    if (!draftConfig) {
      return
    }

    const controller = new AbortController()
    resultsRequestRef.current?.abort()
    resultsRequestRef.current = controller

    try {
      const nextResults = await fetchResults(
        {
          page: currentPage,
          pageSize: PAGE_SIZE,
          keyword: deferredSearchText,
          bars: draftConfig.selectedTimeframes.join(','),
          patterns: selectedPatterns.join(','),
          onlyMatched,
          sortBy: 'timeframe',
          sortOrder: 'asc',
        },
        { signal: controller.signal },
      )

      if (controller.signal.aborted) {
        return
      }

      startTransition(() => {
        setResultsResponse(nextResults)
        setConnectionState('ok')
      })
    } catch (error) {
      if (!isAbortError(error)) {
        if (!silent) {
          setMessage(error instanceof Error ? error.message : '加载结果失败')
        }
        setConnectionState('degraded')
      }
    } finally {
      if (resultsRequestRef.current === controller) {
        resultsRequestRef.current = null
      }
    }
  })

  const loadStrategyPresets = useEffectEvent(async () => {
    try {
      const response = await fetchStrategyPresets()
      setStrategyPresets(Array.isArray(response.items) ? response.items : [])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载策略列表失败')
    }
  })

  const loadWatchlist = useEffectEvent(async () => {
    try {
      const response = await fetchWatchlist()
      setWatchlistItems(Array.isArray(response.items) ? response.items : [])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载自选列表失败')
    }
  })

  const openChartForResult = useEffectEvent(async (result: ScreenerResult) => {
    const controller = new AbortController()
    chartRequestRef.current?.abort()
    chartRequestRef.current = controller
    setSelectedResult(result)
    setChartError(null)
    setIsChartLoading(true)

    try {
      const nextChart = await fetchChart(result.instId, result.timeframe, liveChartCandles, {
        signal: controller.signal,
      })

      if (controller.signal.aborted) {
        return
      }

      setSelectedChart(nextChart)
    } catch (error) {
      if (!isAbortError(error)) {
        setChartError(error instanceof Error ? error.message : '加载图表失败')
      }
    } finally {
      if (chartRequestRef.current === controller) {
        chartRequestRef.current = null
      }
      setIsChartLoading(false)
    }
  })

  async function persistDraft(nextConfig: ScreenerConfig, successMessage: string) {
    setIsBusy(true)
    setMessage(null)

    try {
      await saveSettings(nextConfig)
      const nextSnapshot = await triggerScan()
      startTransition(() => {
        setSnapshot(nextSnapshot)
        setDraftConfig(cloneConfig(nextConfig))
      })
      await Promise.all([loadResults(true), loadStrategyPresets(), loadWatchlist()])
      setMessage(successMessage)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存设置失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleSaveSettings() {
    if (!draftConfig) {
      return
    }

    await persistDraft(draftConfig, '设置已保存，并重新执行了一轮扫描。')
  }

  async function handleSaveStrategy() {
    if (!draftConfig || !strategyName.trim()) {
      setMessage('请先填写策略名称。')
      return
    }

    setIsBusy(true)
    try {
      const savedPreset = (await saveStrategyPreset({
        id: selectedStrategyId ?? undefined,
        name: strategyName.trim(),
        description: strategyDescription.trim(),
        favorite: strategyFavorite,
        autoRun: strategyAutoRun,
        scheduleIntervalMinutes: strategyAutoRun ? strategyScheduleMinutes : null,
        selectedTimeframes: draftConfig.selectedTimeframes,
        conditions: draftConfig.extraConditions.map(cloneCondition),
      })) as StrategyPreset
      hydrateStrategyEditor(savedPreset)
      await loadStrategyPresets()
      setMessage(`策略“${savedPreset.name}”已保存。`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存策略失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleApplyStrategy() {
    if (!draftConfig || !strategyName.trim()) {
      setMessage('请先填写策略名称。')
      return
    }

    setIsBusy(true)
    try {
      const savedPreset = (await saveStrategyPreset({
        id: selectedStrategyId ?? undefined,
        name: strategyName.trim(),
        description: strategyDescription.trim(),
        favorite: strategyFavorite,
        autoRun: strategyAutoRun,
        scheduleIntervalMinutes: strategyAutoRun ? strategyScheduleMinutes : null,
        selectedTimeframes: draftConfig.selectedTimeframes,
        conditions: draftConfig.extraConditions.map(cloneCondition),
      })) as StrategyPreset

      hydrateStrategyEditor(savedPreset)

      await persistDraft(
        {
          ...draftConfig,
          activeStrategyPresetId: savedPreset.id,
        },
        `策略“${savedPreset.name}”已应用并重新扫描。`,
      )
    } finally {
      setIsBusy(false)
    }
  }

  async function handleManualScan() {
    setIsBusy(true)
    setMessage(null)
    try {
      const nextSnapshot = await triggerScan()
      startTransition(() => setSnapshot(nextSnapshot))
      await Promise.all([loadResults(true), loadStrategyPresets(), loadWatchlist()])
      setMessage('已触发一次全量扫描。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '手动扫描失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleToggleWatchlist(result: ScreenerResult) {
    try {
      const response = await toggleWatchlistApi(result.instId)
      setWatchlistItems(Array.isArray(response.items) ? response.items : [])
      setResultsResponse((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.instId === result.instId ? { ...item, watchlisted: response.added } : item,
              ),
            }
          : current,
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '更新自选失败')
    }
  }

  async function handleTestWebhook() {
    setIsTestingWebhook(true)
    try {
      await testWebhook()
      setMessage('测试提醒已经发出，请检查目标通道。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '测试提醒失败')
    } finally {
      setIsTestingWebhook(false)
    }
  }

  async function handleRequestNotifications() {
    if (typeof Notification === 'undefined') {
      setMessage('当前浏览器不支持通知权限。')
      return
    }

    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
  }

  function renderConditionFields(condition: ConditionDefinition) {
    const param = (key: string) => condition.params[key]

    const numberField = (label: string, key: string) => (
      <label className="field" htmlFor={`${condition.id}-${key}`}>
        <span>{label}</span>
        <input
          id={`${condition.id}-${key}`}
          name={`${condition.id}_${key}`}
          type="number"
          value={String(param(key) ?? '')}
          onChange={(event) =>
            updateCondition(condition.id, (current) => ({
              ...current,
              params: { ...current.params, [key]: Number(event.target.value) },
            }))
          }
        />
      </label>
    )

    const selectField = (label: string, key: string, options: Array<{ value: string; label: string }>) => (
      <label className="field" htmlFor={`${condition.id}-${key}`}>
        <span>{label}</span>
        <select
          id={`${condition.id}-${key}`}
          name={`${condition.id}_${key}`}
          value={String(param(key) ?? options[0]?.value ?? '')}
          onChange={(event) =>
            updateCondition(condition.id, (current) => ({
              ...current,
              params: { ...current.params, [key]: event.target.value },
            }))
          }
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    )

    const movingAverageField = (label: string, key: string, fallback = '5') => (
      <label className="field" htmlFor={`${condition.id}-${key}`}>
        <span>{label}</span>
        <select
          id={`${condition.id}-${key}`}
          name={`${condition.id}_${key}`}
          value={toMovingAverageOptionValue(param(key), fallback)}
          onChange={(event) =>
            updateCondition(condition.id, (current) => ({
              ...current,
              params: { ...current.params, [key]: parseMovingAverageOptionValue(event.target.value) },
            }))
          }
        >
          {MOVING_AVERAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    )

    if (condition.kind === 'ma_convergence' || condition.kind === 'ma_cross_ma') {
      return (
        <div className="field-row">
          {movingAverageField('快线均线', 'fast')}
          {movingAverageField('慢线均线', 'slow', '20')}
          {condition.kind === 'ma_convergence'
            ? numberField('阈值 %', 'thresholdPct')
            : selectField('方向', 'direction', [
                { value: 'up', label: '上穿' },
                { value: 'down', label: '下穿' },
              ])}
        </div>
      )
    }

    if (condition.kind === 'ma_trend' || condition.kind === 'price_cross_ma') {
      return (
        <div className="field-row">
          {movingAverageField('均线级别', 'period')}
          {selectField('方向', 'direction', [
            { value: 'up', label: '向上 / 上穿' },
            { value: 'down', label: '向下 / 下穿' },
          ])}
        </div>
      )
    }

    if (condition.kind === 'macd_cross' || condition.kind === 'kdj_cross') {
      return (
        <div className="field-row">
          {selectField('方向', 'direction', [
            { value: 'up', label: '向上 / 金叉 / 上穿' },
            { value: 'down', label: '向下 / 死叉 / 下穿' },
          ])}
        </div>
      )
    }

    if (condition.kind === 'ma_slope') {
      const isRangeMode = String(param('mode') ?? 'compare') === 'range'
      return (
        <div className="field-row">
          {movingAverageField('均线级别', 'period')}
          {selectField('模式', 'mode', [
            { value: 'compare', label: '阈值比较' },
            { value: 'range', label: '区间范围' },
          ])}
          {isRangeMode ? (
            <>
              {numberField('最小值 %', 'min')}
              {numberField('最大值 %', 'max')}
            </>
          ) : (
            <>
              {selectField('比较方式', 'direction', THRESHOLD_DIRECTIONS)}
              {numberField('阈值 %', 'thresholdPct')}
            </>
          )}
        </div>
      )
    }

    if (condition.kind === 'price_above_ma' || condition.kind === 'price_below_ma') {
      return <div className="field-row">{movingAverageField('均线级别', 'period', '20')}</div>
    }

    if (condition.kind === 'ma_spread' || condition.kind === 'ma_adhesion') {
      return (
        <div className="field-row">
          <label className="field" htmlFor={`${condition.id}-periods`}>
            <span>均线组</span>
            <input
              id={`${condition.id}-periods`}
              name={`${condition.id}_periods`}
              type="text"
              value={
                Array.isArray(param('periods'))
                  ? (param('periods') as Array<number | string>).join(',')
                  : '5,10,20'
              }
              placeholder="例如：intraday,5,10"
              onChange={(event) =>
                updateCondition(condition.id, (current) => ({
                  ...current,
                  params: { ...current.params, periods: parseMovingAverageList(event.target.value) },
                }))
              }
            />
          </label>
          {numberField('阈值 %', 'thresholdPct')}
        </div>
      )
    }

    if (condition.kind === 'ma_conflict') {
      return (
        <div className="field-row">
          {movingAverageField('参考均线', 'referencePeriod')}
          {movingAverageField('对比均线', 'comparePeriod', '20')}
        </div>
      )
    }

    if (condition.kind === 'boll_position') {
      return (
        <div className="field-row">
          {selectField('BOLL 位置', 'position', [
            { value: 'middle_or_above', label: '中轨之上' },
            { value: 'upper_break', label: '突破上轨' },
            { value: 'lower_break', label: '跌破下轨' },
          ])}
        </div>
      )
    }

    if (condition.kind === 'boll_bandwidth') {
      const isRangeMode = String(param('mode') ?? 'compare') === 'range'
      return (
        <div className="field-row">
          {selectField('模式', 'mode', [
            { value: 'compare', label: '阈值比较' },
            { value: 'range', label: '区间范围' },
          ])}
          {isRangeMode ? (
            <>
              {numberField('最小值 %', 'min')}
              {numberField('最大值 %', 'max')}
            </>
          ) : (
            <>
              {selectField('比较方式', 'direction', THRESHOLD_DIRECTIONS)}
              {numberField('阈值 %', 'thresholdPct')}
            </>
          )}
        </div>
      )
    }

    if (condition.kind === 'rsi_threshold' || condition.kind === 'bias_threshold') {
      const isRangeMode = String(param('mode') ?? 'compare') === 'range'
      return (
        <div className="field-row">
          {numberField('周期', 'period')}
          {selectField('模式', 'mode', [
            { value: 'compare', label: '阈值比较' },
            { value: 'range', label: '区间范围' },
          ])}
          {isRangeMode ? (
            <>
              {numberField('最小值', 'min')}
              {numberField('最大值', 'max')}
            </>
          ) : (
            <>
              {selectField('比较方式', 'direction', THRESHOLD_DIRECTIONS)}
              {numberField('阈值', 'threshold')}
            </>
          )}
        </div>
      )
    }

    if (condition.kind === 'macd_threshold' || condition.kind === 'kdj_threshold') {
      const isRangeMode = String(param('mode') ?? 'compare') === 'range'
      return (
        <div className="field-row">
          {selectField(
            condition.kind === 'macd_threshold' ? 'MACD 线' : 'KDJ 线',
            'line',
            condition.kind === 'macd_threshold'
              ? [
                  { value: 'dif', label: 'DIF' },
                  { value: 'dea', label: 'DEA' },
                  { value: 'histogram', label: 'Histogram' },
                ]
              : [
                  { value: 'k', label: 'K' },
                  { value: 'd', label: 'D' },
                  { value: 'j', label: 'J' },
                ],
          )}
          {selectField('模式', 'mode', [
            { value: 'compare', label: '阈值比较' },
            { value: 'range', label: '区间范围' },
          ])}
          {isRangeMode ? (
            <>
              {numberField('最小值', 'min')}
              {numberField('最大值', 'max')}
            </>
          ) : (
            <>
              {selectField('比较方式', 'direction', THRESHOLD_DIRECTIONS)}
              {numberField('阈值', 'threshold')}
            </>
          )}
        </div>
      )
    }

    if (condition.kind === 'volume_spike') {
      const isRangeMode = String(param('mode') ?? 'compare') === 'range'
      return (
        <div className="field-row">
          {selectField('参考均量', 'reference', [
            { value: 'average5', label: 'MA5 均量' },
            { value: 'average20', label: 'MA20 均量' },
          ])}
          {selectField('模式', 'mode', [
            { value: 'compare', label: '阈值比较' },
            { value: 'range', label: '区间范围' },
          ])}
          {isRangeMode ? (
            <>
              {numberField('最小倍数', 'minMultiplier')}
              {numberField('最大倍数', 'maxMultiplier')}
            </>
          ) : (
            <>
              {selectField('比较方式', 'direction', THRESHOLD_DIRECTIONS)}
              {numberField('放大量倍数', 'multiplier')}
            </>
          )}
        </div>
      )
    }

    return <p className="note">这个条件没有额外参数，保存后会直接参与筛选。</p>
  }

  useEffect(() => {
    void loadSnapshot(false)
    void loadStrategyPresets()
    void loadWatchlist()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadSnapshot(true)
    }, 30_000)

    return () => {
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!snapshot || !draftConfig || activeView !== 'screener') {
      return
    }

    void loadResults(true)
  }, [activeView, snapshotVersion, currentPage, onlyMatched, deferredSearchText, selectedBarsKey, selectedPatternsKey])

  useEffect(() => {
    if (!draftConfig || strategyHydratedRef.current) {
      return
    }

    const preset = draftConfig.activeStrategyPresetId
      ? strategyPresets.find((item) => item.id === draftConfig.activeStrategyPresetId) ?? null
      : null

    hydrateStrategyEditor(preset)
    if (!preset && !strategyName) {
      setStrategyName('未命名策略')
      setStrategyScheduleMinutes(draftConfig.refreshIntervalMinutes)
    }
    strategyHydratedRef.current = true
  }, [draftConfig?.activeStrategyPresetId, strategyPresets])

  useEffect(() => {
    if (!snapshot) {
      return
    }

    if (!seededAlertsRef.current) {
      snapshot.recentAlerts.forEach((record) => seenAlertIdsRef.current.add(record.id))
      seededAlertsRef.current = true
      return
    }

    const freshAlerts = snapshot.recentAlerts.filter((record) => !seenAlertIdsRef.current.has(record.id)).reverse()
    if (freshAlerts.length === 0) {
      return
    }

    freshAlerts.forEach((record) => seenAlertIdsRef.current.add(record.id))

    for (const record of freshAlerts) {
      if (notificationPermission === 'granted' && typeof Notification !== 'undefined') {
        new Notification(buildNotificationTitle(record), {
          body: buildNotificationBody(record),
        })
      }
      if (snapshot.config.soundAlertsEnabled) {
        playAlertSound()
      }
    }
  }, [recentAlertVersion, notificationPermission, snapshot?.config.soundAlertsEnabled])

  useEffect(() => {
    if (activeView !== 'screener' || realtimeArgs.length === 0) {
      setLiveConnectionState('idle')
      return
    }

    let disposed = false
    let socket: WebSocket | null = null
    let pingTimer: number | null = null
    let reconnectTimer: number | null = null
    let nextUrlIndex = 0

    const cleanupTimers = () => {
      if (pingTimer !== null) {
        window.clearInterval(pingTimer)
        pingTimer = null
      }
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    }

    const connect = () => {
      if (disposed) {
        return
      }

      cleanupTimers()
      setLiveConnectionState(socket ? 'reconnecting' : 'connecting')

      const url = GATE_PUBLIC_WS_URLS[nextUrlIndex % GATE_PUBLIC_WS_URLS.length]
      nextUrlIndex += 1
      socket = new WebSocket(url)

      socket.onopen = () => {
        if (disposed || !socket) {
          return
        }

        setLiveConnectionState('open')
        for (const arg of realtimeArgs) {
          socket.send(buildSubscriptionMessage(arg))
        }
        pingTimer = window.setInterval(() => {
          socket?.send(buildPingMessage())
        }, 15_000)
      }

      socket.onmessage = (event) => {
        const payload = parseRealtimeMessage(String(event.data ?? ''))

        if (payload.tickers.length > 0) {
          setResultsResponse((current) => {
            if (!current) {
              return current
            }

            let changed = false
            const nextItems = current.items.map((item) => {
              const ticker = payload.tickers.find((entry) => entry.instId === item.instId)
              if (!ticker || ticker.lastPrice === item.lastPrice) {
                return item
              }

              changed = true
              return { ...item, lastPrice: ticker.lastPrice }
            })

            return changed ? { ...current, items: nextItems } : current
          })
        }

        if (payload.candles.length > 0 && selectedResult) {
          const candleUpdate = payload.candles.find(
            (entry) => entry.instId === selectedResult.instId && entry.timeframe === selectedResult.timeframe,
          )

          if (candleUpdate) {
            setSelectedChart((current) => {
              if (!current) {
                return current
              }

              return {
                ...current,
                candles: mergeRealtimeCandleSeries(
                  current.candles,
                  candleUpdate.candle,
                  liveFastMaPeriod,
                  liveSlowMaPeriod,
                  liveChartCandles,
                ),
              }
            })
          }
        }
      }

      socket.onclose = () => {
        cleanupTimers()
        if (!disposed) {
          setLiveConnectionState('reconnecting')
          reconnectTimer = window.setTimeout(connect, 2_000)
        }
      }

      socket.onerror = () => {
        socket?.close()
      }
    }

    connect()

    return () => {
      disposed = true
      cleanupTimers()
      socket?.close()
    }
  }, [activeView, realtimeArgsKey, liveFastMaPeriod, liveSlowMaPeriod, liveChartCandles, selectedResult?.instId, selectedResult?.timeframe])

  if (!snapshot || !draftConfig) {
    return (
      <main className="app-shell loading-shell">
        <LoaderCircle className="spin" size={32} />
        <p>正在加载 Gate 永续筛选面板...</p>
      </main>
    )
  }

  const patternSet = new Set(selectedPatterns)
  const totalPages = Math.max(1, Math.ceil((resultsResponse?.total ?? 0) / PAGE_SIZE))
  const currentItems = resultsResponse?.items ?? []

  return (
    <main className="app-shell">
      <nav className="page-nav">
        <button
          className={activeView === 'screener' ? 'page-nav-button page-nav-button-active' : 'page-nav-button'}
          type="button"
          onClick={() => setActiveView('screener')}
        >
          <ChartIcon size={16} />
          筛选面板
        </button>
        <button
          className={activeView === 'llm-history' ? 'page-nav-button page-nav-button-active' : 'page-nav-button'}
          type="button"
          onClick={() => setActiveView('llm-history')}
        >
          <Bot size={16} />
          LLM 历史分析
        </button>
      </nav>

      {activeView === 'llm-history' ? (
        <LlmHistoryPanel />
      ) : (
        <>
          <section className="hero-panel">
            <div className="hero-copy">
              <p className="eyebrow">Gate Futures Screener</p>
              <h1>Gate 永续多策略选币平台</h1>
              <p className="hero-text">
                当前版本已经支持均线筛选、形态选股、策略收藏、自选、LLM 历史记录和浏览器提醒。条件改完后点击“保存设置并重扫”即可把规则真正送进后端执行链路。
              </p>
              <div className="hero-actions">
                <button className="primary-button" type="button" onClick={handleManualScan} disabled={isBusy}>
                  {isBusy ? <LoaderCircle size={16} className="spin" /> : <RefreshCcw size={16} />}
                  手动扫描
                </button>
                <button className="secondary-button" type="button" onClick={handleSaveSettings} disabled={isBusy}>
                  <Save size={16} />
                  保存设置并重扫
                </button>
                <button className="secondary-button" type="button" onClick={handleApplyStrategy} disabled={isBusy}>
                  <Settings2 size={16} />
                  应用策略并重扫
                </button>
              </div>
            </div>

            <div className="hero-status">
              <div className="status-row">
                <span>运行状态</span>
                <strong>{snapshot.status.isRunning ? '正在扫描' : '空闲'}</strong>
              </div>
              <div className="status-row">
                <span>服务连接</span>
                <strong>{connectionState === 'ok' ? '正常' : '降级'}</strong>
              </div>
              <div className="status-row">
                <span>实时行情</span>
                <strong>{liveConnectionState === 'open' ? '已连接' : liveConnectionState === 'connecting' ? '连接中' : liveConnectionState === 'reconnecting' ? '重连中' : '未连接'}</strong>
              </div>
              <div className="status-row">
                <span>最近刷新</span>
                <strong>{snapshot.status.lastSuccessfulAt ? formatDateTime(snapshot.status.lastSuccessfulAt) : '--'}</strong>
              </div>
            </div>
          </section>

          <section className="stats-grid">
            <StatCard label="命中结果" value={String(snapshot.stats.matchedRows)} hint="当前命中总数" />
            <StatCard label="扫描合约" value={String(snapshot.stats.scannedInstruments)} hint="本轮覆盖的永续合约数量" />
            <StatCard label="抓取耗时" value={formatDuration(snapshot.stats.durationMs)} hint="单轮扫描用时" />
            <StatCard label="分析行数" value={String(snapshot.stats.analyzedRows)} hint="含全部周期结果" />
          </section>

          {watchlistItems.length > 0 ? (
            <section className="watchlist-strip">
              <div className="watchlist-strip-header">
                <strong>我的自选</strong>
                <small>点击币种会自动带入搜索框，便于滑动查看。</small>
              </div>
              <div className="watchlist-strip-scroll">
                {watchlistItems.map((item) => (
                  <button key={item.instId} className="chip chip-active" type="button" onClick={() => setSearchText(item.instId)}>
                    <Star size={12} />
                    {item.instId}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {snapshot.aiOverview ? (
            <section className="ai-overview-panel">
              <div className="ai-overview-header">
                <div>
                  <p className="eyebrow">AI Overview</p>
                  <h2>15 分钟 AI 变化总览</h2>
                  <p className="ai-overview-subtitle">{snapshot.aiOverview.summary ?? '当前正在生成规则摘要或 Qwen 总结。'}</p>
                </div>
                <div className="ai-overview-meta">
                  <span>状态 {snapshot.aiOverview.status}</span>
                  <span>总命中 {snapshot.aiOverview.totalMatches}</span>
                  <span>新增 {snapshot.aiOverview.newMatches}</span>
                  <span>消失 {snapshot.aiOverview.removedMatches}</span>
                </div>
              </div>
              <div className="ai-overview-chip-row">
                {(snapshot.aiOverview.timeframeStats ?? []).map((item) => (
                  <span key={item.timeframe} className="summary-chip">{item.label} {item.count}</span>
                ))}
              </div>
            </section>
          ) : null}

          {snapshot.strategyRuns?.length ? (
            <section className="strategy-run-grid">
              {snapshot.strategyRuns.map((item) => (
                <StrategyRunCard key={item.strategyPresetId} item={item} />
              ))}
            </section>
          ) : null}

          <div className="top-toolbar">
            <div className="toolbar-meta">
              <span className={connectionState === 'ok' ? 'status-dot' : 'status-dot status-dot-off'}>服务{connectionState === 'ok' ? '正常' : '降级'}</span>
              <span className={liveConnectionState === 'open' ? 'status-dot' : 'status-dot status-dot-off'}>实时行情{liveConnectionState === 'open' ? '已连接' : '未连接'}</span>
              <span>下次调度：{snapshot.status.nextScheduledRunAt ? formatDateTime(snapshot.status.nextScheduledRunAt) : '--'}</span>
            </div>
            <div className="toolbar-filters">
              <label className="monitor-toggle">
                <input
                  type="checkbox"
                  checked={draftConfig.monitoringEnabled}
                  onChange={(event) => {
                    const enabled = event.target.checked
                    updateDraftConfig((current) => ({ ...current, monitoringEnabled: enabled }))
                    void toggleMonitor(enabled).then((nextSnapshot) => {
                      setSnapshot(nextSnapshot)
                      setDraftConfig(cloneConfig(nextSnapshot.config))
                    })
                  }}
                />
                自动监控
              </label>
              <button className="secondary-button" type="button" onClick={handleRequestNotifications}>
                <Bell size={16} />
                通知权限 {notificationPermission}
              </button>
            </div>
          </div>

          {message ? <div className="flash-message">{message}</div> : null}

          <section className="workspace">
            <aside className="control-panel">
              <div className="panel-heading">
                <Settings2 size={18} />
                <h2>筛选参数</h2>
              </div>

              <label className="field" htmlFor="strategy-select">
                <span>我的选币策略</span>
                <select
                  id="strategy-select"
                  name="strategy_select"
                  value={selectedStrategyId ?? ''}
                  onChange={(event) => {
                    const preset = strategyPresets.find((item) => item.id === event.target.value) ?? null
                    hydrateStrategyEditor(preset)
                    if (preset) {
                      updateDraftConfig((current) => ({
                        ...current,
                        activeStrategyPresetId: preset.id,
                        selectedTimeframes: [...preset.selectedTimeframes],
                        extraConditions: (preset.conditions ?? []).map(cloneCondition),
                      }))
                      setCurrentPage(1)
                    }
                  }}
                >
                  <option value="">未绑定策略</option>
                  {strategyPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>{preset.name}</option>
                  ))}
                </select>
              </label>

              <div className="field-row">
                <label className="field" htmlFor="strategy-name">
                  <span>策略名称</span>
                  <input id="strategy-name" name="strategy_name" value={strategyName} onChange={(event) => setStrategyName(event.target.value)} />
                </label>
                <label className="field" htmlFor="strategy-schedule">
                  <span>策略执行间隔（分钟）</span>
                  <input id="strategy-schedule" name="strategy_schedule" type="number" min="15" max="240" value={strategyScheduleMinutes} onChange={(event) => setStrategyScheduleMinutes(Number(event.target.value))} />
                </label>
              </div>

              <label className="field" htmlFor="strategy-description">
                <span>策略说明</span>
                <textarea id="strategy-description" name="strategy_description" rows={3} value={strategyDescription} onChange={(event) => setStrategyDescription(event.target.value)} />
              </label>

              <div className="field-row">
                <label className="toggle-card">
                  <div>
                    <strong>收藏常用策略</strong>
                    <small>会在策略列表里长期保留。</small>
                  </div>
                  <input type="checkbox" checked={strategyFavorite} onChange={(event) => setStrategyFavorite(event.target.checked)} />
                </label>
                <label className="toggle-card">
                  <div>
                    <strong>策略自动执行</strong>
                    <small>开启后参与后台并行调度。</small>
                  </div>
                  <input type="checkbox" checked={strategyAutoRun} onChange={(event) => setStrategyAutoRun(event.target.checked)} />
                </label>
              </div>

              <div className="panel-actions">
                <button className="secondary-button" type="button" onClick={handleSaveStrategy} disabled={isBusy}>
                  <Save size={16} />
                  保存策略
                </button>
                <button className="secondary-button" type="button" onClick={() => { hydrateStrategyEditor(null); setStrategyName('未命名策略') }}>
                  <RefreshCcw size={16} />
                  新建策略
                </button>
              </div>

              <label className="field" htmlFor="match-mode">
                <span>命中逻辑</span>
                <select id="match-mode" name="match_mode" value={draftConfig.matchMode} onChange={(event) => updateDraftConfig((current) => ({ ...current, matchMode: event.target.value as MatchMode }))}>
                  {MATCH_MODE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>

              <label className="field" htmlFor="ma-up-strategy">
                <span>MA5 抬头策略</span>
                <select id="ma-up-strategy" name="ma_up_strategy" value={draftConfig.maUpStrategy} onChange={(event) => updateDraftConfig((current) => ({ ...current, maUpStrategy: event.target.value as MaUpStrategy }))}>
                  {MA_UP_STRATEGIES.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>

              <div className="field">
                <span>筛选周期</span>
                <div className="chip-grid">
                  {TIMEFRAME_DEFINITIONS.map((timeframe) => (
                    <button key={timeframe.key} className={draftConfig.selectedTimeframes.includes(timeframe.key) ? 'chip chip-active' : 'chip'} type="button" onClick={() => toggleTimeframe(timeframe.key)}>
                      {timeframe.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field-row">
                <label className="field" htmlFor="fast-ma">
                  <span>快线 MA</span>
                  <input id="fast-ma" name="fast_ma" type="number" value={draftConfig.fastMaPeriod} onChange={(event) => updateDraftConfig((current) => ({ ...current, fastMaPeriod: Number(event.target.value) }))} />
                </label>
                <label className="field" htmlFor="slow-ma">
                  <span>慢线 MA</span>
                  <input id="slow-ma" name="slow_ma" type="number" value={draftConfig.slowMaPeriod} onChange={(event) => updateDraftConfig((current) => ({ ...current, slowMaPeriod: Number(event.target.value) }))} />
                </label>
              </div>

              <div className="field-row">
                <label className="field" htmlFor="convergence-threshold">
                  <span>收拢阈值 %</span>
                  <input id="convergence-threshold" name="convergence_threshold" type="number" step="0.01" value={draftConfig.convergenceThresholdPct} onChange={(event) => updateDraftConfig((current) => ({ ...current, convergenceThresholdPct: Number(event.target.value) }))} />
                </label>
                <label className="field" htmlFor="lookback">
                  <span>抬头回看根数</span>
                  <input id="lookback" name="ma_lookback" type="number" value={draftConfig.maSlopeLookback} onChange={(event) => updateDraftConfig((current) => ({ ...current, maSlopeLookback: Number(event.target.value) }))} />
                </label>
              </div>

              <label className="toggle-card">
                <div>
                  <strong>附加 10/30 收拢</strong>
                  <small>启用后把 MA10 / MA30 也纳入判断。</small>
                </div>
                <input type="checkbox" checked={draftConfig.secondaryConvergenceEnabled} onChange={(event) => updateDraftConfig((current) => ({ ...current, secondaryConvergenceEnabled: event.target.checked }))} />
              </label>

              <div className="field-row">
                <label className="field" htmlFor="secondary-fast">
                  <span>附加快线</span>
                  <input id="secondary-fast" name="secondary_fast" type="number" value={draftConfig.secondaryFastMaPeriod} onChange={(event) => updateDraftConfig((current) => ({ ...current, secondaryFastMaPeriod: Number(event.target.value) }))} />
                </label>
                <label className="field" htmlFor="secondary-slow">
                  <span>附加慢线</span>
                  <input id="secondary-slow" name="secondary_slow" type="number" value={draftConfig.secondarySlowMaPeriod} onChange={(event) => updateDraftConfig((current) => ({ ...current, secondarySlowMaPeriod: Number(event.target.value) }))} />
                </label>
              </div>

              <label className="toggle-card">
                <div>
                  <strong>实体上穿斜率过滤</strong>
                  <small>要求 MA5 斜率为正，并避免过于平缓的踩线情况。</small>
                </div>
                <input type="checkbox" checked={draftConfig.crossSlopeEnabled} onChange={(event) => updateDraftConfig((current) => ({ ...current, crossSlopeEnabled: event.target.checked }))} />
              </label>

              <label className="field" htmlFor="cross-slope-threshold">
                <span>实体上穿最小斜率 %</span>
                <input id="cross-slope-threshold" name="cross_slope_threshold" type="number" step="0.01" value={draftConfig.crossSlopeThresholdPct} onChange={(event) => updateDraftConfig((current) => ({ ...current, crossSlopeThresholdPct: Number(event.target.value) }))} />
              </label>

              <div className="field">
                <span>形态选股</span>
                <div id="patterns" className="chip-grid">
                  {PATTERN_DEFINITIONS.map((pattern) => (
                    <button key={pattern.key} className={patternSet.has(pattern.key) ? 'chip chip-active' : 'chip'} type="button" onClick={() => togglePattern(pattern.key)}>
                      {pattern.label}
                    </button>
                  ))}
                </div>
                <small className="note-line">可多选，用于在已经筛出的信号里继续按形态细分过滤。</small>
              </div>

              <div className="field-row">
                <label className="field" htmlFor="condition-library">
                  <span>筛选技术指标</span>
                  <select id="condition-library" name="condition_library" value={selectedConditionKind} onChange={(event) => setSelectedConditionKind(event.target.value as ConditionKind)}>
                    {CONDITION_LIBRARY.map((item) => (
                      <option key={item.kind} value={item.kind}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <div className="panel-actions">
                  <button className="secondary-button" type="button" onClick={addCondition}>
                    <Settings2 size={16} />
                    新增条件
                  </button>
                  <button className="secondary-button" type="button" onClick={() => { setSearchText(''); setCurrentPage(1); if (snapshot) { setDraftConfig(cloneConfig(snapshot.config)) } }}>
                    <RefreshCcw size={16} />
                    重置条件
                  </button>
                </div>
              </div>

              <div className="condition-list">
                {editableConditions.length > 0 ? (
                  editableConditions.map((condition) => (
                    <div key={condition.id} className="condition-card">
                      <div className="condition-card-header">
                        <strong>{condition.label}</strong>
                        <div className="toolbar-filters">
                          <label className="checkbox-row">
                            <input type="checkbox" checked={condition.enabled} onChange={(event) => updateCondition(condition.id, (current) => ({ ...current, enabled: event.target.checked }))} />
                            启用
                          </label>
                          <button className="chip" type="button" onClick={() => removeCondition(condition.id)}>移除</button>
                        </div>
                      </div>
                      {renderConditionFields(condition)}
                    </div>
                  ))
                ) : (
                  <p className="note">当前还没有附加指标条件，默认只按主均线策略筛选。</p>
                )}
              </div>

              <div className="panel-heading">
                <BellRing size={18} />
                <h2>涨跌幅提醒</h2>
              </div>

              <div className="field-row">
                <label className="field" htmlFor="price-alert-window">
                  <span>提醒窗口</span>
                  <select id="price-alert-window" name="price_alert_window" value={priceAlertDraft.window} onChange={(event) => setPriceAlertDraft((current) => ({ ...current, window: event.target.value as PriceChangeAlertRule['window'] }))}>
                    {PRICE_WINDOWS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <label className="field" htmlFor="price-alert-direction">
                  <span>阈值方向</span>
                  <select id="price-alert-direction" name="price_alert_direction" value={priceAlertDraft.direction} onChange={(event) => setPriceAlertDraft((current) => ({ ...current, direction: event.target.value as ThresholdDirection }))}>
                    {THRESHOLD_DIRECTIONS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="field-row">
                <label className="field" htmlFor="price-alert-threshold">
                  <span>阈值 %</span>
                  <input id="price-alert-threshold" name="price_alert_threshold" type="number" step="0.1" value={priceAlertDraft.thresholdPct} onChange={(event) => setPriceAlertDraft((current) => ({ ...current, thresholdPct: Number(event.target.value) }))} />
                </label>
                <label className="field" htmlFor="price-alert-cooldown">
                  <span>冷却时间（分钟）</span>
                  <input id="price-alert-cooldown" name="price_alert_cooldown" type="number" value={priceAlertDraft.cooldownMinutes} onChange={(event) => setPriceAlertDraft((current) => ({ ...current, cooldownMinutes: Number(event.target.value) }))} />
                </label>
              </div>

              <label className="field" htmlFor="price-alert-label">
                <span>提醒名称</span>
                <input id="price-alert-label" name="price_alert_label" value={priceAlertDraft.label} onChange={(event) => setPriceAlertDraft((current) => ({ ...current, label: event.target.value }))} placeholder="例如：1小时大涨提醒" />
              </label>

              <div className="panel-actions">
                <button className="secondary-button" type="button" onClick={addPriceAlertRule}>
                  <Bell size={16} />
                  添加提醒规则
                </button>
              </div>

              <div className="chip-grid">
                {draftConfig.priceAlertRules.map((rule) => (
                  <button key={rule.id} className="chip chip-active" type="button" onClick={() => removePriceAlertRule(rule.id)}>
                    {describePriceAlertRule(rule)} ×
                  </button>
                ))}
              </div>

              <label className="toggle-card">
                <div>
                  <strong>浏览器声音提醒</strong>
                  <small>当后端产生新提醒记录时，当前打开页面会弹窗并可播放提示音。</small>
                </div>
                <input type="checkbox" checked={draftConfig.soundAlertsEnabled} onChange={(event) => updateDraftConfig((current) => ({ ...current, soundAlertsEnabled: event.target.checked }))} />
              </label>

              <div className="panel-heading">
                <Send size={18} />
                <h2>提醒设置</h2>
              </div>

              <label className="toggle-card">
                <div>
                  <strong>启用 Webhook</strong>
                  <small>支持通用 JSON、企业微信、钉钉机器人。</small>
                </div>
                <input type="checkbox" checked={draftConfig.webhookEnabled} onChange={(event) => updateDraftConfig((current) => ({ ...current, webhookEnabled: event.target.checked }))} />
              </label>

              <div className="field-row">
                <label className="field" htmlFor="refresh-interval">
                  <span>轮询间隔（分钟）</span>
                  <input id="refresh-interval" name="refresh_interval" type="number" value={draftConfig.refreshIntervalMinutes} onChange={(event) => updateDraftConfig((current) => ({ ...current, refreshIntervalMinutes: Number(event.target.value) }))} />
                </label>
                <label className="field" htmlFor="cooldown-minutes">
                  <span>信号冷却（分钟）</span>
                  <input id="cooldown-minutes" name="cooldown_minutes" type="number" value={draftConfig.notificationCooldownMinutes} onChange={(event) => updateDraftConfig((current) => ({ ...current, notificationCooldownMinutes: Number(event.target.value) }))} />
                </label>
              </div>

              <div className="field-row">
                <label className="field" htmlFor="webhook-type">
                  <span>Webhook 类型</span>
                  <select id="webhook-type" name="webhook_type" value={draftConfig.webhookType} onChange={(event) => updateDraftConfig((current) => ({ ...current, webhookType: event.target.value as ScreenerConfig['webhookType'] }))}>
                    <option value="generic">通用 JSON</option>
                    <option value="wecom">企业微信</option>
                    <option value="dingtalk">钉钉机器人</option>
                  </select>
                </label>
                <label className="field" htmlFor="fetch-limit">
                  <span>抓取根数</span>
                  <input id="fetch-limit" name="fetch_limit" type="number" value={draftConfig.fetchLimit} onChange={(event) => updateDraftConfig((current) => ({ ...current, fetchLimit: Number(event.target.value) }))} />
                </label>
              </div>

              <label className="field" htmlFor="webhook-url">
                <span>Webhook 地址</span>
                <textarea id="webhook-url" name="webhook_url" rows={3} value={draftConfig.webhookUrl} onChange={(event) => updateDraftConfig((current) => ({ ...current, webhookUrl: event.target.value }))} />
              </label>

              <div className="field-row">
                <label className="field" htmlFor="chart-candles">
                  <span>图表显示根数</span>
                  <input id="chart-candles" name="chart_candles" type="number" value={draftConfig.chartCandles} onChange={(event) => updateDraftConfig((current) => ({ ...current, chartCandles: Number(event.target.value) }))} />
                </label>
                <div className="panel-actions">
                  <button className="secondary-button" type="button" onClick={handleTestWebhook} disabled={isTestingWebhook}>
                    {isTestingWebhook ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}
                    测试提醒
                  </button>
                </div>
              </div>
            </aside>

            <section className="result-panel">
              <div className="panel-heading">
                <ChartIcon size={18} />
                <h2>统一筛选结果</h2>
              </div>

              <div className="result-toolbar">
                <div>
                  <h2>所有周期统一显示在一张表中</h2>
                  <p>表格结果来自 Gate 公共行情，命中规则以最近一根已完成 K 线为准。</p>
                </div>
                <div className="toolbar-filters">
                  <label className="checkbox-row">
                    <input type="checkbox" checked={onlyMatched} onChange={(event) => { setOnlyMatched(event.target.checked); setCurrentPage(1) }} />
                    只显示命中项
                  </label>
                  <input className="search-input" type="search" value={searchText} placeholder="搜索币种、instId 或交易品种" onChange={(event) => { setSearchText(event.target.value); setCurrentPage(1) }} />
                </div>
              </div>

              <div className="active-filter-row">
                <span>已选条件</span>
                <div className="chip-grid">
                  {draftConfig.selectedTimeframes.map((timeframe) => (
                    <button key={timeframe} className="chip" type="button" onClick={() => toggleTimeframe(timeframe)}>
                      {TIMEFRAME_DEFINITIONS.find((item) => item.key === timeframe)?.label ?? timeframe} ×
                    </button>
                  ))}
                  {selectedPatterns.map((patternKey) => (
                    <button key={patternKey} className="chip" type="button" onClick={() => togglePattern(patternKey)}>
                      {getPatternLabel(patternKey)} ×
                    </button>
                  ))}
                  {editableConditions.filter((item) => item.enabled).map((condition) => (
                    <button key={condition.id} className="chip" type="button" onClick={() => removeCondition(condition.id)}>
                      {describeCondition(condition)} ×
                    </button>
                  ))}
                  {draftConfig.priceAlertRules.filter((item) => item.enabled).map((rule) => (
                    <button key={rule.id} className="chip" type="button" onClick={() => removePriceAlertRule(rule.id)}>
                      {describePriceAlertRule(rule)} ×
                    </button>
                  ))}
                  {searchText ? <button className="chip" type="button" onClick={() => setSearchText('')}>搜索：{searchText} ×</button> : null}
                </div>
              </div>

              <div className="result-meta">
                <span>总结果：{resultsResponse?.total ?? 0}</span>
                <span>当前页：{currentPage} / {Math.max(1, Math.ceil((resultsResponse?.total ?? 0) / PAGE_SIZE))}</span>
                <span>最近完成：{snapshot.status.lastSuccessfulAt ? formatDateTime(snapshot.status.lastSuccessfulAt) : '--'}</span>
                <span>最近提醒：{snapshot.status.lastAlertedAt ? formatDateTime(snapshot.status.lastAlertedAt) : '--'}</span>
              </div>

              {snapshot.recentAlerts.length > 0 ? (
                <div className="alert-feed">
                  {snapshot.recentAlerts.slice(0, 6).map((alert) => (
                    <div key={alert.id} className="alert-feed-item">
                      <strong>{alert.category === 'price_change' ? '价格提醒' : '信号提醒'}</strong>
                      <span>{alert.instId} · {alert.timeframeLabel}</span>
                      <small>{formatDateTime(alert.sentAt)}</small>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="table-wrap">
                <table className="result-table">
                  <thead>
                    <tr>
                      <th>序号</th>
                      <th>币种 / instId</th>
                      <th>自选</th>
                      <th>合约类型</th>
                      <th>周期</th>
                      <th>最新价</th>
                      <th>涨幅</th>
                      <th>AI 标签</th>
                      <th>市值</th>
                      <th>市值排名</th>
                      <th>MA5</th>
                      <th>MA20</th>
                      <th>距离%</th>
                      <th>MA5方向</th>
                      <th>实体上穿MA5</th>
                      <th>命中时间</th>
                      <th>提醒状态</th>
                      <th>图表</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentItems.length > 0 ? (
                      currentItems.map((item, index) => {
                        const visiblePatterns = (item.patternMatches ?? []).filter(
                          (pattern) => pattern.matched && (patternSet.size === 0 || patternSet.has(pattern.key)),
                        )

                        return (
                          <tr key={item.signalKey}>
                            <td>{(currentPage - 1) * PAGE_SIZE + index + 1}</td>
                            <td>
                              <div className="symbol-cell">
                                <strong>{item.instId}</strong>
                                <small>{item.instrumentName}</small>
                                <div className="flag-stack">
                                  {visiblePatterns.slice(0, 3).map((pattern) => (
                                    <span key={pattern.key} className="flag flag-active">{pattern.label}</span>
                                  ))}
                                </div>
                              </div>
                            </td>
                            <td>
                              <button className={item.watchlisted ? 'watchlist-button active' : 'watchlist-button'} type="button" onClick={() => void handleToggleWatchlist(item)}>
                                <Star size={16} />
                              </button>
                            </td>
                            <td>{item.contractType}</td>
                            <td>{item.timeframeLabel}</td>
                            <td>{formatPrice(item.lastPrice)}</td>
                            <td>
                              <div className="metric-cell">
                                <strong className={(item.priceChanges?.today ?? 0) >= 0 ? 'positive' : 'negative'}>{formatPriceChange(item.priceChanges?.today)}</strong>
                                <small>1h {formatPriceChange(item.priceChanges?.['1h'])} · 5m {formatPriceChange(item.priceChanges?.['5m'])}</small>
                              </div>
                            </td>
                            <td>
                              <div className="metric-cell">
                                <strong>{item.aiRecommendationLabel ?? '--'}</strong>
                                <small>{item.aiRecommendationReason ?? '--'}</small>
                              </div>
                            </td>
                            <td>{formatCompactNumber(item.marketCap?.marketCap)}</td>
                            <td>{item.marketCap?.marketCapRank ?? '--'}</td>
                            <td>{formatPrice(item.fastMa)}</td>
                            <td>{formatPrice(item.slowMa)}</td>
                            <td>{formatPercent(item.convergencePct)}</td>
                            <td>
                              <div className="trend-cell">
                                <strong className={item.maTrendDirection === 'up' ? 'positive' : item.maTrendDirection === 'down' ? 'negative' : ''}>{item.maTrendDirection}</strong>
                                <small>{formatPercent(item.fastMaSlopePct)}</small>
                              </div>
                            </td>
                            <td>
                              <div className="trend-cell">
                                <strong>{item.trendFlags.priceCrossedFastMa ? '是' : '否'}</strong>
                                <small>实体斜率 {formatPercent(item.crossSlopePct)}</small>
                              </div>
                            </td>
                            <td>{formatDateTime(item.crossedAt)}</td>
                            <td><AlertBadge status={item.alertStatus} /></td>
                            <td>
                              <button className="chart-button" type="button" onClick={() => void openChartForResult(item)}>
                                <ChartIcon size={16} />
                                <div className="mini-chart">
                                  <CandlestickChart candles={item.chart} compact />
                                </div>
                              </button>
                            </td>
                          </tr>
                        )
                      })
                    ) : (
                      <tr>
                        <td colSpan={18} className="empty-cell">当前条件下暂无结果，请等待下一轮扫描或调整参数。</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="pagination-row">
                <button className="secondary-button" type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage((current) => Math.max(1, current - 1))}>上一页</button>
                <span>第 {currentPage} 页，共 {totalPages} 页</span>
                <button className="secondary-button" type="button" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((current) => Math.min(totalPages, current + 1))}>下一页</button>
              </div>
            </section>
          </section>

          {selectedResult ? (
            <div className="modal-backdrop" role="presentation" onClick={() => { setSelectedResult(null); setSelectedChart(null); setChartError(null) }}>
              <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
                <div className="modal-header">
                  <div>
                    <h3>{selectedResult.instId} · {selectedResult.timeframeLabel}</h3>
                    <p>{selectedChart?.latestSignal ?? '正在加载图表数据...'}</p>
                  </div>
                  <button className="secondary-button" type="button" onClick={() => { setSelectedResult(null); setSelectedChart(null); setChartError(null) }}>关闭</button>
                </div>

                <div className="modal-summary">
                  <span className="summary-chip">信号来源：规则引擎</span>
                  <span className="summary-chip">收拢度：{formatPercent(selectedResult.convergencePct)}</span>
                  <span className="summary-chip">MA5 趋势：{selectedResult.maTrendDirection}</span>
                  <span className="summary-chip">实体斜率：{formatPercent(selectedResult.crossSlopePct)}</span>
                </div>

                {selectedChart?.item?.llmSummary ? (
                  <div className="llm-summary-card">
                    <p>{selectedChart.item.llmSummary}</p>
                  </div>
                ) : null}

                {chartError ? <div className="error-banner">{chartError}</div> : null}
                {isChartLoading ? (
                  <div className="loading-shell">
                    <LoaderCircle className="spin" size={24} />
                    <p>正在加载图表...</p>
                  </div>
                ) : selectedChart ? (
                  <CandlestickChart candles={selectedChart.candles} />
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      )}
    </main>
  )
}

export default App

