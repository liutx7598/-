import { TIMEFRAME_MAP, type TimeframeKey } from '../../shared/timeframes'
import type { ChartCandle, ScreenerResult } from '../../shared/types'

const configuredWsUrl = import.meta.env.VITE_GATE_WS_URL?.trim()

export const GATE_PUBLIC_WS_URLS = configuredWsUrl
  ? [configuredWsUrl]
  : ['wss://fx-ws.gateio.ws/v4/ws/usdt']

interface RealtimeArg {
  channel: 'futures.tickers' | 'futures.candlesticks'
  payload: string[]
}

export interface TickerUpdate {
  instId: string
  lastPrice: number
}

export interface CandleUpdate {
  instId: string
  timeframe: TimeframeKey
  candle: ChartCandle
}

interface GateRealtimeEnvelope {
  channel?: string
  event?: string
  result?: unknown
}

function isSameCandle(left: ChartCandle, right: ChartCandle) {
  return (
    left.timestamp === right.timestamp &&
    left.open === right.open &&
    left.high === right.high &&
    left.low === right.low &&
    left.close === right.close &&
    left.isClosed === right.isClosed &&
    left.fastMa === right.fastMa &&
    left.slowMa === right.slowMa
  )
}

function calculateMovingAverage(values: number[], period: number) {
  const result: Array<number | null> = Array.from({ length: values.length }, () => null)
  let rollingSum = 0

  for (let index = 0; index < values.length; index += 1) {
    rollingSum += values[index]

    if (index >= period) {
      rollingSum -= values[index - period]
    }

    if (index >= period - 1) {
      result[index] = rollingSum / period
    }
  }

  return result
}

function normalizeRealtimeInterval(timeframe: TimeframeKey) {
  const definition = TIMEFRAME_MAP[timeframe]

  if (definition.syntheticFrom) {
    return null
  }

  return definition.apiBar
}

function intervalToTimeframe(interval: string) {
  const match = Object.entries(TIMEFRAME_MAP).find(
    ([, definition]) => definition.apiBar === interval && !definition.syntheticFrom,
  )

  return (match?.[0] as TimeframeKey | undefined) ?? null
}

function intervalToMs(interval: string) {
  const timeframe = intervalToTimeframe(interval)

  if (!timeframe) {
    return 60_000
  }

  return TIMEFRAME_MAP[timeframe].minutes * 60 * 1000
}

export function buildRealtimeSubscriptionArgs(
  results: ScreenerResult[],
  selectedResult: ScreenerResult | null,
) {
  const map = new Map<string, RealtimeArg>()

  for (const result of results) {
    map.set(`futures.tickers:${result.instId}`, {
      channel: 'futures.tickers',
      payload: [result.instId],
    })
  }

  if (selectedResult) {
    const interval = normalizeRealtimeInterval(selectedResult.timeframe)

    if (interval) {
      map.set(`futures.candlesticks:${interval}:${selectedResult.instId}`, {
        channel: 'futures.candlesticks',
        payload: [interval, selectedResult.instId],
      })
    }
  }

  return [...map.values()]
}

export function buildRealtimeArgsKey(args: RealtimeArg[]) {
  return args
    .map((arg) => `${arg.channel}:${arg.payload.join(':')}`)
    .sort()
    .join('|')
}

export function buildSubscriptionMessage(arg: RealtimeArg) {
  return JSON.stringify({
    time: Math.floor(Date.now() / 1000),
    channel: arg.channel,
    event: 'subscribe',
    payload: arg.payload,
  })
}

export function buildPingMessage() {
  return JSON.stringify({
    time: Math.floor(Date.now() / 1000),
    channel: 'futures.ping',
  })
}

function parseTickerUpdates(payload: GateRealtimeEnvelope) {
  if (payload.channel !== 'futures.tickers' || !Array.isArray(payload.result)) {
    return []
  }

  return payload.result
    .map((entry) => entry as { contract?: string; last?: string | number })
    .map((entry) => ({
      instId: entry.contract ?? '',
      lastPrice: Number(entry.last),
    }))
    .filter((entry) => entry.instId && Number.isFinite(entry.lastPrice))
}

function parseCandleMarker(marker: string) {
  const firstSeparator = marker.indexOf('_')

  if (firstSeparator <= 0) {
    return null
  }

  return {
    interval: marker.slice(0, firstSeparator),
    instId: marker.slice(firstSeparator + 1),
  }
}

function parseCandleUpdates(payload: GateRealtimeEnvelope) {
  if (payload.channel !== 'futures.candlesticks' || !Array.isArray(payload.result)) {
    return []
  }

  return payload.result
    .map(
      (entry) =>
        entry as {
          n?: string
          t?: string | number
          o?: string | number
          h?: string | number
          l?: string | number
          c?: string | number
        },
    )
    .map((entry): CandleUpdate | null => {
      const marker = parseCandleMarker(entry.n ?? '')
      const timeframe = marker ? intervalToTimeframe(marker.interval) : null
      const timestamp = Number(entry.t) * 1000

      if (!marker || !timeframe) {
        return null
      }

      return {
        instId: marker.instId,
        timeframe,
        candle: {
          timestamp,
          open: Number(entry.o),
          high: Number(entry.h),
          low: Number(entry.l),
          close: Number(entry.c),
          isClosed: timestamp + intervalToMs(marker.interval) <= Date.now(),
          fastMa: null,
          slowMa: null,
        } satisfies ChartCandle,
      }
    })
    .filter((entry): entry is CandleUpdate => {
      if (!entry) {
        return false
      }

      return (
        entry.instId.length > 0 &&
        Number.isFinite(entry.candle.close) &&
        Number.isFinite(entry.candle.timestamp)
      )
    })
}

export function parseRealtimeMessage(rawMessage: string) {
  try {
    const payload = JSON.parse(rawMessage) as GateRealtimeEnvelope
    return {
      pong: payload.channel === 'futures.ping',
      event: payload.event,
      tickers: parseTickerUpdates(payload),
      candles: parseCandleUpdates(payload),
    }
  } catch {
    return {
      pong: false,
      tickers: [] as TickerUpdate[],
      candles: [] as CandleUpdate[],
    }
  }
}

export function mergeRealtimeCandleSeries(
  candles: ChartCandle[],
  incomingCandle: ChartCandle,
  fastMaPeriod: number,
  slowMaPeriod: number,
  limit: number,
) {
  const nextCandles = [...candles]
  const lastCandle = nextCandles[nextCandles.length - 1]

  if (lastCandle && lastCandle.timestamp === incomingCandle.timestamp) {
    if (
      lastCandle.open === incomingCandle.open &&
      lastCandle.high === incomingCandle.high &&
      lastCandle.low === incomingCandle.low &&
      lastCandle.close === incomingCandle.close &&
      lastCandle.isClosed === incomingCandle.isClosed
    ) {
      return candles
    }

    nextCandles[nextCandles.length - 1] = incomingCandle
  } else if (!lastCandle || incomingCandle.timestamp > lastCandle.timestamp) {
    nextCandles.push(incomingCandle)
  } else {
    return candles
  }

  const slicedCandles = nextCandles.slice(-Math.max(limit, slowMaPeriod + 2))
  const closes = slicedCandles.map((candle) => candle.close)
  const fastSeries = calculateMovingAverage(closes, fastMaPeriod)
  const slowSeries = calculateMovingAverage(closes, slowMaPeriod)

  const nextSeries = slicedCandles.map((candle, index) => ({
    ...candle,
    fastMa: fastSeries[index],
    slowMa: slowSeries[index],
  }))

  if (
    nextSeries.length === candles.length &&
    nextSeries.every((candle, index) => isSameCandle(candle, candles[index]))
  ) {
    return candles
  }

  return nextSeries
}
