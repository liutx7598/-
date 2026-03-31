import assert from 'node:assert/strict'
import test from 'node:test'

import { createRuleBasedOverview } from './llm'

test('createRuleBasedOverview returns a short readable summary', () => {
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
      { instId: 'BTC_USDT', timeframe: '15m', timeframeLabel: '15m' },
      { instId: 'ETH_USDT', timeframe: '1H', timeframeLabel: '1H' },
    ],
    newSignalSamples: ['BTC_USDT 15m'],
    removedSignalSamples: ['DOGE_USDT 15m'],
  })

  assert.match(summary, /本轮命中 12 条/)
  assert.match(summary, /15m/)
  assert.match(summary, /BTC_USDT 15m/)
  assert.ok(summary.length <= 140)
})

test('createRuleBasedOverview handles empty samples gracefully', () => {
  const summary = createRuleBasedOverview({
    totalMatches: 0,
    newMatches: 0,
    removedMatches: 3,
    refreshIntervalMinutes: 15,
    leadingTimeframeLabel: null,
    timeframeStats: [],
    sampleSignals: [],
    newSignalSamples: [],
    removedSignalSamples: ['SOL_USDT 1H'],
  })

  assert.match(summary, /当前没有明显主导周期/)
  assert.match(summary, /当前暂无代表标的/)
})
