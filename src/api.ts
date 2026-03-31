import type {
  AlertsResponse,
  ChartResponse,
  LlmHistoryResponse,
  ResultsQuery,
  ResultsResponse,
  ScreenerConfig,
  SnapshotPayload,
  StrategyPresetsResponse,
  UpdateConfigPayload,
  WatchlistResponse,
} from '../shared/types'
import type { TimeframeKey } from '../shared/timeframes'

function resolveApiBaseUrl() {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()

  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, '')
  }

  if (typeof window === 'undefined') {
    return ''
  }

  const { protocol, hostname, port } = window.location

  if ((hostname === 'localhost' || hostname === '127.0.0.1') && /^517\d$/.test(port)) {
    return `${protocol}//${hostname}:8787`
  }

  return ''
}

const API_BASE_URL = resolveApiBaseUrl()

function buildApiUrl(path: string) {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path
}

async function request<T>(input: string, init?: RequestInit) {
  const response = await fetch(buildApiUrl(input), {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    ...init,
  })

  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`)
  }

  return (await response.json()) as T
}

function normalizeConfigPayload(config: Record<string, unknown> | undefined | null): ScreenerConfig {
  const next = config ?? {}
  const fallbackTimeframes: TimeframeKey[] = ['15m', '1H', '2H', '3H', '4H']
  const selectedTimeframes = Array.isArray(next.selectedTimeframes)
    ? next.selectedTimeframes.filter((item): item is TimeframeKey => typeof item === 'string')
    : fallbackTimeframes

  return {
    selectedTimeframes:
      selectedTimeframes.length > 0 ? selectedTimeframes : fallbackTimeframes,
    fastMaPeriod: Number(next.fastMaPeriod ?? 5),
    slowMaPeriod: Number(next.slowMaPeriod ?? 20),
    convergenceThresholdPct: Number(next.convergenceThresholdPct ?? 0.8),
    secondaryConvergenceEnabled: Boolean(next.secondaryConvergenceEnabled),
    secondaryFastMaPeriod: Number(next.secondaryFastMaPeriod ?? 10),
    secondarySlowMaPeriod: Number(next.secondarySlowMaPeriod ?? 30),
    convergenceRelation:
      typeof next.convergenceRelation === 'string'
        ? (next.convergenceRelation as ScreenerConfig['convergenceRelation'])
        : 'and',
    crossSlopeEnabled: Boolean(next.crossSlopeEnabled ?? true),
    crossSlopeThresholdPct: Number(next.crossSlopeThresholdPct ?? 0.03),
    maSlopeLookback: Number(next.maSlopeLookback ?? 2),
    maUpStrategy:
      typeof next.maUpStrategy === 'string'
        ? (next.maUpStrategy as ScreenerConfig['maUpStrategy'])
        : 'stair_up',
    matchMode:
      typeof next.matchMode === 'string'
        ? (next.matchMode as ScreenerConfig['matchMode'])
        : 'A_B_C',
    fetchLimit: Number(next.fetchLimit ?? 120),
    chartCandles: Number(next.chartCandles ?? 80),
    activeStrategyPresetId:
      typeof next.activeStrategyPresetId === 'string' && next.activeStrategyPresetId.trim().length > 0
        ? next.activeStrategyPresetId
        : null,
    extraConditions: Array.isArray(next.extraConditions) ? next.extraConditions : [],
    priceAlertRules: Array.isArray(next.priceAlertRules) ? next.priceAlertRules : [],
    soundAlertsEnabled: Boolean(next.soundAlertsEnabled),
    monitoringEnabled: Boolean(next.monitoringEnabled ?? true),
    refreshIntervalMinutes: Number(next.refreshIntervalMinutes ?? 15),
    notificationCooldownMinutes: Number(next.notificationCooldownMinutes ?? 60),
    webhookEnabled: Boolean(next.webhookEnabled),
    webhookUrl: typeof next.webhookUrl === 'string' ? next.webhookUrl : '',
    webhookType:
      typeof next.webhookType === 'string'
        ? (next.webhookType as ScreenerConfig['webhookType'])
        : 'generic',
  }
}

function normalizeSnapshotPayload(payload: SnapshotPayload): SnapshotPayload {
  return {
    ...payload,
    config: normalizeConfigPayload(payload.config as unknown as Record<string, unknown>),
    results: Array.isArray(payload.results) ? payload.results : [],
    aiOverview: payload.aiOverview
      ? {
          ...payload.aiOverview,
          timeframeStats: Array.isArray(payload.aiOverview.timeframeStats)
            ? payload.aiOverview.timeframeStats
            : [],
          sampleSignals: Array.isArray(payload.aiOverview.sampleSignals)
            ? payload.aiOverview.sampleSignals
            : [],
        }
      : null,
    recentAlerts: Array.isArray(payload.recentAlerts) ? payload.recentAlerts : [],
    strategyRuns: Array.isArray(payload.strategyRuns) ? payload.strategyRuns : [],
  }
}

function normalizeResultsPayload(payload: ResultsResponse): ResultsResponse {
  return {
    ...payload,
    items: Array.isArray(payload.items) ? payload.items : [],
  }
}

function normalizeStrategyPresetsPayload(payload: StrategyPresetsResponse): StrategyPresetsResponse {
  return {
    ...payload,
    items: Array.isArray(payload.items)
      ? payload.items.map((item) => ({
          ...item,
          selectedTimeframes: Array.isArray(item.selectedTimeframes)
            ? item.selectedTimeframes
            : ['15m', '1H', '2H', '3H', '4H'],
          conditions: Array.isArray(item.conditions) ? item.conditions : [],
        }))
      : [],
  }
}

function normalizeWatchlistPayload(payload: WatchlistResponse): WatchlistResponse {
  return {
    ...payload,
    items: Array.isArray(payload.items) ? payload.items : [],
  }
}

function buildQuery(params: ResultsQuery) {
  const search = new URLSearchParams()

  if (params.page) {
    search.set('page', String(params.page))
  }

  if (params.pageSize) {
    search.set('pageSize', String(params.pageSize))
  }

  if (params.keyword) {
    search.set('keyword', params.keyword)
  }

  if (params.bars) {
    search.set('bars', params.bars)
  }

  if (params.patterns) {
    search.set('patterns', params.patterns)
  }

  if (params.onlyMatched !== undefined) {
    search.set('onlyMatched', String(params.onlyMatched))
  }

  if (params.sortBy) {
    search.set('sortBy', params.sortBy)
  }

  if (params.sortOrder) {
    search.set('sortOrder', params.sortOrder)
  }

  return search.toString()
}

export async function fetchSnapshot(init?: RequestInit) {
  const payload = await request<SnapshotPayload>('/api/snapshot', init)
  return normalizeSnapshotPayload(payload)
}

export async function fetchResults(params: ResultsQuery, init?: RequestInit) {
  const query = buildQuery(params)
  const payload = await request<ResultsResponse>(`/api/results${query ? `?${query}` : ''}`, init)
  return normalizeResultsPayload(payload)
}

export function fetchChart(
  instId: string,
  bar: string,
  limit: number,
  init?: RequestInit,
) {
  const search = new URLSearchParams({
    bar,
    limit: String(limit),
  })

  return request<ChartResponse>(
    `/api/chart/${encodeURIComponent(instId)}?${search}`,
    init,
  )
}

export async function saveSettings(payload: UpdateConfigPayload) {
  const response = await request<SnapshotPayload>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  return normalizeSnapshotPayload(response)
}

export async function triggerScan() {
  const response = await request<SnapshotPayload>('/api/scan/run', {
    method: 'POST',
  })
  return normalizeSnapshotPayload(response)
}

export async function toggleMonitor(enabled: boolean) {
  const response = await request<SnapshotPayload>('/api/monitor/toggle', {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  })
  return normalizeSnapshotPayload(response)
}

export function fetchAlerts() {
  return request<AlertsResponse>('/api/alerts')
}

export function fetchLlmHistory(params?: {
  type?: 'all' | 'overview' | 'signal'
  keyword?: string
  limit?: number
}) {
  const search = new URLSearchParams()

  if (params?.type) {
    search.set('type', params.type)
  }

  if (params?.keyword) {
    search.set('keyword', params.keyword)
  }

  if (params?.limit) {
    search.set('limit', String(params.limit))
  }

  return request<LlmHistoryResponse>(`/api/llm-history${search.size ? `?${search}` : ''}`)
}

export async function fetchStrategyPresets() {
  const payload = await request<StrategyPresetsResponse>('/api/strategy-presets')
  return normalizeStrategyPresetsPayload(payload)
}

export function saveStrategyPreset(payload: Record<string, unknown>) {
  return request('/api/strategy-presets', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function fetchWatchlist() {
  const payload = await request<WatchlistResponse>('/api/watchlist')
  return normalizeWatchlistPayload(payload)
}

export function toggleWatchlist(instId: string, note = '') {
  return request<{ added: boolean; items: Array<{ instId: string; note: string; createdAt: string }> }>(
    '/api/watchlist/toggle',
    {
      method: 'POST',
      body: JSON.stringify({ instId, note }),
    },
  )
}

export async function testWebhook() {
  const response = await fetch(buildApiUrl('/api/alerts/test'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
  })

  const payload = (await response.json()) as { ok: boolean; message?: string }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.message ?? '测试提醒失败')
  }

  return payload
}


