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
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  RefreshCcw,
  Save,
  Send,
  Settings2,
  Siren,
  Star,
} from 'lucide-react'

import './App.css'

import {
  fetchChart,
  fetchResults,
  fetchSnapshot,
  saveSettings,
  testWebhook,
  toggleWatchlist as toggleWatchlistApi,
  toggleMonitor,
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
  TIMEFRAME_DEFINITIONS,
  type TimeframeKey,
} from '../shared/timeframes'
import type {
  AlertStatus,
  ChartCandle,
  ChartResponse,
  ScreenerConfig,
  ScreenerResult,
  SnapshotPayload,
  ResultsResponse,
} from '../shared/types'

function cloneConfig(config: ScreenerConfig) {
  return {
    ...config,
    selectedTimeframes: [...config.selectedTimeframes],
  }
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

function Flag({ active, label }: { active: boolean; label: string }) {
  return <span className={active ? 'flag flag-active' : 'flag'}>{label}</span>
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

const PAGE_SIZE = 25

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
  const [liveConnectionState, setLiveConnectionState] = useState<
    'idle' | 'connecting' | 'open' | 'reconnecting'
  >('idle')
  const [isBusy, setIsBusy] = useState(false)
  const [isTestingWebhook, setIsTestingWebhook] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState(
    typeof Notification === 'undefined' ? 'denied' : Notification.permission,
  )
  const [lastNotifiedSignatures, setLastNotifiedSignatures] = useState<string[]>([])
  const snapshotRequestRef = useRef<AbortController | null>(null)
  const resultsRequestRef = useRef<AbortController | null>(null)

  const deferredSearchText = useDeferredValue(searchText.trim())
  const selectedBarsKey = draftConfig?.selectedTimeframes.join(',') ?? ''
  const liveFastMaPeriod = snapshot?.config.fastMaPeriod ?? draftConfig?.fastMaPeriod ?? 5
  const liveSlowMaPeriod = snapshot?.config.slowMaPeriod ?? draftConfig?.slowMaPeriod ?? 20
  const liveChartCandles = snapshot?.config.chartCandles ?? draftConfig?.chartCandles ?? 80
  // snapshot 只跟随后台扫描刷新，实时行情只更新当前页面状态，避免触发全量重拉。
  const snapshotResultsVersion = snapshot
    ? `${snapshot.status.lastSuccessfulAt ?? 'none'}:${snapshot.results.length}`
    : null
  const realtimeSubscriptionKey = useMemo(() => {
    const instrumentIds = [...new Set((resultsResponse?.items ?? []).map((item) => item.instId))]
      .sort()
      .join('|')
    const selectedKey = selectedResult
      ? `${selectedResult.instId}:${selectedResult.timeframe}`
      : 'none'

    return `${instrumentIds}::${selectedKey}`
  }, [resultsResponse?.items, selectedResult?.instId, selectedResult?.timeframe])
  const realtimeArgs = useMemo(
    () => buildRealtimeSubscriptionArgs(resultsResponse?.items ?? [], selectedResult),
    [realtimeSubscriptionKey],
  )
  const realtimeArgsKey = useMemo(
    () => buildRealtimeArgsKey(realtimeArgs),
    [realtimeArgs],
  )

  function isAbortError(error: unknown) {
    return (
      (typeof DOMException !== 'undefined' &&
        error instanceof DOMException &&
        error.name === 'AbortError') ||
      (error instanceof Error && error.name === 'AbortError')
    )
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

    setDraftConfig({
      ...draftConfig,
      selectedTimeframes: nextTimeframes,
    })
    setCurrentPage(1)
  }

  const loadSnapshot = useEffectEvent(async (silent = false) => {
    const controller = new AbortController()
    snapshotRequestRef.current?.abort()
    snapshotRequestRef.current = controller

    try {
      if (!silent) {
        setIsBusy(true)
      }

      const nextSnapshot = await fetchSnapshot({
        signal: controller.signal,
      })

      if (controller.signal.aborted) {
        return
      }

      startTransition(() => {
        setSnapshot(nextSnapshot)
        setDraftConfig((current) => current ?? cloneConfig(nextSnapshot.config))
        setConnectionState('ok')
      })
    } catch (error) {
      if (isAbortError(error)) {
        return
      }

      if (!silent) {
        setMessage(error instanceof Error ? error.message : '加载仪表盘失败')
      }
      setConnectionState('degraded')
    } finally {
      if (snapshotRequestRef.current === controller) {
        snapshotRequestRef.current = null
      }

      if (!silent && snapshotRequestRef.current === null) {
        setIsBusy(false)
      }
    }
  })

  const loadResults = useEffectEvent(async (silent = false) => {
    const controller = new AbortController()
    resultsRequestRef.current?.abort()
    resultsRequestRef.current = controller

    try {
      const nextResults = await fetchResults({
        page: currentPage,
        pageSize: PAGE_SIZE,
        keyword: deferredSearchText,
        bars: selectedBarsKey,
        onlyMatched,
        sortBy: 'timeframe',
        sortOrder: 'asc',
      }, {
        signal: controller.signal,
      })

      if (controller.signal.aborted) {
        return
      }

      startTransition(() => {
        setResultsResponse(nextResults)
        setConnectionState('ok')
      })
    } catch (error) {
      if (isAbortError(error)) {
        return
      }

      if (!silent) {
        setMessage(error instanceof Error ? error.message : '加载结果失败')
      }
      setConnectionState('degraded')
    } finally {
      if (resultsRequestRef.current === controller) {
        resultsRequestRef.current = null
      }
    }
  })

  const notifyMatches = useEffectEvent((nextSnapshot: SnapshotPayload) => {
    if (
      typeof Notification === 'undefined' ||
      notificationPermission !== 'granted' ||
      nextSnapshot.results.length === 0
    ) {
      return
    }

    const nextSignatures = nextSnapshot.results.map((result) => result.signalKey)
    const newMatches = nextSnapshot.results.filter(
      (result) => !lastNotifiedSignatures.includes(result.signalKey),
    )

    newMatches.slice(0, 4).forEach((result) => {
      void new Notification(`命中 ${result.instId} ${result.timeframeLabel}`, {
        body: `现价 ${formatPrice(result.lastPrice)}，均线距离 ${result.convergencePct.toFixed(2)}%`,
      })
    })

    setLastNotifiedSignatures(nextSignatures)
  })

  useEffect(() => {
    void (async () => {
      await loadSnapshot(false)
    })()

    const timer = window.setInterval(() => {
      void loadSnapshot(true)
    }, 30_000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    return () => {
      snapshotRequestRef.current?.abort()
      resultsRequestRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!snapshot || !snapshotResultsVersion) {
      return
    }

    notifyMatches(snapshot)
  }, [snapshot, snapshotResultsVersion])

  useEffect(() => {
    if (!snapshotResultsVersion) {
      return
    }

    void loadResults(true)
  }, [currentPage, deferredSearchText, onlyMatched, selectedBarsKey, snapshotResultsVersion])

  useEffect(() => {
    if (!selectedResult) {
      setSelectedChart(null)
      setChartError(null)
      return
    }

    setSelectedChart({
      item: selectedResult,
      candles: selectedResult.chart,
      latestSignal: `${selectedResult.instId} ${selectedResult.timeframeLabel}`,
    })
    setChartError(null)

    const controller = new AbortController()

    void (async () => {
      try {
        setIsChartLoading(true)
        const chartResponse = await fetchChart(
          selectedResult.instId,
          selectedResult.timeframe,
          snapshot?.config.chartCandles ?? 80,
          {
            signal: controller.signal,
          },
        )

        if (controller.signal.aborted) {
          return
        }

        setSelectedChart(chartResponse)

        if (chartResponse.item) {
          setSelectedResult(chartResponse.item)
          setResultsResponse((current) =>
            current
              ? {
                  ...current,
                  items: current.items.map((item) =>
                    item.signalKey === chartResponse.item?.signalKey
                      ? chartResponse.item
                      : item,
                  ),
                }
              : current,
          )
        }
      } catch (error) {
        if (isAbortError(error)) {
          return
        }

        setChartError(error instanceof Error ? error.message : '图表加载失败')
      } finally {
        if (!controller.signal.aborted) {
          setIsChartLoading(false)
        }
      }
    })()

    return () => {
      controller.abort()
    }
  }, [selectedResult?.signalKey, snapshot?.config.chartCandles])

  useEffect(() => {
    if (realtimeArgs.length === 0) {
      setLiveConnectionState('idle')
      return
    }

    let socket: WebSocket | null = null
    let pingTimer: number | null = null
    let reconnectTimer: number | null = null
    let stopped = false
    let urlIndex = 0

    const clearTimers = () => {
      if (pingTimer !== null) {
        window.clearInterval(pingTimer)
      }

      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
      }
    }

    const updateLivePrices = (updates: Array<{ instId: string; lastPrice: number }>) => {
      if (updates.length === 0) {
        return
      }

      const priceMap = new Map(updates.map((item) => [item.instId, item.lastPrice]))

      setResultsResponse((current) => {
        if (!current) {
          return current
        }

        let changed = false
        const items = current.items.map((item) => {
          const nextPrice = priceMap.get(item.instId)

          if (nextPrice === undefined || nextPrice === item.lastPrice) {
            return item
          }

          changed = true
          return { ...item, lastPrice: nextPrice }
        })

        return changed ? { ...current, items } : current
      })
      setSelectedResult((current) => {
        if (!current) {
          return current
        }

        const nextPrice = priceMap.get(current.instId)

        if (nextPrice === undefined || nextPrice === current.lastPrice) {
          return current
        }

        return { ...current, lastPrice: nextPrice }
      })
      setSelectedChart((current) => {
        if (!current?.item) {
          return current
        }

        const nextPrice = priceMap.get(current.item.instId)

        if (nextPrice === undefined || nextPrice === current.item.lastPrice) {
          return current
        }

        return {
          ...current,
          item: {
            ...current.item,
            lastPrice: nextPrice,
          },
        }
      })
    }

    const updateLiveCandles = (
      updates: Array<{
        instId: string
        timeframe: TimeframeKey
        candle: ChartCandle
      }>,
    ) => {
      if (updates.length === 0) {
        return
      }

      const candleMap = new Map(
        updates.map((update) => [`${update.instId}:${update.timeframe}`, update.candle]),
      )

      const applyCandle = (result: ScreenerResult) => {
        const match = candleMap.get(`${result.instId}:${result.timeframe}`)

        if (!match) {
          return result
        }

        const nextChart = mergeRealtimeCandleSeries(
          result.chart,
          match,
          liveFastMaPeriod,
          liveSlowMaPeriod,
          liveChartCandles,
        )

        if (result.lastPrice === match.close && nextChart === result.chart) {
          return result
        }

        return {
          ...result,
          lastPrice: match.close,
          chart: nextChart,
        }
      }

      setResultsResponse((current) => {
        if (!current) {
          return current
        }

        let changed = false
        const items = current.items.map((item) => {
          const nextItem = applyCandle(item)

          if (nextItem !== item) {
            changed = true
          }

          return nextItem
        })

        return changed ? { ...current, items } : current
      })
      setSelectedResult((current) => (current ? applyCandle(current) : current))
      setSelectedChart((current) => {
        if (!current?.item) {
          return current
        }

        const nextItem = applyCandle(current.item)
        const nextCandles = applyCandle({
          ...current.item,
          chart: current.candles,
        }).chart

        if (nextItem === current.item && nextCandles === current.candles) {
          return current
        }

        return {
          ...current,
          item: nextItem,
          candles: nextCandles,
        }
      })
    }

    const connect = () => {
      if (stopped) {
        return
      }

      const url = GATE_PUBLIC_WS_URLS[urlIndex % GATE_PUBLIC_WS_URLS.length]
      setLiveConnectionState(urlIndex === 0 ? 'connecting' : 'reconnecting')
      socket = new WebSocket(url)

      socket.onopen = () => {
        if (!socket) {
          return
        }

        setLiveConnectionState('open')
        realtimeArgs.forEach((arg) => {
          socket?.send(buildSubscriptionMessage(arg))
        })
        pingTimer = window.setInterval(() => {
          socket?.send(buildPingMessage())
        }, 20_000)
      }

      socket.onmessage = (event) => {
        const payload =
          typeof event.data === 'string'
            ? parseRealtimeMessage(event.data)
            : parseRealtimeMessage(String(event.data))

        updateLivePrices(payload.tickers)
        updateLiveCandles(payload.candles)
      }

      socket.onclose = () => {
        clearTimers()

        if (stopped) {
          return
        }

        urlIndex += 1
        reconnectTimer = window.setTimeout(connect, 1_500)
      }

      socket.onerror = () => {
        socket?.close()
      }
    }

    connect()

    return () => {
      stopped = true
      clearTimers()
      socket?.close()
    }
  }, [
    realtimeArgsKey,
    liveChartCandles,
    liveFastMaPeriod,
    liveSlowMaPeriod,
  ])

  const pageCount = useMemo(() => {
    if (!resultsResponse) {
      return 1
    }

    return Math.max(1, Math.ceil(resultsResponse.total / resultsResponse.pageSize))
  }, [resultsResponse])

  const isDirty =
    Boolean(snapshot && draftConfig) &&
    JSON.stringify(snapshot?.config) !== JSON.stringify(draftConfig)
  const aiOverview = snapshot?.aiOverview ?? null
  const modalItem = selectedChart?.item ?? selectedResult
  const modalCandles = selectedChart?.candles ?? selectedResult?.chart ?? []

  async function handleSave() {
    if (!draftConfig) {
      return
    }

    try {
      setIsBusy(true)
      const nextSnapshot = await saveSettings(draftConfig)
      setSnapshot(nextSnapshot)
      setDraftConfig(cloneConfig(nextSnapshot.config))
      setCurrentPage(1)
      await loadResults(false)
      setMessage('配置已保存，新的扫描参数已生效。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleManualRefresh() {
    try {
      setIsBusy(true)
      const nextSnapshot = await triggerScan()
      setSnapshot(nextSnapshot)
      setCurrentPage(1)
      await loadResults(false)
      setMessage('已触发一次全量扫描。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '手动刷新失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleMonitorToggle(enabled: boolean) {
    try {
      setIsBusy(true)
      const nextSnapshot = await toggleMonitor(enabled)
      setSnapshot(nextSnapshot)
      setDraftConfig(cloneConfig(nextSnapshot.config))
      setMessage(enabled ? '自动监控已开启。' : '自动监控已暂停。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '监控状态切换失败')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleNotificationPermission() {
    if (typeof Notification === 'undefined') {
      return
    }

    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
  }

  async function handleTestWebhook() {
    try {
      setIsTestingWebhook(true)
      await testWebhook()
      setMessage('测试提醒已发送。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '测试提醒失败')
    } finally {
      setIsTestingWebhook(false)
    }
  }

  async function handleToggleWatchlist(instId: string) {
    try {
      await toggleWatchlistApi(instId)
      setResultsResponse((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.instId === instId
                  ? { ...item, watchlisted: !item.watchlisted }
                  : item,
              ),
            }
          : current,
      )
      setSnapshot((current) =>
        current
          ? {
              ...current,
              results: current.results.map((item) =>
                item.instId === instId
                  ? { ...item, watchlisted: !item.watchlisted }
                  : item,
              ),
            }
          : current,
      )
      setSelectedResult((current) =>
        current?.instId === instId
          ? { ...current, watchlisted: !current.watchlisted }
          : current,
      )
      setMessage('自选列表已更新。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '自选更新失败')
    }
  }

  if (!snapshot || !draftConfig || !resultsResponse) {
    return (
      <main className="app-shell loading-shell">
        <LoaderCircle className="spin" />
        <p>正在装载 Gate 永续筛选面板...</p>
      </main>
    )
  }

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
          onClick={() => {
            setSelectedResult(null)
            setActiveView('llm-history')
          }}
        >
          <Bot size={16} />
          LLM 历史分析
        </button>
      </nav>

      {activeView === 'screener' ? (
        <>
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Gate Perpetual Radar</p>
          <h1>Gate 永续合约多周期形态筛选助手</h1>
          <p className="hero-text">
            当前版本使用 <code>规则引擎</code> 做首轮多周期筛选，规则默认为
            <code>MA5 / MA20 收拢 + MA5 抬头 + K线实体上穿 MA5</code>。
            {snapshot.llmAnalysisEnabled
              ? ' Qwen 已接入，打开图表弹窗时会对命中结果做二次摘要分析并缓存。'
              : ' 外部 LLM 还未启用，所以你现在看到的命中结果都来自规则判断。'}
          </p>
          <div className="hero-actions">
            <button className="primary-button" onClick={handleManualRefresh} disabled={isBusy}>
              <RefreshCcw size={18} />
              立即扫描
            </button>
            <button
              className="secondary-button"
              onClick={handleNotificationPermission}
              disabled={notificationPermission === 'granted'}
            >
              {notificationPermission === 'granted' ? <BellRing size={18} /> : <Bell size={18} />}
              {notificationPermission === 'granted' ? '浏览器提醒已开启' : '开启浏览器提醒'}
            </button>
          </div>
        </div>

        <div className="hero-status">
          <div className="status-row">
            <span>监控状态</span>
            <strong>{snapshot.config.monitoringEnabled ? '运行中' : '已暂停'}</strong>
          </div>
          <div className="status-row">
            <span>最近刷新</span>
            <strong>
              {snapshot.status.lastSuccessfulAt
                ? formatDateTime(snapshot.status.lastSuccessfulAt)
                : '等待首轮扫描'}
            </strong>
          </div>
          <div className="status-row">
            <span>分析引擎</span>
            <strong>{snapshot.llmAnalysisEnabled ? 'Qwen / LLM 已启用' : '规则引擎（LLM 未启用）'}</strong>
          </div>
          <div className="status-row">
            <span>最近提醒</span>
            <strong>
              {snapshot.status.lastAlertedAt
                ? `${formatDateTime(snapshot.status.lastAlertedAt)} / ${snapshot.status.lastAlertCount} 条`
                : '暂无'}
            </strong>
          </div>
        </div>
      </section>

      <section className="ai-overview-panel">
        <div className="ai-overview-header">
          <div>
            <p className="eyebrow">15-Min AI Brief</p>
            <h2>15 分钟 AI 变化总览</h2>
            <p className="ai-overview-subtitle">
              每次扫描完成后，系统都会先生成本轮变化统计，再由 Qwen 补充成更自然的首页摘要；在接通钉钉前，这里先作为主页面顶部播报区。
            </p>
          </div>
          <div className="ai-overview-meta">
            <span
              className={
                aiOverview?.status === 'ready'
                  ? 'status-dot'
                  : 'status-dot status-dot-off'
              }
            >
              {aiOverview?.status === 'ready'
                ? aiOverview.source === 'llm'
                  ? 'Qwen 总览已生成'
                  : '规则摘要已生成'
                : aiOverview?.status === 'pending'
                  ? 'Qwen 总览生成中'
                  : aiOverview?.status === 'error'
                    ? 'Qwen 总览生成失败'
                    : 'AI 总览未启用'}
            </span>
            <span>
              基于扫描：
              {aiOverview?.basedOnRunAt ? formatDateTime(aiOverview.basedOnRunAt) : '等待首轮扫描'}
            </span>
            <span>
              生成时间：
              {aiOverview?.generatedAt ? formatDateTime(aiOverview.generatedAt) : '尚未生成'}
            </span>
          </div>
        </div>

        <div className="ai-overview-chip-row">
          <span className="summary-chip">命中 {aiOverview?.totalMatches ?? 0} 条</span>
          <span className="summary-chip">新增 {aiOverview?.newMatches ?? 0} 条</span>
          <span className="summary-chip">消失 {aiOverview?.removedMatches ?? 0} 条</span>
          <span className="summary-chip">
            主导周期：{aiOverview?.leadingTimeframeLabel ?? '暂无'}
          </span>
        </div>

        <div className="ai-overview-card">
          <div className="summary-chip">
            <Bot size={14} />
            {aiOverview?.status === 'pending'
              ? 'Qwen 正在根据本轮扫描生成首页总览...'
              : aiOverview?.status === 'error'
                ? 'Qwen 未成功生成本轮总览，当前展示规则摘要'
                : aiOverview?.source === 'llm'
                  ? '当前显示 Qwen 总览'
                  : '当前显示规则摘要'}
          </div>
          <p className="ai-overview-summary">
            {aiOverview?.summary ??
              '当前还没有可展示的 15 分钟总览，等待首轮扫描完成后会自动出现。'}
          </p>
          {aiOverview?.error ? (
            <p className="ai-overview-error">生成异常：{aiOverview.error}</p>
          ) : null}
        </div>

        {aiOverview?.sampleSignals.length ? (
          <div className="ai-overview-samples">
            <span>代表标的</span>
            <div className="chip-grid">
              {aiOverview.sampleSignals.map((item) => (
                <span
                  key={`${item.instId}:${item.timeframe}`}
                  className="chip chip-active"
                >
                  {item.instId} · {item.timeframeLabel}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="top-toolbar">
        <div className="toolbar-meta">
          <span className={connectionState === 'ok' ? 'status-dot' : 'status-dot status-dot-off'}>
            {connectionState === 'ok' ? '服务连接正常' : '后台连接波动中'}
          </span>
          <span
            className={
              liveConnectionState === 'open'
                ? 'status-dot'
                : 'status-dot status-dot-off'
            }
          >
            {liveConnectionState === 'open'
              ? '实时行情已连接'
              : liveConnectionState === 'reconnecting'
                ? '实时行情重连中'
                : liveConnectionState === 'connecting'
                  ? '实时行情连接中'
                  : '实时行情未连接'}
          </span>
          <span>下次调度：{snapshot.status.nextScheduledRunAt ? formatDateTime(snapshot.status.nextScheduledRunAt) : '未启用'}</span>
        </div>
        <label className="monitor-toggle" htmlFor="monitor-toggle">
          <input
            id="monitor-toggle"
            name="monitor_toggle"
            type="checkbox"
            checked={snapshot.config.monitoringEnabled}
            onChange={(event) => void handleMonitorToggle(event.target.checked)}
          />
          <span>自动监控</span>
        </label>
      </section>

      <section className="stats-grid">
        <StatCard
          label="命中结果"
          value={String(snapshot.stats.matchedRows)}
          hint="统一表格展示当前命中项"
        />
        <StatCard
          label="扫描合约"
          value={String(snapshot.stats.scannedInstruments)}
          hint="Gate 永续合约实时抓取"
        />
        <StatCard
          label="抓取耗时"
          value={formatDuration(snapshot.stats.durationMs)}
          hint={`${snapshot.stats.rawBarsFetched} 个周期请求`}
        />
        <StatCard
          label="分析行数"
          value={String(snapshot.stats.analyzedRows)}
          hint="支持 onlyMatched=false 查看全部分析结果"
        />
      </section>

      <section className="workspace">
        <aside className="control-panel">
          <div className="panel-heading">
            <Settings2 size={18} />
            <h2>筛选参数</h2>
          </div>

          <label className="field" htmlFor="match-mode">
            <span>命中逻辑</span>
            <select
              id="match-mode"
              name="match_mode"
              value={draftConfig.matchMode}
              onChange={(event) =>
                setDraftConfig({
                  ...draftConfig,
                  matchMode: event.target.value as ScreenerConfig['matchMode'],
                })
              }
            >
              <option value="A_B_C">A and B and C</option>
              <option value="A_B">A and B</option>
              <option value="B_C">B and C</option>
              <option value="A_ONLY">A only</option>
            </select>
          </label>

          <label className="field" htmlFor="ma-up-strategy">
            <span>MA5 抬头策略</span>
            <select
              id="ma-up-strategy"
              name="ma_up_strategy"
              value={draftConfig.maUpStrategy}
              onChange={(event) =>
                setDraftConfig({
                  ...draftConfig,
                  maUpStrategy: event.target.value as ScreenerConfig['maUpStrategy'],
                })
              }
            >
              <option value="stair_up">MA5[-1] &gt; MA5[-2] 且 MA5[-2] &gt;= MA5[-3]</option>
              <option value="strict_positive">slope &gt; 0</option>
            </select>
          </label>

          <div className="field">
            <span>筛选周期</span>
            <div className="chip-grid" id="timeframes">
              {TIMEFRAME_DEFINITIONS.map((timeframe) => (
                <button
                  key={timeframe.key}
                  className={
                    draftConfig.selectedTimeframes.includes(timeframe.key)
                      ? 'chip chip-active'
                      : 'chip'
                  }
                  onClick={() => toggleTimeframe(timeframe.key)}
                  type="button"
                >
                  {timeframe.label}
                </button>
              ))}
            </div>
            <small className="note-line">
              保存后会同步影响后端扫描范围；未保存时也会先作为当前表格过滤条件。
            </small>
          </div>

          <div className="field-row">
            <label className="field" htmlFor="fast-ma">
              <span>快线 MA</span>
              <input
                id="fast-ma"
                name="fast_ma"
                type="number"
                min={2}
                max={60}
                value={draftConfig.fastMaPeriod}
                onChange={(event) =>
                  setDraftConfig({
                    ...draftConfig,
                    fastMaPeriod: Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="field" htmlFor="slow-ma">
              <span>慢线 MA</span>
              <input
                id="slow-ma"
                name="slow_ma"
                type="number"
                min={5}
                max={240}
                value={draftConfig.slowMaPeriod}
                onChange={(event) =>
                  setDraftConfig({
                    ...draftConfig,
                    slowMaPeriod: Number(event.target.value),
                  })
                }
              />
            </label>
          </div>

          <div className="field-row">
            <label className="field" htmlFor="convergence-threshold">
              <span>收拢阈值 %</span>
              <input
                id="convergence-threshold"
                name="convergence_threshold"
                type="number"
                min={0.1}
                max={10}
                step={0.1}
                value={draftConfig.convergenceThresholdPct}
                onChange={(event) =>
                  setDraftConfig({
                    ...draftConfig,
                    convergenceThresholdPct: Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="field" htmlFor="ma-slope-lookback">
              <span>抬头回看根数</span>
              <input
                id="ma-slope-lookback"
                name="ma_slope_lookback"
                type="number"
                min={1}
                max={10}
                value={draftConfig.maSlopeLookback}
                onChange={(event) =>
                  setDraftConfig({
                    ...draftConfig,
                    maSlopeLookback: Number(event.target.value),
                  })
                }
              />
            </label>
          </div>

          <label className="toggle-card" htmlFor="secondary-convergence-enabled">
            <div>
              <span>附加 10/30 收拢条件</span>
              <small>开启后可把 MA10 / MA30 收拢加入筛选，并选择和 5/20 的关系</small>
            </div>
            <input
              id="secondary-convergence-enabled"
              name="secondary_convergence_enabled"
              type="checkbox"
              checked={draftConfig.secondaryConvergenceEnabled}
              onChange={(event) =>
                setDraftConfig({
                  ...draftConfig,
                  secondaryConvergenceEnabled: event.target.checked,
                })
              }
            />
          </label>

          {draftConfig.secondaryConvergenceEnabled ? (
            <>
              <div className="field-row">
                <label className="field" htmlFor="secondary-fast-ma">
                  <span>附加快线 MA</span>
                  <input
                    id="secondary-fast-ma"
                    name="secondary_fast_ma"
                    type="number"
                    min={2}
                    max={120}
                    value={draftConfig.secondaryFastMaPeriod}
                    onChange={(event) =>
                      setDraftConfig({
                        ...draftConfig,
                        secondaryFastMaPeriod: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="field" htmlFor="secondary-slow-ma">
                  <span>附加慢线 MA</span>
                  <input
                    id="secondary-slow-ma"
                    name="secondary_slow_ma"
                    type="number"
                    min={5}
                    max={240}
                    value={draftConfig.secondarySlowMaPeriod}
                    onChange={(event) =>
                      setDraftConfig({
                        ...draftConfig,
                        secondarySlowMaPeriod: Number(event.target.value),
                      })
                    }
                  />
                </label>
              </div>
              <label className="field" htmlFor="convergence-relation">
                <span>5/20 与附加收拢关系</span>
                <select
                  id="convergence-relation"
                  name="convergence_relation"
                  value={draftConfig.convergenceRelation}
                  onChange={(event) =>
                    setDraftConfig({
                      ...draftConfig,
                      convergenceRelation:
                        event.target.value as ScreenerConfig['convergenceRelation'],
                    })
                  }
                >
                  <option value="and">同时满足</option>
                  <option value="or">任一满足</option>
                </select>
              </label>
            </>
          ) : null}

          <label className="toggle-card" htmlFor="cross-slope-enabled">
            <div>
              <span>实体上穿斜率过滤</span>
              <small>要求 MA5 严格处于开盘价和收盘价之间，同时过滤掉斜率过平、只是贴着均线站上的情况</small>
            </div>
            <input
              id="cross-slope-enabled"
              name="cross_slope_enabled"
              type="checkbox"
              checked={draftConfig.crossSlopeEnabled}
              onChange={(event) =>
                setDraftConfig({
                  ...draftConfig,
                  crossSlopeEnabled: event.target.checked,
                })
              }
            />
          </label>

          <label className="field" htmlFor="cross-slope-threshold">
            <span>实体上穿最小斜率 %</span>
            <input
              id="cross-slope-threshold"
              name="cross_slope_threshold"
              type="number"
              min={0}
              max={10}
              step={0.01}
              value={draftConfig.crossSlopeThresholdPct}
              onChange={(event) =>
                setDraftConfig({
                  ...draftConfig,
                  crossSlopeThresholdPct: Number(event.target.value),
                })
              }
            />
          </label>

          <div className="field-row">
            <label className="field" htmlFor="fetch-limit">
              <span>抓取根数</span>
              <input
                id="fetch-limit"
                name="fetch_limit"
                type="number"
                min={60}
                max={300}
                value={draftConfig.fetchLimit}
                onChange={(event) =>
                  setDraftConfig({
                    ...draftConfig,
                    fetchLimit: Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="field" htmlFor="chart-candles">
              <span>图表显示根数</span>
              <input
                id="chart-candles"
                name="chart_candles"
                type="number"
                min={24}
                max={120}
                value={draftConfig.chartCandles}
                onChange={(event) =>
                  setDraftConfig({
                    ...draftConfig,
                    chartCandles: Number(event.target.value),
                  })
                }
              />
            </label>
          </div>

          <div className="field-row">
            <label className="field" htmlFor="refresh-interval">
              <span>轮询间隔(分钟)</span>
              <input
                id="refresh-interval"
                name="refresh_interval"
                type="number"
                min={15}
                max={240}
                step={15}
                value={draftConfig.refreshIntervalMinutes}
                onChange={(event) =>
                  setDraftConfig({
                    ...draftConfig,
                    refreshIntervalMinutes: Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="field" htmlFor="cooldown-minutes">
              <span>提醒冷却(分钟)</span>
              <input
                id="cooldown-minutes"
                name="cooldown_minutes"
                type="number"
                min={15}
                max={1440}
                step={15}
                value={draftConfig.notificationCooldownMinutes}
                onChange={(event) =>
                  setDraftConfig({
                    ...draftConfig,
                    notificationCooldownMinutes: Number(event.target.value),
                  })
                }
              />
            </label>
          </div>

          <div className="panel-heading">
            <Siren size={18} />
            <h2>提醒设置</h2>
          </div>

          <label className="toggle-card" htmlFor="webhook-enabled">
            <div>
              <span>启用 Webhook</span>
              <small>支持通用 JSON、企业微信、钉钉机器人</small>
            </div>
            <input
              id="webhook-enabled"
              name="webhook_enabled"
              type="checkbox"
              checked={draftConfig.webhookEnabled}
              onChange={(event) =>
                setDraftConfig({
                  ...draftConfig,
                  webhookEnabled: event.target.checked,
                })
              }
            />
          </label>

          <div className="field-row">
            <label className="field" htmlFor="webhook-type">
              <span>Webhook 类型</span>
              <select
                id="webhook-type"
                name="webhook_type"
                value={draftConfig.webhookType}
                onChange={(event) =>
                  setDraftConfig({
                    ...draftConfig,
                    webhookType: event.target.value as ScreenerConfig['webhookType'],
                  })
                }
              >
                <option value="generic">通用 JSON</option>
                <option value="wecom">企业微信</option>
                <option value="dingtalk">钉钉</option>
              </select>
            </label>
            <label className="field" htmlFor="monitor-switch-field">
              <span>监控开关</span>
              <input
                id="monitor-switch-field"
                name="monitor_switch_field"
                type="text"
                value={draftConfig.monitoringEnabled ? '开启' : '关闭'}
                readOnly
              />
            </label>
          </div>

          <label className="field" htmlFor="webhook-url">
            <span>Webhook 地址</span>
            <textarea
              id="webhook-url"
              name="webhook_url"
              rows={4}
              placeholder="https://..."
              value={draftConfig.webhookUrl}
              onChange={(event) =>
                setDraftConfig({
                  ...draftConfig,
                  webhookUrl: event.target.value,
                })
              }
            />
          </label>

          <div className="panel-actions">
            <button className="primary-button" onClick={handleSave} disabled={!isDirty || isBusy}>
              <Save size={18} />
              保存配置
            </button>
            <button
              className="secondary-button"
              onClick={handleTestWebhook}
              disabled={isTestingWebhook}
            >
              <Send size={18} />
              {isTestingWebhook ? '发送中...' : '测试提醒'}
            </button>
          </div>

          <p className="note">
            说明：当前版本已经保留 <code>3H = 1H 聚合</code>、<code>matchMode</code> 和
            <code>MA5 抬头策略</code>、<code>实体上穿斜率过滤</code>、<code>附加 10/30 收拢</code> 的可配置能力；
            {snapshot.llmAnalysisEnabled
              ? ' Qwen 已启用，命中后可在图表弹窗里查看二次分析摘要。'
              : ' 当前 Qwen 仍未启用，所以还不会生成“命中后二次分析摘要”。'}
          </p>
        </aside>

        <section className="result-panel">
          <div className="result-toolbar">
            <div>
              <h2>统一筛选结果</h2>
              <p>所有周期统一落在一张表里，支持分页、搜索和提醒状态查看。</p>
            </div>
            <div className="toolbar-filters">
              <label className="checkbox-row" htmlFor="only-matched">
                <input
                  id="only-matched"
                  name="only_matched"
                  type="checkbox"
                  checked={onlyMatched}
                  onChange={(event) => {
                    setOnlyMatched(event.target.checked)
                    setCurrentPage(1)
                  }}
                />
                <span>只显示命中项</span>
              </label>
              <input
                id="search-input"
                name="search"
                className="search-input"
                placeholder="搜索币种、instId 或交易品种"
                value={searchText}
                onChange={(event) => {
                  setSearchText(event.target.value)
                  setCurrentPage(1)
                }}
              />
            </div>
          </div>

          {message ? <div className="flash-message">{message}</div> : null}
          {connectionState === 'degraded' ? (
            <div className="error-banner">后台连接短暂波动，系统会自动继续轮询。</div>
          ) : null}

          <div className="result-meta">
            <span>总结果：{resultsResponse.total}</span>
            <span>当前页：{resultsResponse.page} / {pageCount}</span>
            <span>实时价和打开的图表来自 Gate WebSocket，信号确认仍以收盘K线为准</span>
          </div>

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
                {resultsResponse.items.length === 0 ? (
                  <tr>
                    <td colSpan={17} className="empty-cell">
                      当前条件下没有结果，请等待下一轮扫描或调整筛选参数。
                    </td>
                  </tr>
                ) : (
                  resultsResponse.items.map((result, index) => (
                    <tr key={result.signalKey}>
                      <td>{(resultsResponse.page - 1) * resultsResponse.pageSize + index + 1}</td>
                      <td>
                        <div className="symbol-cell">
                          <strong>{result.instrumentName}</strong>
                          <small>{result.instId}</small>
                          <div className="flag-stack">
                            <Flag active={result.trendFlags.primaryConverging} label="5/20收拢" />
                            {result.trendFlags.secondaryConverging !== null ? (
                              <Flag
                                active={result.trendFlags.secondaryConverging}
                                label="10/30收拢"
                              />
                            ) : null}
                            <Flag active={result.trendFlags.fastMaRising} label="抬头" />
                            <Flag
                              active={result.trendFlags.crossSlopeQualified}
                              label="斜率"
                            />
                            <Flag
                              active={result.trendFlags.priceCrossedFastMa}
                              label="实体上穿"
                            />
                          </div>
                        </div>
                      </td>
                      <td>
                        <button
                          className={result.watchlisted ? 'watchlist-button active' : 'watchlist-button'}
                          onClick={() => void handleToggleWatchlist(result.instId)}
                          type="button"
                          title={result.watchlisted ? '移出自选' : '加入自选'}
                        >
                          <Star size={14} fill={result.watchlisted ? 'currentColor' : 'none'} />
                        </button>
                      </td>
                      <td>{result.contractType}</td>
                      <td>{result.timeframeLabel}</td>
                      <td>{formatPrice(result.lastPrice)}</td>
                      <td>
                        <div className="metric-cell">
                          <strong>{result.aiRecommendationLabel ?? '--'}</strong>
                          <small>{result.aiRecommendationReason ?? '等待解释标签'}</small>
                        </div>
                      </td>
                      <td>{formatCompactNumber(result.marketCap?.marketCap)}</td>
                      <td>{result.marketCap?.marketCapRank ?? '--'}</td>
                      <td>{formatPrice(result.fastMa)}</td>
                      <td>{formatPrice(result.slowMa)}</td>
                      <td>
                        <div className="metric-cell">
                          <strong>5/20: {result.convergencePct.toFixed(2)}%</strong>
                          {result.secondaryConvergencePct !== null ? (
                            <small>10/30: {result.secondaryConvergencePct.toFixed(2)}%</small>
                          ) : null}
                        </div>
                      </td>
                      <td
                        className={
                          result.maTrendDirection === 'up'
                            ? 'positive'
                            : result.maTrendDirection === 'down'
                              ? 'negative'
                              : ''
                        }
                      >
                        <div className="trend-cell">
                          <strong>{result.maTrendDirection}</strong>
                          <small>{formatPercent(result.fastMaSlopePct)}</small>
                        </div>
                      </td>
                      <td>
                        <div className="metric-cell">
                          <strong>{result.trendFlags.priceCrossedFastMa ? '是' : '否'}</strong>
                          <small>实体斜率 {formatPercent(result.crossSlopePct)}</small>
                        </div>
                      </td>
                      <td>{formatDateTime(result.crossedAt)}</td>
                      <td><AlertBadge status={result.alertStatus} /></td>
                      <td>
                        <button
                          className="chart-button"
                          onClick={() => setSelectedResult(result)}
                          type="button"
                        >
                          <ChartIcon size={14} />
                          <div className="mini-chart">
                            <CandlestickChart candles={result.chart} compact />
                          </div>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="pagination-row">
            <button
              className="secondary-button"
              disabled={resultsResponse.page <= 1}
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            >
              <ChevronLeft size={16} />
              上一页
            </button>
            <span>第 {resultsResponse.page} 页，共 {pageCount} 页</span>
            <button
              className="secondary-button"
              disabled={resultsResponse.page >= pageCount}
              onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
            >
              下一页
              <ChevronRight size={16} />
            </button>
          </div>
        </section>
      </section>

      {selectedResult ? (
        <div className="modal-backdrop" onClick={() => setSelectedResult(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>
                  {modalItem?.instId} · {modalItem?.timeframeLabel}
                </h3>
                <p>
                  信号来源：规则引擎 / 提醒状态：
                  {modalItem ? <AlertBadge status={modalItem.alertStatus} /> : null}
                </p>
              </div>
              <button className="secondary-button" onClick={() => setSelectedResult(null)}>
                关闭
              </button>
            </div>
            <div className="modal-summary">
              <div className="summary-chip">
                <Bot size={14} />
                {snapshot.llmAnalysisEnabled
                  ? isChartLoading
                    ? 'Qwen 分析生成中...'
                    : modalItem?.llmSummary
                      ? 'Qwen 分析已生成'
                      : 'Qwen 已启用，暂无摘要'
                  : 'LLM 分析：未启用'}
              </div>
              <div className="summary-chip">
                MA距离：{modalItem?.convergencePct.toFixed(2)}%
              </div>
              {modalItem?.secondaryConvergencePct != null ? (
                <div className="summary-chip">
                  10/30距离：{modalItem?.secondaryConvergencePct.toFixed(2)}%
                </div>
              ) : null}
              <div className="summary-chip">
                MA5趋势：{modalItem?.maTrendDirection}
              </div>
              <div className="summary-chip">
                实体上穿斜率：{modalItem ? formatPercent(modalItem.crossSlopePct) : '--'}
              </div>
            </div>
            {snapshot.llmAnalysisEnabled ? (
              <div className="llm-summary-card">
                {chartError ? (
                  <p>{chartError}</p>
                ) : modalItem?.llmSummary ? (
                  <p>{modalItem.llmSummary}</p>
                ) : (
                  <p>这条命中信号还没有生成 Qwen 摘要，系统会在打开弹窗后自动尝试分析并缓存。</p>
                )}
              </div>
            ) : null}
            <CandlestickChart candles={modalCandles} />
          </div>
        </div>
      ) : null}
        </>
      ) : (
        <LlmHistoryPanel />
      )}
    </main>
  )
}

export default App
