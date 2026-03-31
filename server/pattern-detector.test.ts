import test from 'node:test'
import assert from 'node:assert/strict'

import type { RawCandle } from './gate'
import { detectPatterns } from './pattern-detector'

type CandleInput =
  | number
  | {
      open: number
      high?: number
      low?: number
      close: number
    }

function makeCandles(values: CandleInput[]): RawCandle[] {
  return values.map((value, index) => {
    const close = typeof value === 'number' ? value : value.close
    const open = typeof value === 'number' ? close : value.open
    const high = typeof value === 'number' ? Math.max(open, close) + 0.15 : (value.high ?? Math.max(open, close) + 0.15)
    const low = typeof value === 'number' ? Math.min(open, close) - 0.15 : (value.low ?? Math.min(open, close) - 0.15)

    return {
      timestamp: new Date(2026, 2, 30, 9, index * 15, 0, 0).getTime(),
      open,
      high,
      low,
      close,
      volume: 100 + index,
      confirmed: true,
    }
  })
}

function isMatched(candles: RawCandle[], key: string) {
  return detectPatterns(candles).some((pattern) => pattern.key === key && pattern.matched)
}

test('detectPatterns identifies W bottom confirmation', () => {
  const candles = makeCandles([
    { open: 10.2, close: 10.0, low: 9.95, high: 10.25 },
    { open: 10.0, close: 9.8, low: 9.7, high: 10.02 },
    { open: 9.85, close: 10.1, low: 9.8, high: 10.15 },
    { open: 10.05, close: 10.25, low: 10.0, high: 10.3 },
    { open: 10.2, close: 10.0, low: 9.78, high: 10.22 },
    { open: 10.0, close: 10.12, low: 9.92, high: 10.16 },
    { open: 10.1, close: 10.34, low: 10.05, high: 10.36 },
  ])

  assert.equal(isMatched(candles, 'double_bottom'), true)
})

test('detectPatterns identifies rounded bottom structure', () => {
  const candles = makeCandles([
    10.1,
    9.9,
    9.6,
    9.3,
    9.1,
    9.3,
    9.6,
    9.95,
    { open: 9.9, close: 10.2, high: 10.25, low: 9.88 },
  ])

  assert.equal(isMatched(candles, 'rounded_bottom'), true)
})

test('detectPatterns identifies bull flag breakout', () => {
  const candles = makeCandles([
    { open: 10.0, close: 10.4, high: 10.45, low: 9.98 },
    { open: 10.38, close: 10.75, high: 10.8, low: 10.35 },
    { open: 10.72, close: 11.05, high: 11.1, low: 10.7 },
    { open: 11.0, close: 11.28, high: 11.3, low: 10.98 },
    { open: 11.22, close: 11.12, high: 11.25, low: 11.05 },
    { open: 11.12, close: 11.04, high: 11.16, low: 11.0 },
    { open: 11.05, close: 11.08, high: 11.1, low: 11.01 },
    { open: 11.08, close: 11.32, high: 11.36, low: 11.06 },
  ])

  assert.equal(isMatched(candles, 'bull_flag_breakout'), true)
})

test('detectPatterns identifies lotus breakout and guillotine around MA bundle', () => {
  const lotusCandles = makeCandles([
    10.03, 10.01, 10.02, 10.0, 10.01, 10.02, 10.01, 10.0, 10.02, 10.01,
    10.0, 10.02, 10.01, 10.0, 10.01, 10.0, 10.02, 10.01, 10.0,
    { open: 9.98, close: 10.32, high: 10.35, low: 9.96 },
  ])
  const guillotineCandles = makeCandles([
    10.03, 10.01, 10.02, 10.0, 10.01, 10.02, 10.01, 10.0, 10.02, 10.01,
    10.0, 10.02, 10.01, 10.0, 10.01, 10.0, 10.02, 10.01, 10.0,
    { open: 10.32, close: 9.96, high: 10.34, low: 9.93 },
  ])

  assert.equal(isMatched(lotusCandles, 'lotus_breakout'), true)
  assert.equal(isMatched(guillotineCandles, 'guillotine'), true)
})

test('detectPatterns identifies double needle bottom and three incense', () => {
  const doubleNeedleCandles = makeCandles([
    { open: 10.1, close: 10.0, high: 10.15, low: 9.98 },
    { open: 10.0, close: 10.08, high: 10.1, low: 9.55 },
    { open: 10.07, close: 10.02, high: 10.09, low: 9.96 },
    { open: 10.0, close: 10.1, high: 10.12, low: 9.57 },
    { open: 10.08, close: 10.18, high: 10.22, low: 10.05 },
  ])
  const threeIncenseCandles = makeCandles([
    9.8,
    9.7,
    9.75,
    { open: 9.74, close: 9.9, high: 9.92, low: 9.7 },
    { open: 9.88, close: 10.05, high: 10.08, low: 9.86 },
    { open: 10.0, close: 10.22, high: 10.24, low: 9.98 },
  ])

  assert.equal(isMatched(doubleNeedleCandles, 'double_needle_bottom'), true)
  assert.equal(isMatched(threeIncenseCandles, 'three_incense'), true)
})
