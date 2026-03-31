import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { DEFAULT_CONFIG } from './defaults'
import type {
  AiOverview,
  AlertRecord,
  ScreenerConfig,
  StrategyRunState,
} from '../shared/types'

export interface LlmSummaryRecord {
  summary: string
  analyzedAt: string
}

export interface RuntimeState {
  alertHistory: Record<string, string>
  priceAlertHistory: Record<string, string>
  alertRecords: AlertRecord[]
  llmSummaries: Record<string, LlmSummaryRecord>
  homeAiOverview: AiOverview | null
  strategyRuns: Record<string, StrategyRunState>
}

const dataDirectory = path.join(process.cwd(), 'server', 'data')
const configFilePath = path.join(dataDirectory, 'config.json')
const runtimeFilePath = path.join(dataDirectory, 'runtime.json')

async function ensureDataDirectory() {
  await mkdir(dataDirectory, { recursive: true })
}

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function sanitizeConfig(
  input: Partial<ScreenerConfig> | undefined,
): ScreenerConfig {
  const next = {
    ...DEFAULT_CONFIG,
    ...input,
    selectedTimeframes:
      input?.selectedTimeframes && input.selectedTimeframes.length > 0
        ? [...new Set(input.selectedTimeframes)]
        : DEFAULT_CONFIG.selectedTimeframes,
  }

  return {
    selectedTimeframes: next.selectedTimeframes,
    fastMaPeriod: clampNumber(Math.round(next.fastMaPeriod), 2, 60),
    slowMaPeriod: clampNumber(Math.round(next.slowMaPeriod), 5, 240),
    convergenceThresholdPct: clampNumber(next.convergenceThresholdPct, 0.1, 10),
    secondaryConvergenceEnabled: Boolean(next.secondaryConvergenceEnabled),
    secondaryFastMaPeriod: clampNumber(Math.round(next.secondaryFastMaPeriod), 2, 120),
    secondarySlowMaPeriod: clampNumber(Math.round(next.secondarySlowMaPeriod), 5, 240),
    convergenceRelation: next.convergenceRelation,
    crossSlopeEnabled: Boolean(next.crossSlopeEnabled),
    crossSlopeThresholdPct: clampNumber(next.crossSlopeThresholdPct, 0, 10),
    maSlopeLookback: clampNumber(Math.round(next.maSlopeLookback), 1, 10),
    maUpStrategy: next.maUpStrategy,
    matchMode: next.matchMode,
    fetchLimit: clampNumber(Math.round(next.fetchLimit), 60, 300),
    chartCandles: clampNumber(Math.round(next.chartCandles), 24, 120),
    activeStrategyPresetId:
      typeof next.activeStrategyPresetId === 'string' &&
      next.activeStrategyPresetId.trim().length > 0
        ? next.activeStrategyPresetId.trim()
        : null,
    extraConditions: Array.isArray(next.extraConditions)
      ? next.extraConditions.map((condition) => ({
          ...condition,
          params: { ...condition.params },
        }))
      : [],
    priceAlertRules: Array.isArray(next.priceAlertRules)
      ? next.priceAlertRules.map((rule, index) => ({
          id: String(rule.id ?? `price-alert-${index + 1}`),
          label: String(rule.label ?? ''),
          window:
            rule.window === '1m' ||
            rule.window === '5m' ||
            rule.window === '1h' ||
            rule.window === '4h' ||
            rule.window === 'today'
              ? rule.window
              : '1h',
          direction:
            rule.direction === 'gt' ||
            rule.direction === 'gte' ||
            rule.direction === 'lt' ||
            rule.direction === 'lte'
              ? rule.direction
              : 'gt',
          thresholdPct: clampNumber(Number(rule.thresholdPct ?? 0), 0.1, 99),
          enabled: Boolean(rule.enabled),
          cooldownMinutes: clampNumber(
            Math.round(Number(rule.cooldownMinutes ?? 30)),
            1,
            1440,
          ),
        }))
      : [],
    soundAlertsEnabled: Boolean(next.soundAlertsEnabled),
    monitoringEnabled: Boolean(next.monitoringEnabled),
    refreshIntervalMinutes: clampNumber(
      Math.round(next.refreshIntervalMinutes),
      15,
      240,
    ),
    notificationCooldownMinutes: clampNumber(
      Math.round(next.notificationCooldownMinutes),
      15,
      1440,
    ),
    webhookEnabled: Boolean(next.webhookEnabled),
    webhookUrl: next.webhookUrl.trim(),
    webhookType: next.webhookType,
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }

    throw error
  }
}

async function writeJsonFile(filePath: string, payload: unknown) {
  await ensureDataDirectory()
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
}

export async function loadConfig() {
  const config = await readJsonFile<Partial<ScreenerConfig>>(configFilePath)
  return sanitizeConfig(config ?? DEFAULT_CONFIG)
}

export async function saveConfig(config: ScreenerConfig) {
  const sanitized = sanitizeConfig(config)
  await writeJsonFile(configFilePath, sanitized)
  return sanitized
}

export async function loadRuntimeState(): Promise<RuntimeState> {
  const runtime = await readJsonFile<RuntimeState>(runtimeFilePath)
  return {
    alertHistory: runtime?.alertHistory ?? {},
    priceAlertHistory: runtime?.priceAlertHistory ?? {},
    alertRecords: (runtime?.alertRecords ?? []).map((record, index) => ({
      ...record,
      id: record.id ?? `${record.signalKey}:${record.sentAt}:${index}`,
      category: record.category ?? 'signal_match',
      strategyPresetId: record.strategyPresetId ?? null,
      strategyPresetName: record.strategyPresetName ?? null,
      priceWindowLabel: record.priceWindowLabel ?? null,
      priceChangePct: record.priceChangePct ?? null,
    })),
    llmSummaries: runtime?.llmSummaries ?? {},
    homeAiOverview: runtime?.homeAiOverview ?? null,
    strategyRuns: runtime?.strategyRuns ?? {},
  }
}

export async function saveRuntimeState(runtime: RuntimeState) {
  await writeJsonFile(runtimeFilePath, runtime)
}
