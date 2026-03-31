import test from 'node:test'
import assert from 'node:assert/strict'

import type { ConditionDefinition, IndicatorSnapshot, PatternMatch } from '../shared/platform-types'
import type { ScreenerResult } from '../shared/types'
import { evaluateCondition } from './condition-evaluator'

function makeResult(overrides: Partial<ScreenerResult> = {}): ScreenerResult {
  return {
    signalKey: 'TEST:15m:1',
    signature: 'TEST:15m',
    instId: 'TEST',
    instFamily: 'TEST',
    instrumentName: 'TEST-USDT',
    baseCcy: 'TEST',
    quoteCcy: 'USDT',
    contractType: 'SWAP',
    timeframe: '15m',
    timeframeLabel: '15m',
    synthetic: false,
    lastPrice: 10,
    fastMa: 10,
    slowMa: 10,
    distanceRatio: 0,
    convergencePct: 0,
    secondaryFastMa: null,
    secondarySlowMa: null,
    secondaryDistanceRatio: null,
    secondaryConvergencePct: null,
    priceVsFastMaPct: 0,
    fastMaSlopePct: 0.1,
    crossSlopePct: 0.1,
    maTrendDirection: 'up',
    crossedAt: '2026-03-31T00:00:00.000Z',
    lastClosedTs: 1,
    analysisSource: 'rules',
    llmSummary: null,
    isMatch: true,
    alertStatus: 'ready',
    marketCap: null,
    priceChanges: {},
    aiRecommendationLabel: null,
    aiRecommendationReason: null,
    indicators: undefined,
    patternMatches: [],
    watchlisted: false,
    trendFlags: {
      primaryConverging: true,
      secondaryConverging: null,
      converging: true,
      fastMaRising: true,
      rawPriceCrossedFastMa: true,
      crossSlopeQualified: true,
      priceCrossedFastMa: true,
    },
    chart: [
      {
        timestamp: 1,
        open: 9.8,
        high: 10.2,
        low: 9.7,
        close: 9.9,
        isClosed: true,
        fastMa: 9.85,
        slowMa: 9.9,
      },
      {
        timestamp: 2,
        open: 10.2,
        high: 10.3,
        low: 9.6,
        close: 9.7,
        isClosed: true,
        fastMa: 9.95,
        slowMa: 9.92,
      },
      {
        timestamp: 3,
        open: 9.6,
        high: 10.4,
        low: 9.6,
        close: 10.3,
        isClosed: true,
        fastMa: 10,
        slowMa: 9.95,
      },
    ],
    ...overrides,
  }
}

function makeIndicators(overrides: Partial<IndicatorSnapshot> = {}): IndicatorSnapshot {
  return {
    movingAverages: {
      MA5: 10,
      MA10: 9.9,
      MA20: 9.95,
      MA30: 9.8,
      MA60: 9.7,
      MA120: 9.6,
    },
    intradayAverage: 9.85,
    macd: {
      dif: 0.2,
      dea: 0.1,
      histogram: 0.2,
    },
    boll: {
      upper: 10.4,
      middle: 10,
      lower: 9.6,
    },
    kdj: {
      k: 60,
      d: 50,
      j: 80,
    },
    rsi: {
      rsi6: 62,
      rsi14: 55,
      rsi24: 52,
    },
    bias: {
      BIAS5: 1.2,
      BIAS10: 0.8,
      BIAS20: 0.5,
    },
    volume: {
      current: 200,
      average5: 100,
      average20: 120,
    },
    ...overrides,
  }
}

const emptyPatterns: PatternMatch[] = []

test('price_cross_ma down requires a bearish body to cross through the MA', () => {
  const result = makeResult({
    chart: [
      {
        timestamp: 1,
        open: 10.2,
        high: 10.3,
        low: 10.1,
        close: 10.3,
        isClosed: true,
        fastMa: 10.3,
        slowMa: 10.3,
      },
      {
        timestamp: 2,
        open: 10.4,
        high: 10.5,
        low: 9.6,
        close: 9.7,
        isClosed: true,
        fastMa: 10,
        slowMa: 10,
      },
    ],
  })

  const condition: ConditionDefinition = {
    id: 'down-cross',
    label: '实体下穿',
    kind: 'price_cross_ma',
    enabled: true,
    params: { period: 2, direction: 'down' },
  }

  assert.equal(evaluateCondition(result, makeIndicators(), condition, emptyPatterns), true)
})

test('ma_cross_ma requires an actual crossover, not just current fast above slow', () => {
  const result = makeResult({
    chart: [
      { timestamp: 1, open: 10, high: 10, low: 10, close: 10, isClosed: true, fastMa: null, slowMa: null },
      { timestamp: 2, open: 10, high: 10, low: 10, close: 10, isClosed: true, fastMa: null, slowMa: null },
      { timestamp: 3, open: 9, high: 9, low: 9, close: 9, isClosed: true, fastMa: null, slowMa: null },
      { timestamp: 4, open: 9, high: 9, low: 9, close: 9, isClosed: true, fastMa: null, slowMa: null },
      { timestamp: 5, open: 11, high: 11, low: 11, close: 11, isClosed: true, fastMa: null, slowMa: null },
    ],
  })

  const condition: ConditionDefinition = {
    id: 'ma-cross',
    label: '均线交叉',
    kind: 'ma_cross_ma',
    enabled: true,
    params: { fast: 2, slow: 3, direction: 'up' },
  }

  assert.equal(evaluateCondition(result, makeIndicators(), condition, emptyPatterns), true)
})

test('ma_conflict detects opposite directions between two moving averages', () => {
  const result = makeResult({
    chart: [
      { timestamp: 1, open: 12, high: 12, low: 12, close: 12, isClosed: true, fastMa: null, slowMa: null },
      { timestamp: 2, open: 11, high: 11, low: 11, close: 11, isClosed: true, fastMa: null, slowMa: null },
      { timestamp: 3, open: 10, high: 10, low: 10, close: 10, isClosed: true, fastMa: null, slowMa: null },
      { timestamp: 4, open: 9, high: 9, low: 9, close: 9, isClosed: true, fastMa: null, slowMa: null },
      { timestamp: 5, open: 10, high: 10, low: 10, close: 10, isClosed: true, fastMa: null, slowMa: null },
      { timestamp: 6, open: 11, high: 11, low: 11, close: 11, isClosed: true, fastMa: null, slowMa: null },
    ],
  })

  const condition: ConditionDefinition = {
    id: 'ma-conflict',
    label: '均线相悖',
    kind: 'ma_conflict',
    enabled: true,
    params: { referencePeriod: 2, comparePeriod: 5 },
  }

  assert.equal(evaluateCondition(result, makeIndicators(), condition, emptyPatterns), true)
})

test('rsi_threshold supports range mode', () => {
  const condition: ConditionDefinition = {
    id: 'rsi-range',
    label: 'RSI 区间',
    kind: 'rsi_threshold',
    enabled: true,
    params: { period: 14, mode: 'range', min: 50, max: 60 },
  }

  assert.equal(evaluateCondition(makeResult(), makeIndicators(), condition, emptyPatterns), true)
})

test('macd_threshold supports range mode', () => {
  const condition: ConditionDefinition = {
    id: 'macd-range',
    label: 'MACD 区间',
    kind: 'macd_threshold',
    enabled: true,
    params: { line: 'histogram', mode: 'range', min: 0.1, max: 0.3 },
  }

  assert.equal(evaluateCondition(makeResult(), makeIndicators(), condition, emptyPatterns), true)
})

test('ma_slope supports range mode', () => {
  const condition: ConditionDefinition = {
    id: 'ma-slope-range',
    label: '均线斜率区间',
    kind: 'ma_slope',
    enabled: true,
    params: { period: 2, mode: 'range', min: 1, max: 3 },
  }

  assert.equal(evaluateCondition(makeResult(), makeIndicators(), condition, emptyPatterns), true)
})

test('bias_threshold supports range mode', () => {
  const condition: ConditionDefinition = {
    id: 'bias-range',
    label: 'BIAS 区间',
    kind: 'bias_threshold',
    enabled: true,
    params: { period: 5, mode: 'range', min: 1, max: 2 },
  }

  assert.equal(evaluateCondition(makeResult(), makeIndicators(), condition, emptyPatterns), true)
})

test('boll_bandwidth supports range mode', () => {
  const condition: ConditionDefinition = {
    id: 'boll-range',
    label: 'BOLL 带宽区间',
    kind: 'boll_bandwidth',
    enabled: true,
    params: { mode: 'range', min: 5, max: 10 },
  }

  assert.equal(evaluateCondition(makeResult(), makeIndicators(), condition, emptyPatterns), true)
})

test('kdj_threshold supports range mode', () => {
  const condition: ConditionDefinition = {
    id: 'kdj-range',
    label: 'KDJ 区间',
    kind: 'kdj_threshold',
    enabled: true,
    params: { line: 'k', mode: 'range', min: 50, max: 70 },
  }

  assert.equal(evaluateCondition(makeResult(), makeIndicators(), condition, emptyPatterns), true)
})

test('volume_spike supports range mode', () => {
  const condition: ConditionDefinition = {
    id: 'volume-range',
    label: '成交量区间',
    kind: 'volume_spike',
    enabled: true,
    params: { reference: 'average5', mode: 'range', minMultiplier: 1.5, maxMultiplier: 2.5 },
  }

  assert.equal(evaluateCondition(makeResult(), makeIndicators(), condition, emptyPatterns), true)
})

test('price_above_ma supports the intraday average selector', () => {
  const condition: ConditionDefinition = {
    id: 'intraday-price-above',
    label: '分时均线之上',
    kind: 'price_above_ma',
    enabled: true,
    params: { period: 'intraday' },
  }

  assert.equal(
    evaluateCondition(
      makeResult({ lastPrice: 10.1 }),
      makeIndicators({ intradayAverage: 9.95 }),
      condition,
      emptyPatterns,
    ),
    true,
  )
})
