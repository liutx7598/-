import { DEFAULT_CONFIG, EMPTY_STATS, EMPTY_STATUS } from './defaults'
import {
  analyzeMatchWithLlm,
  analyzeOverviewWithLlm,
  createRuleBasedOverview,
  isLlmAnalysisEnabled,
  type OverviewAnalysisInput,
} from './llm'
import {
  listLlmHistory,
  recordOverviewHistory,
  recordSignalSummaryHistory,
  syncRuntimeStateToLlmHistory,
} from './llm-history'
import { ScreenerEngine } from './screener'
import { MarketCapProvider } from './market-cap-provider'
import {
  loadConfig,
  loadRuntimeState,
  saveConfig,
  saveRuntimeState,
  sanitizeConfig,
  type RuntimeState,
} from './storage'
import {
  buildPriceChangeAlertMessage,
  sendTestWebhookAlert,
  sendWebhookAlert,
  sendWebhookPriceAlert,
} from './alerts'
import { StrategyPresetService } from './strategy-preset-service'
import { WatchlistService } from './watchlist-service'
import { TIMEFRAME_MAP, type TimeframeKey } from '../shared/timeframes'
import type {
  AiOverview,
  AlertRecord,
  AlertsResponse,
  ChartResponse,
  LlmHistoryResponse,
  ResultsQuery,
  ResultsResponse,
  RunReason,
  ScreenerConfig,
  ScreenerResult,
  SnapshotPayload,
  StrategyRunState,
  StrategyPresetsResponse,
  UpdateConfigPayload,
  WatchlistResponse,
} from '../shared/types'

function createEmptySnapshot(
  config: ScreenerConfig,
  aiOverview: AiOverview | null = null,
): SnapshotPayload {
  return {
    config,
    results: [],
    stats: EMPTY_STATS,
    status: EMPTY_STATUS,
    llmAnalysisEnabled: isLlmAnalysisEnabled(),
    aiOverview,
    recentAlerts: [],
  }
}

function getNextBoundary(intervalMinutes: number) {
  const currentTime = new Date()
  const nextTime = new Date(currentTime)
  nextTime.setSeconds(0, 0)

  const currentMinutes = currentTime.getMinutes()
  const remainder = currentMinutes % intervalMinutes
  const minutesToAdd = remainder === 0 ? intervalMinutes : intervalMinutes - remainder
  nextTime.setMinutes(currentMinutes + minutesToAdd)

  if (nextTime <= currentTime) {
    nextTime.setMinutes(nextTime.getMinutes() + intervalMinutes)
  }

  return nextTime
}

function normalizeBoolean(value: string | undefined, defaultValue: boolean) {
  if (value === undefined) {
    return defaultValue
  }

  return value !== 'false'
}

function compareResults(
  left: ScreenerResult,
  right: ScreenerResult,
  sortBy: ResultsQuery['sortBy'],
  sortOrder: ResultsQuery['sortOrder'],
) {
  const multiplier = sortOrder === 'desc' ? -1 : 1

  if (sortBy === 'lastPrice') {
    return (left.lastPrice - right.lastPrice) * multiplier
  }

  if (sortBy === 'fastMa') {
    return (left.fastMa - right.fastMa) * multiplier
  }

  if (sortBy === 'slowMa') {
    return (left.slowMa - right.slowMa) * multiplier
  }

  if (sortBy === 'convergencePct') {
    return (left.convergencePct - right.convergencePct) * multiplier
  }

  if (sortBy === 'fastMaSlopePct') {
    return (left.fastMaSlopePct - right.fastMaSlopePct) * multiplier
  }

  if (sortBy === 'crossedAt') {
    return (
      (Date.parse(left.crossedAt) - Date.parse(right.crossedAt)) * multiplier
    )
  }

  if (sortBy === 'timeframe') {
    return (
      (TIMEFRAME_MAP[left.timeframe].sortOrder - TIMEFRAME_MAP[right.timeframe].sortOrder) *
      multiplier
    )
  }

  return left.instId.localeCompare(right.instId) * multiplier
}

type OverviewInputWithTimeframes = Omit<OverviewAnalysisInput, 'timeframeStats'> & {
  timeframeStats: Array<{ timeframe: TimeframeKey; label: string; count: number }>
}

export class ScreenerService {
  private engine = new ScreenerEngine()

  private marketCapProvider = new MarketCapProvider()

  private strategyPresetService = new StrategyPresetService()

  private watchlistService = new WatchlistService()

  private config = DEFAULT_CONFIG

  private snapshot = createEmptySnapshot(DEFAULT_CONFIG)

  private runtime: RuntimeState = {
    alertHistory: {},
    priceAlertHistory: {},
    alertRecords: [],
    llmSummaries: {},
    homeAiOverview: null,
    strategyRuns: {},
  }

  private allResults: ScreenerResult[] = []

  private scheduledTimer: NodeJS.Timeout | null = null

  private activeRun: Promise<SnapshotPayload> | null = null

  private llmTasks = new Map<string, Promise<string | null>>()

  private strategyRuns = new Map<string, Promise<void>>()

  private watchlist = new Set<string>()

  async init() {
    this.config = await loadConfig()
    this.runtime = await loadRuntimeState()
    await syncRuntimeStateToLlmHistory(this.runtime)
    this.watchlist = new Set((await this.watchlistService.list()).map((item) => item.instId))
    this.snapshot = createEmptySnapshot(this.config, null)
    this.scheduleNext()
    void this.run('startup')
    return this
  }

  getSnapshot() {
    return {
      ...this.snapshot,
      llmAnalysisEnabled: isLlmAnalysisEnabled(),
      recentAlerts: this.runtime.alertRecords.slice(0, 20),
      strategyRuns: Object.values(this.runtime.strategyRuns).sort((left, right) =>
        left.strategyPresetName.localeCompare(right.strategyPresetName, 'zh-CN'),
      ),
    }
  }

  getConfig() {
    return this.config
  }

  getAlerts(): AlertsResponse {
    return {
      items: [...this.runtime.alertRecords].sort((left, right) =>
        right.sentAt.localeCompare(left.sentAt),
      ),
    }
  }

  async getStrategyPresets(): Promise<StrategyPresetsResponse> {
    return {
      items: await this.strategyPresetService.list(this.config.selectedTimeframes),
    }
  }

  async saveStrategyPreset(payload: Parameters<StrategyPresetService['upsert']>[0]) {
    return this.strategyPresetService.upsert(payload)
  }

  async getWatchlist(): Promise<WatchlistResponse> {
    return {
      items: await this.watchlistService.list(),
    }
  }

  async getLlmHistory(query?: {
    type?: 'all' | 'overview' | 'signal'
    keyword?: string
    limit?: number
  }): Promise<LlmHistoryResponse> {
    return listLlmHistory(query)
  }

  async toggleWatchlist(instId: string, note = '') {
    const response = await this.watchlistService.toggle(instId, note)
    this.watchlist = new Set(response.items.map((item) => item.instId))
    this.snapshot = {
      ...this.snapshot,
      results: this.snapshot.results.map((item) =>
        item.instId === instId ? { ...item, watchlisted: response.added } : item,
      ),
    }
    this.allResults = this.allResults.map((item) =>
      item.instId === instId ? { ...item, watchlisted: response.added } : item,
    )
    return response
  }

  private async resolveEffectiveConfig() {
    if (!this.config.activeStrategyPresetId) {
      return this.config
    }

    const preset = await this.strategyPresetService.getById(
      this.config.activeStrategyPresetId,
      this.config.selectedTimeframes,
    )

    if (!preset) {
      return this.config
    }

    return sanitizeConfig({
      ...this.config,
      selectedTimeframes: [...preset.selectedTimeframes],
      extraConditions: preset.conditions.map((condition) => ({
        ...condition,
        params: { ...condition.params },
      })),
      monitoringEnabled: this.config.monitoringEnabled && preset.autoRun,
      refreshIntervalMinutes:
        preset.scheduleIntervalMinutes ?? this.config.refreshIntervalMinutes,
    })
  }

  private createConfigFromPreset(preset: Awaited<ReturnType<StrategyPresetService['getById']>>) {
    if (!preset) {
      return this.config
    }

    return sanitizeConfig({
      ...this.config,
      activeStrategyPresetId: preset.id,
      selectedTimeframes: [...preset.selectedTimeframes],
      extraConditions: preset.conditions.map((condition) => ({
        ...condition,
        params: { ...condition.params },
      })),
      monitoringEnabled: preset.autoRun,
      refreshIntervalMinutes:
        preset.scheduleIntervalMinutes ?? this.config.refreshIntervalMinutes,
    })
  }

  private getSignalAlertHistoryKey(
    signalKey: string,
    strategyPresetId?: string | null,
  ) {
    return `signal:${strategyPresetId ?? 'main'}:${signalKey}`
  }

  private getPriceAlertHistoryKey(
    signalKey: string,
    ruleId: string,
    strategyPresetId?: string | null,
  ) {
    return `price:${strategyPresetId ?? 'main'}:${ruleId}:${signalKey}`
  }

  private getWindowLabel(window: '1m' | '5m' | '1h' | '4h' | 'today') {
    if (window === '1m') {
      return '1分钟'
    }

    if (window === '5m') {
      return '5分钟'
    }

    if (window === '1h') {
      return '1小时'
    }

    if (window === '4h') {
      return '4小时'
    }

    return '今日'
  }

  private getDirectionLabel(direction: 'gt' | 'gte' | 'lt' | 'lte') {
    if (direction === 'gt') {
      return '大于'
    }

    if (direction === 'gte') {
      return '大于等于'
    }

    if (direction === 'lt') {
      return '小于'
    }

    return '小于等于'
  }

  private compareThreshold(
    currentValue: number | null | undefined,
    threshold: number,
    direction: 'gt' | 'gte' | 'lt' | 'lte',
  ) {
    if (currentValue === null || currentValue === undefined) {
      return false
    }

    if (direction === 'gt') {
      return currentValue > threshold
    }

    if (direction === 'gte') {
      return currentValue >= threshold
    }

    if (direction === 'lt') {
      return currentValue < threshold
    }

    return currentValue <= threshold
  }

  private async persistRuntime() {
    await saveRuntimeState(this.runtime)
    this.snapshot = {
      ...this.snapshot,
      recentAlerts: this.runtime.alertRecords.slice(0, 20),
    }
  }

  private async appendAlertRecords(records: AlertRecord[]) {
    if (records.length === 0) {
      return
    }

    this.runtime.alertRecords = [...records, ...this.runtime.alertRecords].slice(0, 500)
    await this.persistRuntime()
  }

  private async processSignalAlerts(
    effectiveConfig: ScreenerConfig,
    matchedResults: ScreenerResult[],
    reason: RunReason,
    strategyContext?: {
      strategyPresetId?: string | null
      strategyPresetName?: string | null
    },
  ) {
    const alertsAvailable = effectiveConfig.monitoringEnabled && effectiveConfig.webhookEnabled
    const sentSignalKeys = new Set<string>()
    let lastAlertCount = 0
    let lastAlertedAt = this.snapshot.status.lastAlertedAt
    let nextMatchedResults = matchedResults.map((item): ScreenerResult => ({
      ...item,
      alertStatus: alertsAvailable ? 'ready' : 'disabled',
    }))

    if (!effectiveConfig.monitoringEnabled) {
      return {
        matchedResults: nextMatchedResults,
        lastAlertCount,
        lastAlertedAt,
      }
    }

    const cooldownMs = effectiveConfig.notificationCooldownMinutes * 60 * 1000
    const eligibleMatches = nextMatchedResults.filter((match) => {
      const historyKey = this.getSignalAlertHistoryKey(
        match.signalKey,
        strategyContext?.strategyPresetId,
      )
      const lastAlert = this.runtime.alertHistory[historyKey]

      if (!effectiveConfig.webhookEnabled) {
        return false
      }

      if (!lastAlert) {
        return true
      }

      return Date.now() - Date.parse(lastAlert) >= cooldownMs
    })

    if (reason !== 'manual') {
      const alertRecords = await sendWebhookAlert(
        effectiveConfig,
        eligibleMatches,
        strategyContext,
      )
      lastAlertCount = alertRecords.length

      if (lastAlertCount > 0) {
        lastAlertedAt = new Date().toISOString()

        for (const record of alertRecords) {
          sentSignalKeys.add(record.signalKey)
          this.runtime.alertHistory[
            this.getSignalAlertHistoryKey(record.signalKey, strategyContext?.strategyPresetId)
          ] = record.sentAt
        }

        await this.appendAlertRecords(alertRecords)
      }
    }

    nextMatchedResults = nextMatchedResults.map((item): ScreenerResult => {
      const lastAlert = this.runtime.alertHistory[
        this.getSignalAlertHistoryKey(item.signalKey, strategyContext?.strategyPresetId)
      ]

      if (!alertsAvailable) {
        return { ...item, alertStatus: 'disabled' }
      }

      if (sentSignalKeys.has(item.signalKey)) {
        return { ...item, alertStatus: 'sent' }
      }

      if (!lastAlert) {
        return { ...item, alertStatus: 'ready' }
      }

      return {
        ...item,
        alertStatus:
          Date.now() - Date.parse(lastAlert) >= cooldownMs ? 'ready' : 'cooldown',
      }
    })

    return {
      matchedResults: nextMatchedResults,
      lastAlertCount,
      lastAlertedAt,
    }
  }

  private async processPriceAlerts(
    effectiveConfig: ScreenerConfig,
    items: ScreenerResult[],
    reason: RunReason,
    strategyContext?: {
      strategyPresetId?: string | null
      strategyPresetName?: string | null
    },
  ) {
    if (!effectiveConfig.monitoringEnabled || effectiveConfig.priceAlertRules.length === 0) {
      return [] as AlertRecord[]
    }

    const createdRecords: AlertRecord[] = []

    for (const rule of effectiveConfig.priceAlertRules.filter((item) => item.enabled)) {
      for (const result of items) {
        const currentValue = result.priceChanges?.[rule.window]

        if (!this.compareThreshold(currentValue, rule.thresholdPct, rule.direction)) {
          continue
        }

        const historyKey = this.getPriceAlertHistoryKey(
          result.signalKey,
          rule.id,
          strategyContext?.strategyPresetId,
        )
        const lastAlert = this.runtime.priceAlertHistory[historyKey]

        if (
          lastAlert &&
          Date.now() - Date.parse(lastAlert) < rule.cooldownMinutes * 60 * 1000
        ) {
          continue
        }

        const windowLabel = this.getWindowLabel(rule.window)
        const directionLabel = this.getDirectionLabel(rule.direction)
        const sentAt = new Date().toISOString()

        let record: AlertRecord | null = null

        if (effectiveConfig.webhookEnabled && reason !== 'manual') {
          record = await sendWebhookPriceAlert(effectiveConfig, {
            signalKey: result.signalKey,
            instId: result.instId,
            timeframe: result.timeframe,
            timeframeLabel: result.timeframeLabel,
            windowLabel,
            directionLabel,
            thresholdPct: rule.thresholdPct,
            priceChangePct: currentValue ?? 0,
            lastPrice: result.lastPrice,
            ruleId: rule.id,
            ruleLabel: rule.label,
            strategyPresetId: strategyContext?.strategyPresetId,
            strategyPresetName: strategyContext?.strategyPresetName,
          })
        }

        if (!record) {
          record = {
            id: `price:${rule.id}:${result.signalKey}:${sentAt}`,
            signalKey: result.signalKey,
            instId: result.instId,
            timeframe: result.timeframe,
            timeframeLabel: result.timeframeLabel,
            alertStatus: 'sent',
            webhookType: effectiveConfig.webhookType,
            message: buildPriceChangeAlertMessage({
              instId: result.instId,
              timeframeLabel: result.timeframeLabel,
              windowLabel,
              directionLabel,
              thresholdPct: rule.thresholdPct,
              priceChangePct: currentValue ?? 0,
              lastPrice: result.lastPrice,
              ruleLabel: rule.label,
              strategyName: strategyContext?.strategyPresetName ?? null,
            }),
            sentAt,
            category: 'price_change',
            strategyPresetId: strategyContext?.strategyPresetId ?? null,
            strategyPresetName: strategyContext?.strategyPresetName ?? null,
            priceWindowLabel: windowLabel,
            priceChangePct: currentValue ?? 0,
          }
        }

        this.runtime.priceAlertHistory[historyKey] = record.sentAt
        createdRecords.push(record)
      }
    }

    if (createdRecords.length > 0) {
      await this.appendAlertRecords(createdRecords)
    }

    return createdRecords
  }

  private updateStrategyRunState(
    strategyPresetId: string,
    updater: (current: StrategyRunState | null) => StrategyRunState,
  ) {
    const current = this.runtime.strategyRuns[strategyPresetId] ?? null
    this.runtime.strategyRuns[strategyPresetId] = updater(current)
  }

  getResults(query: ResultsQuery): ResultsResponse {
    const page = Math.max(1, Number(query.page ?? 1))
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 25)))
    const onlyMatched = normalizeBoolean(
      query.onlyMatched === undefined ? undefined : String(query.onlyMatched),
      true,
    )
    const keyword = (query.keyword ?? '').trim().toLowerCase()
    const selectedBars = new Set(
      (query.bars ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    )
    const selectedPatterns = new Set(
      (query.patterns ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    )

    let items = onlyMatched
      ? this.hydrateResultsWithLlmSummary(this.snapshot.results)
      : this.hydrateResultsWithLlmSummary(this.allResults)

    if (keyword) {
      items = items.filter((item) =>
        `${item.instId} ${item.instrumentName} ${item.instFamily} ${item.baseCcy} ${item.quoteCcy}`
          .toLowerCase()
          .includes(keyword),
      )
    }

    if (selectedBars.size > 0) {
      items = items.filter((item) => selectedBars.has(item.timeframe))
    }

    if (selectedPatterns.size > 0) {
      items = items.filter((item) =>
        (item.patternMatches ?? []).some(
          (pattern) => pattern.matched && selectedPatterns.has(pattern.key),
        ),
      )
    }

    items.sort((left, right) =>
      compareResults(left, right, query.sortBy, query.sortOrder ?? 'asc'),
    )

    const total = items.length
    const pageItems = items.slice((page - 1) * pageSize, page * pageSize)

    return {
      items: pageItems,
      total,
      page,
      pageSize,
      lastRefreshedAt: this.snapshot.status.lastSuccessfulAt,
      monitoringEnabled: this.config.monitoringEnabled,
    }
  }

  async getChart(instId: string, bar: TimeframeKey, limit: number): Promise<ChartResponse> {
    const sourceItem =
      this.allResults.find(
        (result) => result.instId === instId && result.timeframe === bar,
      ) ?? null

    const item = sourceItem ? await this.ensureLlmSummary(sourceItem) : null

    return {
      item,
      candles: item ? item.chart.slice(-limit) : [],
      latestSignal: item
        ? `${item.instId} ${item.timeframeLabel} ${item.isMatch ? '命中' : '未命中'}`
        : '未找到对应图表数据',
    }
  }

  async updateConfig(payload: UpdateConfigPayload) {
    this.config = await saveConfig(sanitizeConfig({ ...this.config, ...payload }))
    this.snapshot = {
      ...this.snapshot,
      config: this.config,
    }
    this.scheduleNext()
    return this.snapshot
  }

  async toggleMonitor(enabled: boolean) {
    return this.updateConfig({ monitoringEnabled: enabled })
  }

  async run(reason: RunReason) {
    if (this.activeRun) {
      return this.activeRun
    }

    this.activeRun = this.executeRun(reason)

    try {
      return await this.activeRun
    } finally {
      this.activeRun = null
    }
  }

  async testWebhook() {
    await sendTestWebhookAlert(this.config)
  }

  private async executeRun(reason: RunReason) {
    const startedAt = new Date().toISOString()
    const previousMatchedResults = this.snapshot.results
    const effectiveConfig = await this.resolveEffectiveConfig()
    this.snapshot = {
      ...this.snapshot,
      config: effectiveConfig,
      status: {
        ...this.snapshot.status,
        isRunning: true,
        lastRunReason: reason,
        lastRunStartedAt: startedAt,
        lastError: null,
      },
    }

    try {
      const result = await this.engine.run(effectiveConfig)
      const completedAt = new Date().toISOString()
      let matchedResults: ScreenerResult[] = result.matchedResults.map(
        (item): ScreenerResult => this.applyCachedLlmSummary(item),
      )
      const signalAlertOutcome = await this.processSignalAlerts(
        effectiveConfig,
        matchedResults,
        reason,
      )
      matchedResults = signalAlertOutcome.matchedResults
      const priceAlertRecords = await this.processPriceAlerts(
        effectiveConfig,
        result.allResults.map((item): ScreenerResult => this.applyCachedLlmSummary(item)),
        reason,
      )
      const lastAlertCount =
        signalAlertOutcome.lastAlertCount + priceAlertRecords.length
      const lastAlertedAt =
        lastAlertCount > 0
          ? completedAt
          : signalAlertOutcome.lastAlertedAt

      this.allResults = await this.enrichResults(
        result.allResults.map((item): ScreenerResult => {
          const matchedItem = matchedResults.find(
            (matched) => matched.signalKey === item.signalKey,
          )

          return matchedItem ?? {
            ...this.applyCachedLlmSummary(item),
            alertStatus: 'not_matched',
          }
        }),
      )
      matchedResults = this.allResults.filter((item) => item.isMatch)

      const overviewInput = this.buildOverviewInput(
        previousMatchedResults,
        matchedResults,
      )
      const aiOverview = this.createPendingAiOverview(overviewInput, completedAt)

      this.snapshot = {
        config: effectiveConfig,
        results: matchedResults,
        stats: result.stats,
        status: {
          ...this.snapshot.status,
          isRunning: false,
          lastRunReason: reason,
          lastRunStartedAt: startedAt,
          lastCompletedAt: completedAt,
          lastSuccessfulAt: completedAt,
          lastError: null,
          lastAlertCount,
          lastAlertedAt,
          nextScheduledRunAt: effectiveConfig.monitoringEnabled
            ? getNextBoundary(effectiveConfig.refreshIntervalMinutes).toISOString()
            : null,
        },
        llmAnalysisEnabled: isLlmAnalysisEnabled(),
        aiOverview,
        recentAlerts: this.runtime.alertRecords.slice(0, 20),
      }

      if (isLlmAnalysisEnabled()) {
        void this.refreshAiOverview(aiOverview, overviewInput)
      } else {
        this.runtime.homeAiOverview = aiOverview
        await saveRuntimeState(this.runtime)
        await recordOverviewHistory(aiOverview)
      }

      this.scheduleNext()
      return this.snapshot
    } catch (error) {
      const completedAt = new Date().toISOString()
      const message =
        error instanceof Error ? error.message : '未知错误，筛选执行失败。'

      this.snapshot = {
        ...this.snapshot,
        config: effectiveConfig,
        llmAnalysisEnabled: isLlmAnalysisEnabled(),
        status: {
          ...this.snapshot.status,
          isRunning: false,
          lastRunReason: reason,
          lastRunStartedAt: startedAt,
          lastCompletedAt: completedAt,
          lastError: message,
          nextScheduledRunAt: effectiveConfig.monitoringEnabled
            ? getNextBoundary(effectiveConfig.refreshIntervalMinutes).toISOString()
            : null,
        },
      }

      this.scheduleNext()
      return this.snapshot
    }
  }

  private applyCachedLlmSummary(item: ScreenerResult): ScreenerResult {
    const cached = this.runtime.llmSummaries[item.signalKey]

    if (!cached) {
      return item
    }

    return {
      ...item,
      llmSummary: cached.summary,
    }
  }

  private hydrateResultsWithLlmSummary(items: ScreenerResult[]) {
    return items.map((item) => this.applyCachedLlmSummary(item))
  }

  private async enrichResults(items: ScreenerResult[]) {
    return Promise.all(
      items.map(async (item) => ({
        ...item,
        marketCap: await this.marketCapProvider.getSnapshot(item.instId, item.baseCcy),
        watchlisted: this.watchlist.has(item.instId),
      })),
    )
  }

  private async ensureLlmSummary(item: ScreenerResult) {
    const hydratedItem = this.applyCachedLlmSummary(item)

    if (
      !hydratedItem.isMatch ||
      hydratedItem.llmSummary ||
      !isLlmAnalysisEnabled()
    ) {
      return hydratedItem
    }

    const existingTask = this.llmTasks.get(hydratedItem.signalKey)

    if (existingTask) {
      const summary = await existingTask
      return summary
        ? this.updateResultSummary(hydratedItem.signalKey, summary)
        : hydratedItem
    }

    const task = analyzeMatchWithLlm(hydratedItem)
      .then(async (summary) => {
        if (!summary) {
          return null
        }

        const analyzedAt = new Date().toISOString()
        this.runtime.llmSummaries[hydratedItem.signalKey] = {
          summary,
          analyzedAt,
        }
        await saveRuntimeState(this.runtime)
        await recordSignalSummaryHistory(
          {
            signalKey: hydratedItem.signalKey,
            instId: hydratedItem.instId,
            timeframe: hydratedItem.timeframe,
            timeframeLabel: hydratedItem.timeframeLabel,
          },
          summary,
          analyzedAt,
        )
        this.updateResultSummary(hydratedItem.signalKey, summary)
        return summary
      })
      .catch((error) => {
        console.warn(
          `[Qwen] ${hydratedItem.instId} ${hydratedItem.timeframeLabel} analysis failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        return null
      })
      .finally(() => {
        this.llmTasks.delete(hydratedItem.signalKey)
      })

    this.llmTasks.set(hydratedItem.signalKey, task)

    const summary = await task
    return summary
      ? this.updateResultSummary(hydratedItem.signalKey, summary)
      : hydratedItem
  }

  private updateResultSummary(signalKey: string, summary: string) {
    this.allResults = this.allResults.map((item) =>
      item.signalKey === signalKey ? { ...item, llmSummary: summary } : item,
    )
    this.snapshot = {
      ...this.snapshot,
      results: this.snapshot.results.map((item) =>
        item.signalKey === signalKey ? { ...item, llmSummary: summary } : item,
      ),
    }

    return (
      this.allResults.find((item) => item.signalKey === signalKey) ??
      this.snapshot.results.find((item) => item.signalKey === signalKey) ??
      null
    )
  }

  private createPendingAiOverview(
    analysisInput: OverviewInputWithTimeframes,
    completedAt: string,
  ): AiOverview {
    const fallbackSummary = createRuleBasedOverview(analysisInput)
    const llmEnabled = isLlmAnalysisEnabled()

    return {
      status: llmEnabled ? 'pending' : 'ready',
      source: 'rules',
      summary: fallbackSummary,
      generatedAt: llmEnabled ? null : completedAt,
      basedOnRunAt: completedAt,
      error: null,
      totalMatches: analysisInput.totalMatches,
      newMatches: analysisInput.newMatches,
      removedMatches: analysisInput.removedMatches,
      leadingTimeframeLabel: analysisInput.leadingTimeframeLabel,
      timeframeStats: analysisInput.timeframeStats.map((item) => ({
        timeframe: item.timeframe,
        label: item.label,
        count: item.count,
      })),
      sampleSignals: analysisInput.sampleSignals,
    }
  }

  private buildOverviewInput(
    previousResults: ScreenerResult[],
    currentResults: ScreenerResult[],
  ): OverviewInputWithTimeframes {
    const previousSignalKeys = new Set(previousResults.map((item) => item.signalKey))
    const currentSignalKeys = new Set(currentResults.map((item) => item.signalKey))
    const newMatches = currentResults.filter((item) => !previousSignalKeys.has(item.signalKey))
    const removedMatches = previousResults.filter(
      (item) => !currentSignalKeys.has(item.signalKey),
    )
    const timeframeCounts = new Map<TimeframeKey, number>()

    for (const result of currentResults) {
      timeframeCounts.set(
        result.timeframe,
        (timeframeCounts.get(result.timeframe) ?? 0) + 1,
      )
    }

    const timeframeStats = [...timeframeCounts.entries()]
      .map(([timeframe, count]) => ({
        timeframe,
        label: TIMEFRAME_MAP[timeframe].label,
        count,
      }))
      .sort(
        (left, right) =>
          right.count - left.count ||
          TIMEFRAME_MAP[left.timeframe].sortOrder - TIMEFRAME_MAP[right.timeframe].sortOrder,
      )

    const sampleSignals = [...currentResults]
      .sort(
        (left, right) =>
          right.crossSlopePct - left.crossSlopePct ||
          left.convergencePct - right.convergencePct,
      )
      .slice(0, 3)
      .map((item) => ({
        instId: item.instId,
        timeframe: item.timeframe,
        timeframeLabel: item.timeframeLabel,
      }))

    return {
      totalMatches: currentResults.length,
      newMatches: newMatches.length,
      removedMatches: removedMatches.length,
      refreshIntervalMinutes: this.snapshot.config.refreshIntervalMinutes,
      leadingTimeframeLabel: timeframeStats[0]?.label ?? null,
      timeframeStats,
      sampleSignals,
      newSignalSamples: newMatches
        .slice(0, 3)
        .map((item) => `${item.instId} ${item.timeframeLabel}`),
      removedSignalSamples: removedMatches
        .slice(0, 3)
        .map((item) => `${item.instId} ${item.timeframeLabel}`),
    }
  }

  private async refreshAiOverview(
    overview: AiOverview,
    analysisInput: OverviewAnalysisInput,
  ) {
    if (!overview.basedOnRunAt) {
      return
    }

    const runAt = overview.basedOnRunAt

    try {
      const summary = await analyzeOverviewWithLlm(analysisInput)

      if (!summary || this.snapshot.aiOverview?.basedOnRunAt !== runAt) {
        return
      }

      const readyOverview: AiOverview = {
        ...overview,
        status: 'ready',
        source: 'llm',
        summary,
        generatedAt: new Date().toISOString(),
        error: null,
      }

      this.snapshot = {
        ...this.snapshot,
        aiOverview: readyOverview,
      }
      this.runtime.homeAiOverview = readyOverview
      await saveRuntimeState(this.runtime)
      await recordOverviewHistory(readyOverview)
    } catch (error) {
      if (this.snapshot.aiOverview?.basedOnRunAt !== runAt) {
        return
      }

      const failedOverview: AiOverview = {
        ...overview,
        status: 'error',
        source: 'rules',
        generatedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'AI overview generation failed',
      }

      this.snapshot = {
        ...this.snapshot,
        aiOverview: failedOverview,
      }
      this.runtime.homeAiOverview = failedOverview
      await saveRuntimeState(this.runtime)
      await recordOverviewHistory(failedOverview)
    }
  }

  private async executeStrategyPresetRun(
    strategyPresetId: string,
    reason: RunReason,
  ) {
    const preset = await this.strategyPresetService.getById(
      strategyPresetId,
      this.config.selectedTimeframes,
    )

    if (!preset || !preset.autoRun) {
      return
    }

    const startedAt = new Date().toISOString()
    this.updateStrategyRunState(strategyPresetId, (current) => ({
      strategyPresetId,
      strategyPresetName: preset.name,
      nextScheduledRunAt: current?.nextScheduledRunAt ?? null,
      lastRunStartedAt: startedAt,
      lastCompletedAt: current?.lastCompletedAt ?? null,
      lastSuccessfulAt: current?.lastSuccessfulAt ?? null,
      lastError: null,
      lastMatchCount: current?.lastMatchCount ?? 0,
    }))
    await this.persistRuntime()

    const effectiveConfig = this.createConfigFromPreset(preset)

    try {
      const result = await this.engine.run(effectiveConfig)
      const completedAt = new Date().toISOString()
      const hydratedAllResults = result.allResults.map((item): ScreenerResult =>
        this.applyCachedLlmSummary(item),
      )
      const signalAlertOutcome = await this.processSignalAlerts(
        effectiveConfig,
        result.matchedResults.map((item): ScreenerResult => this.applyCachedLlmSummary(item)),
        reason,
        {
          strategyPresetId: preset.id,
          strategyPresetName: preset.name,
        },
      )
      const priceAlertRecords = await this.processPriceAlerts(
        effectiveConfig,
        hydratedAllResults,
        reason,
        {
          strategyPresetId: preset.id,
          strategyPresetName: preset.name,
        },
      )

      this.updateStrategyRunState(strategyPresetId, (current) => ({
        strategyPresetId,
        strategyPresetName: preset.name,
        nextScheduledRunAt: getNextBoundary(
          effectiveConfig.refreshIntervalMinutes,
        ).toISOString(),
        lastRunStartedAt: current?.lastRunStartedAt ?? startedAt,
        lastCompletedAt: completedAt,
        lastSuccessfulAt: completedAt,
        lastError: null,
        lastMatchCount:
          signalAlertOutcome.matchedResults.length + priceAlertRecords.length,
      }))
      await this.persistRuntime()
    } catch (error) {
      const completedAt = new Date().toISOString()
      this.updateStrategyRunState(strategyPresetId, (current) => ({
        strategyPresetId,
        strategyPresetName: preset.name,
        nextScheduledRunAt: getNextBoundary(
          effectiveConfig.refreshIntervalMinutes,
        ).toISOString(),
        lastRunStartedAt: current?.lastRunStartedAt ?? startedAt,
        lastCompletedAt: completedAt,
        lastSuccessfulAt: current?.lastSuccessfulAt ?? null,
        lastError: error instanceof Error ? error.message : '策略调度执行失败',
        lastMatchCount: current?.lastMatchCount ?? 0,
      }))
      await this.persistRuntime()
    }
  }

  private async runPresetIfNeeded(strategyPresetId: string, reason: RunReason) {
    const existingRun = this.strategyRuns.get(strategyPresetId)

    if (existingRun) {
      return existingRun
    }

    const nextRun = this.executeStrategyPresetRun(strategyPresetId, reason).finally(() => {
      this.strategyRuns.delete(strategyPresetId)
    })

    this.strategyRuns.set(strategyPresetId, nextRun)
    return nextRun
  }

  private async listScheduleCandidates() {
    const candidates: Array<{
      id: string
      kind: 'main' | 'preset'
      name: string
      intervalMinutes: number
      nextRunAt: string
    }> = []

    if (!this.config.monitoringEnabled) {
      return candidates
    }

    candidates.push({
      id: 'main',
      kind: 'main',
      name: this.config.activeStrategyPresetId ? '当前激活策略' : '主筛选任务',
      intervalMinutes: this.snapshot.config.refreshIntervalMinutes,
      nextRunAt:
        this.snapshot.status.nextScheduledRunAt ??
        getNextBoundary(this.snapshot.config.refreshIntervalMinutes).toISOString(),
    })

    const presets = await this.strategyPresetService.list(this.config.selectedTimeframes)
    for (const preset of presets) {
      if (!preset.autoRun) {
        continue
      }

      if (preset.id === this.config.activeStrategyPresetId) {
        continue
      }

      if (!this.config.activeStrategyPresetId && preset.id === 'default-ma-strategy') {
        continue
      }

      const intervalMinutes =
        preset.scheduleIntervalMinutes ?? this.config.refreshIntervalMinutes
      const runtimeState = this.runtime.strategyRuns[preset.id]

      candidates.push({
        id: preset.id,
        kind: 'preset',
        name: preset.name,
        intervalMinutes,
        nextRunAt:
          runtimeState?.nextScheduledRunAt ??
          getNextBoundary(intervalMinutes).toISOString(),
      })
    }

    return candidates
  }

  private async runDueSchedules() {
    const now = Date.now()
    const candidates = await this.listScheduleCandidates()
    const dueCandidates = candidates.filter(
      (candidate) => Date.parse(candidate.nextRunAt) <= now + 1_000,
    )

    if (dueCandidates.length === 0) {
      this.scheduleNext()
      return
    }

    await Promise.allSettled(
      dueCandidates.map((candidate) =>
        candidate.kind === 'main'
          ? this.run('scheduled')
          : this.runPresetIfNeeded(candidate.id, 'scheduled'),
      ),
    )

    this.scheduleNext()
  }

  private scheduleNext() {
    if (this.scheduledTimer) {
      clearTimeout(this.scheduledTimer)
      this.scheduledTimer = null
    }

    void (async () => {
      const candidates = await this.listScheduleCandidates()

      if (candidates.length === 0) {
        this.snapshot = {
          ...this.snapshot,
          status: {
            ...this.snapshot.status,
            nextScheduledRunAt: null,
          },
        }
        return
      }

      const nextCandidate = [...candidates].sort(
        (left, right) => Date.parse(left.nextRunAt) - Date.parse(right.nextRunAt),
      )[0]
      const delay = Math.max(Date.parse(nextCandidate.nextRunAt) - Date.now(), 5_000)

      this.snapshot = {
        ...this.snapshot,
        status: {
          ...this.snapshot.status,
          nextScheduledRunAt: nextCandidate.nextRunAt,
        },
      }

      this.scheduledTimer = setTimeout(() => {
        void this.runDueSchedules()
      }, delay)
    })()
  }
}


