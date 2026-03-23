import type {
  AlertsResponse,
  ChartResponse,
  LlmHistoryResponse,
  ResultsQuery,
  ResultsResponse,
  SnapshotPayload,
  StrategyPresetsResponse,
  UpdateConfigPayload,
  WatchlistResponse,
} from '../shared/types'

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

export function fetchSnapshot(init?: RequestInit) {
  return request<SnapshotPayload>('/api/snapshot', init)
}

export function fetchResults(params: ResultsQuery, init?: RequestInit) {
  const query = buildQuery(params)
  return request<ResultsResponse>(`/api/results${query ? `?${query}` : ''}`, init)
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

export function saveSettings(payload: UpdateConfigPayload) {
  return request<SnapshotPayload>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function triggerScan() {
  return request<SnapshotPayload>('/api/scan/run', {
    method: 'POST',
  })
}

export function toggleMonitor(enabled: boolean) {
  return request<SnapshotPayload>('/api/monitor/toggle', {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  })
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

export function fetchStrategyPresets() {
  return request<StrategyPresetsResponse>('/api/strategy-presets')
}

export function saveStrategyPreset(payload: Record<string, unknown>) {
  return request('/api/strategy-presets', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function fetchWatchlist() {
  return request<WatchlistResponse>('/api/watchlist')
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
  const response = await fetch('/api/alerts/test', {
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
