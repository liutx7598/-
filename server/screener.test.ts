import test from 'node:test'
import assert from 'node:assert/strict'

import type { ScreenerConfig, ScreenerResult } from '../shared/types'
import type { GateInstrument, RawCandle } from './gate'
import { createRuleBasedOverview } from './llm'
import {
  buildChart,
  buildResult,
  calculateMovingAverage,
  resolveMatch,
  sortResults,
} from './screener'

const baseConfig: ScreenerConfig = {
  selectedTimeframes: ['15m'],
  fastMaPeriod: 2,
  slowMaPeriod: 3,
  convergenceThresholdPct: 1,
  secondaryConvergenceEnabled: false,
  secondaryFastMaPeriod: 3,
  secondarySlowMaPeriod: 4,
  convergenceRelation: 'and',
  crossSlopeEnabled: false,
  crossSlopeThresholdPct: 0.03,
  maSlopeLookback: 2,
  maUpStrategy: 'stair_up',
  matchMode: 'A_B_C',
  fetchLimit: 20,
  chartCandles: 5,
  monitoringEnabled: true,
  refreshIntervalMinutes: 15,
  notificationCooldownMinutes: 60,
  webhookEnabled: false,
  webhookUrl: '',
  webhookType: 'generic',
}

const baseInstrument: GateInstrument = {
  instId: 'TEST_USDT',
  instFamily: 'TEST_USDT',
  baseCcy: 'TEST',
  quoteCcy: 'USDT',
  settleCcy: 'USDT',
  state: 'live',
}

type CandleInput =
  | number
  | {
      open: number
      close: number
      high?: number
      low?: number
    }

function makeCandles(values: CandleInput[], lastConfirmed = true): RawCandle[] {
  return values.map((value, index) => {
    const close = typeof value === 'number' ? value : value.close
    const open = typeof value === 'number' ? close : value.open
    const high =
      typeof value === 'number' ? close + 0.1 : (value.high ?? Math.max(open, close) + 0.1)
    const low =
      typeof value === 'number' ? close - 0.1 : (value.low ?? Math.min(open, close) - 0.1)

    return {
      timestamp: new Date(2026, 2, 20, 9, index, 0, 0).getTime(),
      open,
      high,
      low,
      close,
      volume: 100 + index,
      confirmed: index === values.length - 1 ? lastConfirmed : true,
    }
  })
}

function makeResult(
  overrides: Partial<ScreenerResult> = {},
): ScreenerResult {
  return {
    signalKey: 'AAA-USDT-SWAP:15m:1',
    signature: 'AAA-USDT-SWAP:15m',
    instId: 'AAA-USDT-SWAP',
    instFamily: 'AAA-USDT',
    instrumentName: 'AAA-USDT',
    baseCcy: 'AAA',
    quoteCcy: 'USDT',
    contractType: 'SWAP',
    timeframe: '15m',
    timeframeLabel: '15m',
    synthetic: false,
    lastPrice: 10,
    fastMa: 10,
    slowMa: 10,
    distanceRatio: 0.001,
    convergencePct: 0.1,
    secondaryFastMa: null,
    secondarySlowMa: null,
    secondaryDistanceRatio: null,
    secondaryConvergencePct: null,
    priceVsFastMaPct: 0.2,
    fastMaSlopePct: 0.1,
    crossSlopePct: 0.1,
    maTrendDirection: 'up',
    crossedAt: '2026-03-20T00:00:00.000Z',
    lastClosedTs: 1,
    analysisSource: 'rules',
    llmSummary: null,
    isMatch: true,
    alertStatus: 'ready',
    trendFlags: {
      primaryConverging: true,
      secondaryConverging: null,
      converging: true,
      fastMaRising: true,
      rawPriceCrossedFastMa: true,
      crossSlopeQualified: true,
      priceCrossedFastMa: true,
    },
    chart: [],
    ...overrides,
  }
}

test('calculateMovingAverage returns nulls before enough samples', () => {
  assert.deepEqual(calculateMovingAverage([1, 2, 3, 4], 3), [null, null, 2, 3])
})

test('resolveMatch supports A_B_C mode', () => {
  assert.equal(
    resolveMatch('A_B_C', {
      primaryConverging: true,
      secondaryConverging: null,
      converging: true,
      fastMaRising: true,
      rawPriceCrossedFastMa: true,
      crossSlopeQualified: true,
      priceCrossedFastMa: true,
    }),
    true,
  )
})

test('resolveMatch supports A_ONLY mode', () => {
  assert.equal(
    resolveMatch('A_ONLY', {
      primaryConverging: true,
      secondaryConverging: null,
      converging: true,
      fastMaRising: false,
      rawPriceCrossedFastMa: false,
      crossSlopeQualified: false,
      priceCrossedFastMa: false,
    }),
    true,
  )
})

test('buildResult returns a matched signal when A B C all pass', () => {
  const result = buildResult(
    baseInstrument,
    '15m',
    makeCandles([10, 10, 10, 10, { open: 10.02, close: 10.1 }]),
    baseConfig,
  )

  assert.ok(result)
  assert.equal(result.isMatch, true)
  assert.equal(result.trendFlags.converging, true)
  assert.equal(result.trendFlags.fastMaRising, true)
  assert.equal(result.trendFlags.priceCrossedFastMa, true)
  assert.equal(result.instrumentName, 'TEST-USDT')
})

test('buildResult returns non-match when convergence threshold is too strict', () => {
  const result = buildResult(
    baseInstrument,
    '15m',
    makeCandles([10, 10, 10, 10, { open: 10.02, close: 10.1 }]),
    { ...baseConfig, convergenceThresholdPct: 0.01 },
  )

  assert.ok(result)
  assert.equal(result.isMatch, false)
  assert.equal(result.trendFlags.converging, false)
})

test('buildResult rejects a flat cross when cross slope filter is enabled', () => {
  const result = buildResult(
    baseInstrument,
    '15m',
    makeCandles([10, 10, 10, 10, { open: 10, close: 10.001 }]),
    {
      ...baseConfig,
      crossSlopeEnabled: true,
      crossSlopeThresholdPct: 0.02,
    },
  )

  assert.ok(result)
  assert.equal(result.trendFlags.rawPriceCrossedFastMa, true)
  assert.equal(result.trendFlags.crossSlopeQualified, false)
  assert.equal(result.trendFlags.priceCrossedFastMa, false)
  assert.equal(result.isMatch, false)
})

test('buildResult respects strict_positive MA strategy differently from stair_up', () => {
  const candles = makeCandles([10, 10.2, 9.9, 9.8, { open: 9.7, close: 10.2 }])
  const stairUpResult = buildResult(
    baseInstrument,
    '15m',
    candles,
    { ...baseConfig, maUpStrategy: 'stair_up' },
  )
  const strictResult = buildResult(
    baseInstrument,
    '15m',
    candles,
    { ...baseConfig, maUpStrategy: 'strict_positive' },
  )

  assert.ok(stairUpResult)
  assert.ok(strictResult)
  assert.equal(stairUpResult.trendFlags.fastMaRising, false)
  assert.equal(strictResult.trendFlags.fastMaRising, true)
  assert.equal(stairUpResult.isMatch, false)
  assert.equal(strictResult.isMatch, true)
})

test('buildResult rejects candles that are already entirely above MA5 without body crossing', () => {
  const result = buildResult(
    baseInstrument,
    '15m',
    makeCandles([10, 10, 10, 10, { open: 10.06, close: 10.1 }]),
    baseConfig,
  )

  assert.ok(result)
  assert.equal(result.trendFlags.rawPriceCrossedFastMa, false)
  assert.equal(result.trendFlags.priceCrossedFastMa, false)
  assert.equal(result.isMatch, false)
})

test('buildResult rejects candles that only touch MA5 at the open without strictly crossing the body', () => {
  const result = buildResult(
    baseInstrument,
    '15m',
    makeCandles([10, 10, 10, 10, { open: 10.0005, close: 10.001 }]),
    baseConfig,
  )

  assert.ok(result)
  assert.ok(Math.abs(result.fastMa - 10.0005) < 1e-9)
  assert.equal(result.trendFlags.rawPriceCrossedFastMa, false)
  assert.equal(result.trendFlags.priceCrossedFastMa, false)
  assert.equal(result.isMatch, false)
})

test('buildResult can require both 5/20 and 10/30 convergence together', () => {
  const result = buildResult(
    baseInstrument,
    '15m',
    makeCandles([10, 10.05, 10.02, 10.04, 10.07, 10.09, 10.11, 10.14]),
    {
      ...baseConfig,
      fastMaPeriod: 2,
      slowMaPeriod: 3,
      secondaryConvergenceEnabled: true,
      secondaryFastMaPeriod: 3,
      secondarySlowMaPeriod: 5,
      convergenceRelation: 'and',
    },
  )

  assert.ok(result)
  assert.equal(result.trendFlags.primaryConverging, true)
  assert.equal(result.trendFlags.secondaryConverging, true)
  assert.equal(result.trendFlags.converging, true)
  assert.notEqual(result.secondaryConvergencePct, null)
})

test('buildResult returns null when there are not enough confirmed candles', () => {
  const result = buildResult(
    baseInstrument,
    '15m',
    makeCandles([10, 10, 10, 10]),
    baseConfig,
  )

  assert.equal(result, null)
})

test('buildChart keeps only the requested trailing candles and preserves unclosed bar flag', () => {
  const chart = buildChart(makeCandles([10, 10, 10, 10.1, 10.2, 10.3], false), {
    ...baseConfig,
    chartCandles: 3,
  })

  assert.equal(chart.length, 3)
  assert.equal(chart[0].timestamp, new Date(2026, 2, 20, 9, 3, 0, 0).getTime())
  assert.equal(chart[2].isClosed, false)
})

test('sortResults puts matched rows first and then sorts by timeframe order', () => {
  const results = sortResults([
    makeResult({
      signalKey: 'b',
      instId: 'BBB-USDT-SWAP',
      signature: 'BBB-USDT-SWAP:1H',
      timeframe: '1H',
      timeframeLabel: '1H',
      isMatch: true,
      convergencePct: 0.5,
    }),
    makeResult({
      signalKey: 'c',
      instId: 'CCC-USDT-SWAP',
      signature: 'CCC-USDT-SWAP:15m',
      timeframe: '15m',
      timeframeLabel: '15m',
      isMatch: false,
      alertStatus: 'not_matched',
    }),
    makeResult({
      signalKey: 'a',
      instId: 'AAA-USDT-SWAP',
      signature: 'AAA-USDT-SWAP:15m',
      timeframe: '15m',
      timeframeLabel: '15m',
      isMatch: true,
      convergencePct: 0.2,
    }),
  ])

  assert.deepEqual(
    results.map((item) => item.signalKey),
    ['a', 'b', 'c'],
  )
})

test('createRuleBasedOverview summarizes scan changes for the homepage card', () => {
  const summary = createRuleBasedOverview({
    totalMatches: 12,
    newMatches: 4,
    removedMatches: 2,
    refreshIntervalMinutes: 15,
    leadingTimeframeLabel: '15m',
    timeframeStats: [
      { label: '15m', count: 8 },
      { label: '1H', count: 4 },
    ],
    sampleSignals: [
      { instId: 'BTC-USDT-SWAP', timeframe: '15m', timeframeLabel: '15m' },
      { instId: 'ETH-USDT-SWAP', timeframe: '1H', timeframeLabel: '1H' },
    ],
    newSignalSamples: ['BTC-USDT-SWAP 15m'],
    removedSignalSamples: ['SOL-USDT-SWAP 1H'],
  })

  assert.match(summary, /本轮共命中 12 条/)
  assert.match(summary, /新增 4 条/)
  assert.match(summary, /15m/)
  assert.match(summary, /BTC-USDT-SWAP 15m/)
})
