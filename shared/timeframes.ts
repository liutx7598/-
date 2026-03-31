export type TimeframeKey =
  | 'intraday'
  | '1m'
  | '5m'
  | '10m'
  | '15m'
  | '30m'
  | '1H'
  | '2H'
  | '3H'
  | '4H'
  | '8H'
  | '12H'
  | '1D'
  | '2D'
  | '3D'

export type ApiBar = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '8h' | '1d'

export interface TimeframeDefinition {
  key: TimeframeKey
  label: string
  apiBar: ApiBar
  minutes: number
  sortOrder: number
  syntheticFrom?: ApiBar
  syntheticSize?: number
}

export const TIMEFRAME_DEFINITIONS: TimeframeDefinition[] = [
  { key: 'intraday', label: '分时', apiBar: '1m', minutes: 1, sortOrder: 0 },
  { key: '1m', label: '1m', apiBar: '1m', minutes: 1, sortOrder: 1 },
  { key: '5m', label: '5m', apiBar: '5m', minutes: 5, sortOrder: 2 },
  {
    key: '10m',
    label: '10m',
    apiBar: '5m',
    minutes: 10,
    sortOrder: 3,
    syntheticFrom: '5m',
    syntheticSize: 2,
  },
  { key: '15m', label: '15m', apiBar: '15m', minutes: 15, sortOrder: 4 },
  { key: '30m', label: '30m', apiBar: '30m', minutes: 30, sortOrder: 5 },
  { key: '1H', label: '1H', apiBar: '1h', minutes: 60, sortOrder: 6 },
  {
    key: '2H',
    label: '2H',
    apiBar: '1h',
    minutes: 120,
    sortOrder: 7,
    syntheticFrom: '1h',
    syntheticSize: 2,
  },
  {
    key: '3H',
    label: '3H',
    apiBar: '1h',
    minutes: 180,
    sortOrder: 8,
    syntheticFrom: '1h',
    syntheticSize: 3,
  },
  { key: '4H', label: '4H', apiBar: '4h', minutes: 240, sortOrder: 9 },
  { key: '8H', label: '8H', apiBar: '8h', minutes: 480, sortOrder: 10 },
  {
    key: '12H',
    label: '12H',
    apiBar: '1h',
    minutes: 720,
    sortOrder: 11,
    syntheticFrom: '1h',
    syntheticSize: 12,
  },
  { key: '1D', label: '1D', apiBar: '1d', minutes: 1440, sortOrder: 12 },
  {
    key: '2D',
    label: '2D',
    apiBar: '1d',
    minutes: 2880,
    sortOrder: 13,
    syntheticFrom: '1d',
    syntheticSize: 2,
  },
  {
    key: '3D',
    label: '3D',
    apiBar: '1d',
    minutes: 4320,
    sortOrder: 14,
    syntheticFrom: '1d',
    syntheticSize: 3,
  },
]

export const DEFAULT_TIMEFRAMES: TimeframeKey[] = ['15m', '1H', '2H', '3H', '4H']

export const TIMEFRAME_MAP = Object.fromEntries(
  TIMEFRAME_DEFINITIONS.map((timeframe) => [timeframe.key, timeframe]),
) as Record<TimeframeKey, TimeframeDefinition>
