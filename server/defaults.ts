import { DEFAULT_TIMEFRAMES } from '../shared/timeframes'
import type { MonitorStatus, ScreenerConfig, ScreenerStats } from '../shared/types'

export const DEFAULT_CONFIG: ScreenerConfig = {
  selectedTimeframes: [...DEFAULT_TIMEFRAMES],
  fastMaPeriod: 5,
  slowMaPeriod: 20,
  convergenceThresholdPct: 0.8,
  secondaryConvergenceEnabled: false,
  secondaryFastMaPeriod: 10,
  secondarySlowMaPeriod: 30,
  convergenceRelation: 'and',
  crossSlopeEnabled: true,
  crossSlopeThresholdPct: 0.03,
  maSlopeLookback: 2,
  maUpStrategy: 'stair_up',
  matchMode: 'A_B_C',
  fetchLimit: 120,
  chartCandles: 80,
  monitoringEnabled: true,
  refreshIntervalMinutes: 15,
  notificationCooldownMinutes: 60,
  webhookEnabled: false,
  webhookUrl: '',
  webhookType: 'generic',
}

export const EMPTY_STATUS: MonitorStatus = {
  isRunning: false,
  lastRunReason: null,
  lastRunStartedAt: null,
  lastCompletedAt: null,
  lastSuccessfulAt: null,
  nextScheduledRunAt: null,
  lastError: null,
  lastAlertedAt: null,
  lastAlertCount: 0,
}

export const EMPTY_STATS: ScreenerStats = {
  scannedInstruments: 0,
  analyzedRows: 0,
  matchedRows: 0,
  rawBarsFetched: 0,
  failures: 0,
  durationMs: 0,
}
