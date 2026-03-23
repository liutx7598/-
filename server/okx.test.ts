import test from 'node:test'
import assert from 'node:assert/strict'

import {
  aggregateCandles,
  getRawBarsForSelection,
  type RawCandle,
} from './gate'

function localTimestamp(hour: number) {
  return new Date(2026, 2, 20, hour, 0, 0, 0).getTime()
}

function createRawCandle(
  hour: number,
  close: number,
  options: Partial<RawCandle> = {},
): RawCandle {
  return {
    timestamp: localTimestamp(hour),
    open: close - 0.2,
    high: close + 0.5,
    low: close - 0.6,
    close,
    volume: 10,
    confirmed: true,
    ...options,
  }
}

test('getRawBarsForSelection deduplicates API bars for synthetic timeframes', () => {
  const bars = getRawBarsForSelection(['15m', '1H', '3H', '4H', '3H'])
  assert.deepEqual(bars, ['15m', '1h', '4h'])
})

test('aggregateCandles returns original data for non-synthetic timeframe', () => {
  const candles = [createRawCandle(9, 10), createRawCandle(10, 11)]
  assert.deepEqual(aggregateCandles(candles, '1H'), candles)
})

test('aggregateCandles merges three confirmed 1H candles into one 3H candle', () => {
  const candles = [
    createRawCandle(9, 10, { open: 9.8, high: 10.3, low: 9.7, volume: 11 }),
    createRawCandle(10, 12, { open: 10.1, high: 12.4, low: 10.0, volume: 12 }),
    createRawCandle(11, 11, { open: 11.2, high: 11.7, low: 10.8, volume: 13 }),
  ]

  const [result] = aggregateCandles(candles, '3H')

  assert.equal(result.timestamp, candles[0].timestamp)
  assert.equal(result.open, 9.8)
  assert.equal(result.high, 12.4)
  assert.equal(result.low, 9.7)
  assert.equal(result.close, 11)
  assert.equal(result.volume, 36)
  assert.equal(result.confirmed, true)
})

test('aggregateCandles ignores incomplete 3H buckets', () => {
  const candles = [createRawCandle(9, 10), createRawCandle(10, 11)]
  const result = aggregateCandles(candles, '3H')
  assert.equal(result.length, 0)
})

test('aggregateCandles skips unconfirmed candles before grouping', () => {
  const candles = [
    createRawCandle(9, 10),
    createRawCandle(10, 11, { confirmed: false }),
    createRawCandle(11, 12),
    createRawCandle(12, 13),
  ]

  const result = aggregateCandles(candles, '3H')
  assert.equal(result.length, 0)
})
