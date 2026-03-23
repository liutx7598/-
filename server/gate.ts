import { TIMEFRAME_MAP, type ApiBar, type TimeframeKey } from '../shared/timeframes'

const DEFAULT_GATE_BASE_URLS = [
  'https://fx-api.gateio.ws/api/v4',
  'https://api.gateio.ws/api/v4',
]

export interface GateInstrument {
  instId: string
  instFamily: string
  baseCcy: string
  quoteCcy: string
  settleCcy: string
  state: string
}

export interface RawCandle {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  confirmed: boolean
}

interface GateContractResponse {
  name: string
  in_delisting?: boolean
  last_price?: string
}

type GateCandleResponse =
  | {
      t?: number | string
      o?: number | string
      h?: number | string
      l?: number | string
      c?: number | string
      v?: number | string
      sum?: number | string
    }
  | string[]

function getGateBaseUrls() {
  const configured = process.env.GATE_API_BASE_URLS?.split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  return configured && configured.length > 0
    ? configured
    : DEFAULT_GATE_BASE_URLS
}

function getIntervalMs(interval: ApiBar) {
  const minutes = TIMEFRAME_MAP[
    Object.keys(TIMEFRAME_MAP).find(
      (key) => TIMEFRAME_MAP[key as TimeframeKey].apiBar === interval,
    ) as TimeframeKey
  ]?.minutes

  return (minutes ?? 1) * 60 * 1000
}

async function fetchGate<T>(pathname: string, query: Record<string, string>) {
  const search = new URLSearchParams(query)
  const suffix = search.toString() ? `?${search.toString()}` : ''
  let lastError: unknown = null

  for (const baseUrl of getGateBaseUrls()) {
    const controller = new AbortController()
    let timeoutId: NodeJS.Timeout | null = null

    try {
      const response = await Promise.race([
        fetch(`${baseUrl}${pathname}${suffix}`, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'gate-pattern-screener/1.0',
          },
          signal: controller.signal,
        }),
        new Promise<Response>((_, reject) => {
          timeoutId = setTimeout(() => {
            controller.abort()
            reject(new Error(`Gate request timed out for ${baseUrl}${pathname}`))
          }, 10_000)
        }),
      ])

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(
          `Gate HTTP ${response.status}${errorText ? `: ${errorText.slice(0, 180)}` : ''}`,
        )
      }

      return (await response.json()) as T
    } catch (error) {
      lastError =
        error instanceof Error && error.name === 'AbortError'
          ? new Error(`Gate request timed out for ${baseUrl}${pathname}`)
          : error
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Unable to reach Gate futures market API.')
}

function mapContractToInstrument(contract: GateContractResponse): GateInstrument | null {
  const [baseCcy, quoteCcy] = contract.name.split('_')

  if (!baseCcy || !quoteCcy) {
    return null
  }

  return {
    instId: contract.name,
    instFamily: `${baseCcy}_${quoteCcy}`,
    baseCcy,
    quoteCcy,
    settleCcy: 'USDT',
    state: contract.in_delisting ? 'suspend' : 'live',
  }
}

export async function fetchSwapInstruments() {
  const contracts = await fetchGate<GateContractResponse[]>('/futures/usdt/contracts', {})

  return contracts
    .filter((contract) => !contract.in_delisting)
    .map(mapContractToInstrument)
    .filter((contract): contract is GateInstrument => Boolean(contract))
}

function normalizeGateCandle(row: GateCandleResponse, interval: ApiBar): RawCandle | null {
  const source =
    Array.isArray(row)
      ? {
          t: row[0],
          v: row[1],
          c: row[2],
          h: row[3],
          l: row[4],
          o: row[5],
        }
      : row
  const timestampSeconds = Number(source.t)
  const open = Number(source.o)
  const high = Number(source.h)
  const low = Number(source.l)
  const close = Number(source.c)
  const volume = Number(source.v ?? source.sum ?? 0)

  if (
    !Number.isFinite(timestampSeconds) ||
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close)
  ) {
    return null
  }

  const timestamp = timestampSeconds * 1000

  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume: Number.isFinite(volume) ? volume : 0,
    confirmed: timestamp + getIntervalMs(interval) <= Date.now(),
  }
}

export async function fetchCandles(instId: string, bar: ApiBar, limit: number) {
  const rows = await fetchGate<GateCandleResponse[]>('/futures/usdt/candlesticks', {
    contract: instId,
    interval: bar,
    limit: String(limit),
  })

  return rows
    .map((row) => normalizeGateCandle(row, bar))
    .filter((row): row is RawCandle => Boolean(row))
    .sort((left, right) => left.timestamp - right.timestamp)
}

export function getRawBarsForSelection(selectedTimeframes: TimeframeKey[]) {
  const uniqueBars = new Set(
    selectedTimeframes.map((timeframe) => TIMEFRAME_MAP[timeframe].apiBar),
  )

  return [...uniqueBars]
}

export function aggregateCandles(candles: RawCandle[], timeframe: TimeframeKey) {
  const definition = TIMEFRAME_MAP[timeframe]

  if (!definition.syntheticFrom || !definition.syntheticSize) {
    return candles
  }

  const intervalMs = definition.minutes * 60 * 1000
  const offsetMs = -new Date().getTimezoneOffset() * 60 * 1000
  const bucketed = new Map<number, RawCandle[]>()

  for (const candle of candles.filter((item) => item.confirmed)) {
    const bucketKey = Math.floor((candle.timestamp + offsetMs) / intervalMs)
    const bucket = bucketed.get(bucketKey) ?? []
    bucket.push(candle)
    bucketed.set(bucketKey, bucket)
  }

  return [...bucketed.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, bucket]) =>
      bucket.sort((left, right) => left.timestamp - right.timestamp),
    )
    .filter((bucket) => bucket.length === definition.syntheticSize)
    .map((bucket) => ({
      timestamp: bucket[0].timestamp,
      open: bucket[0].open,
      high: Math.max(...bucket.map((item) => item.high)),
      low: Math.min(...bucket.map((item) => item.low)),
      close: bucket[bucket.length - 1].close,
      volume: bucket.reduce((sum, item) => sum + item.volume, 0),
      confirmed: bucket.every((item) => item.confirmed),
    }))
}
