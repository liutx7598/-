import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'

import {
  buildHistoryTimestamp,
  buildOverviewHistoryBaseName,
  buildSignalHistoryBaseName,
  listLlmHistory,
} from './llm-history'

function formatLocalStamp(value: string) {
  const date = new Date(value)
  return [
    date.getFullYear().toString().padStart(4, '0'),
    (date.getMonth() + 1).toString().padStart(2, '0'),
    date.getDate().toString().padStart(2, '0'),
    '-',
    date.getHours().toString().padStart(2, '0'),
    date.getMinutes().toString().padStart(2, '0'),
    date.getSeconds().toString().padStart(2, '0'),
    '-',
    date.getMilliseconds().toString().padStart(3, '0'),
  ].join('')
}

test('buildHistoryTimestamp formats a safe sortable timestamp string', () => {
  assert.equal(
    buildHistoryTimestamp('2026-03-23T03:34:48.451Z'),
    formatLocalStamp('2026-03-23T03:34:48.451Z'),
  )
})

test('buildSignalHistoryBaseName includes timestamp, type, instrument and timeframe', () => {
  assert.equal(
    buildSignalHistoryBaseName(
      'ETH-USD_UM-SWAP:15m:1774234800000',
      '2026-03-23T03:34:48.451Z',
    ),
    `${formatLocalStamp('2026-03-23T03:34:48.451Z')}__signal__ETH-USD_UM-SWAP__15m__1774234800000`,
  )
})

test('buildOverviewHistoryBaseName includes status and leading timeframe', () => {
  assert.equal(
    buildOverviewHistoryBaseName({
      status: 'ready',
      source: 'llm',
      summary: '摘要',
      generatedAt: '2026-03-23T03:23:37.898Z',
      basedOnRunAt: '2026-03-23T03:21:51.071Z',
      error: null,
      totalMatches: 14,
      newMatches: 14,
      removedMatches: 0,
      leadingTimeframeLabel: '1H',
      timeframeStats: [],
      sampleSignals: [],
    }),
    `${formatLocalStamp('2026-03-23T03:23:37.898Z')}__overview__ready__1H__14`,
  )
})

test('listLlmHistory merges overview and signal records in reverse chronological order', async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'llm-history-'))
  await mkdir(path.join(rootDirectory, 'overview'), { recursive: true })
  await mkdir(path.join(rootDirectory, 'signals'), { recursive: true })

  await writeFile(
    path.join(rootDirectory, 'overview', '20260323-120000-000__overview__ready__15m__5.json'),
    JSON.stringify({
      type: 'overview',
      model: 'qwen3.5-plus',
      status: 'ready',
      source: 'llm',
      summary: '首页总览摘要',
      generatedAt: '2026-03-23T12:00:00.000Z',
      basedOnRunAt: '2026-03-23T11:45:00.000Z',
      totalMatches: 5,
      newMatches: 2,
      removedMatches: 1,
      leadingTimeframeLabel: '15m',
    }),
    'utf-8',
  )
  await writeFile(
    path.join(rootDirectory, 'overview', '20260323-120000-000__overview__ready__15m__5.md'),
    '# overview markdown',
    'utf-8',
  )
  await writeFile(
    path.join(rootDirectory, 'signals', '20260323-121500-000__signal__BTC_USDT__1H__1.json'),
    JSON.stringify({
      type: 'signal',
      model: 'qwen3.5-plus',
      analyzedAt: '2026-03-23T12:15:00.000Z',
      instId: 'BTC_USDT',
      timeframe: '1H',
      timeframeLabel: '1H',
      signalKey: 'BTC_USDT:1H:1',
      summary: 'BTC 1H 信号摘要',
    }),
    'utf-8',
  )

  const response = await listLlmHistory({ rootDirectory, type: 'all', limit: 10 })

  assert.equal(response.total, 2)
  assert.equal(response.items[0].type, 'signal')
  assert.equal(response.items[0].instId, 'BTC_USDT')
  assert.equal(response.items[1].type, 'overview')
  assert.equal(response.items[1].totalMatches, 5)
  assert.match(response.items[1].markdown, /overview markdown/)
})

test('listLlmHistory filters by keyword and type', async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'llm-history-filter-'))
  await mkdir(path.join(rootDirectory, 'overview'), { recursive: true })
  await mkdir(path.join(rootDirectory, 'signals'), { recursive: true })

  await writeFile(
    path.join(rootDirectory, 'signals', '20260323-121500-000__signal__ETH_USDT__15m__1.json'),
    JSON.stringify({
      type: 'signal',
      analyzedAt: '2026-03-23T12:15:00.000Z',
      instId: 'ETH_USDT',
      timeframe: '15m',
      timeframeLabel: '15m',
      signalKey: 'ETH_USDT:15m:1',
      summary: 'ETH 15m 突破摘要',
    }),
    'utf-8',
  )
  await writeFile(
    path.join(rootDirectory, 'overview', '20260323-120000-000__overview__ready__15m__5.json'),
    JSON.stringify({
      type: 'overview',
      summary: '市场总览摘要',
      generatedAt: '2026-03-23T12:00:00.000Z',
      totalMatches: 5,
      newMatches: 2,
      removedMatches: 1,
    }),
    'utf-8',
  )

  const response = await listLlmHistory({
    rootDirectory,
    type: 'signal',
    keyword: 'eth',
    limit: 10,
  })

  assert.equal(response.total, 1)
  assert.equal(response.items[0].type, 'signal')
  assert.equal(response.items[0].instId, 'ETH_USDT')
})
