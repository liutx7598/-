import path from 'node:path'
import { randomUUID } from 'node:crypto'

import type { ConditionDefinition, StrategyPreset } from '../shared/platform-types'
import type { TimeframeKey } from '../shared/timeframes'
import { JsonStore } from './platform-storage'

const strategyStore = new JsonStore<StrategyPreset[]>(
  path.join(process.cwd(), 'server', 'data', 'strategy-presets.json'),
  [],
)

export function createDefaultConditions(): ConditionDefinition[] {
  return [
    {
      id: 'ma5-ma20-converge',
      label: 'MA5/MA20 收拢',
      kind: 'ma_convergence',
      enabled: true,
      params: { fast: 5, slow: 20, thresholdPct: 0.8 },
    },
    {
      id: 'ma5-up',
      label: 'MA5 抬头向上',
      kind: 'ma_trend',
      enabled: true,
      params: { period: 5, direction: 'up' },
    },
    {
      id: 'price-cross-ma5',
      label: 'K 线实体上穿 MA5',
      kind: 'price_cross_ma',
      enabled: true,
      params: { period: 5, direction: 'up' },
    },
  ]
}

export function createDefaultStrategy(selectedTimeframes: TimeframeKey[]): StrategyPreset {
  const timestamp = new Date().toISOString()
  return {
    id: 'default-ma-strategy',
    name: '默认均线收拢策略',
    description: '兼容当前 MA5/MA20 收拢 + MA5 抬头 + K 线实体上穿 MA5 的基线逻辑',
    favorite: true,
    autoRun: true,
    scheduleIntervalMinutes: 15,
    selectedTimeframes,
    conditions: createDefaultConditions(),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export class StrategyPresetService {
  async list(selectedTimeframes: TimeframeKey[]) {
    const presets = await strategyStore.load()
    return presets.length > 0 ? presets : [createDefaultStrategy(selectedTimeframes)]
  }

  async getById(id: string, selectedTimeframes: TimeframeKey[]) {
    const presets = await this.list(selectedTimeframes)
    return presets.find((item) => item.id === id) ?? null
  }

  async upsert(
    payload: Partial<StrategyPreset> &
      Pick<StrategyPreset, 'name' | 'conditions' | 'selectedTimeframes'>,
  ) {
    const presets = await strategyStore.load()
    const timestamp = new Date().toISOString()
    const nextPreset: StrategyPreset = {
      id: payload.id ?? randomUUID(),
      name: payload.name,
      description: payload.description ?? '',
      favorite: Boolean(payload.favorite),
      autoRun: Boolean(payload.autoRun),
      scheduleIntervalMinutes: payload.scheduleIntervalMinutes ?? null,
      selectedTimeframes: payload.selectedTimeframes,
      conditions: payload.conditions,
      createdAt: payload.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    const nextPresets = [
      nextPreset,
      ...presets.filter((item) => item.id !== nextPreset.id),
    ]

    await strategyStore.save(nextPresets)
    return nextPreset
  }
}
