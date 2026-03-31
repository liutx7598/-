import type { IndicatorSnapshot } from '../shared/platform-types'
import type { RawCandle } from './gate'

const SHANGHAI_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function calculateSma(values: number[], period: number) {
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

export function calculateEma(values: number[], period: number) {
  const result: Array<number | null> = Array.from({ length: values.length }, () => null)
  const multiplier = 2 / (period + 1)

  for (let index = 0; index < values.length; index += 1) {
    if (index === 0) {
      result[index] = values[index]
      continue
    }

    const previous = result[index - 1]
    result[index] =
      previous === null ? values[index] : (values[index] - previous) * multiplier + previous
  }

  return result
}

export function calculateMacd(values: number[], shortPeriod = 12, longPeriod = 26, signalPeriod = 9) {
  const shortEma = calculateEma(values, shortPeriod)
  const longEma = calculateEma(values, longPeriod)
  const dif = values.map((_, index) =>
    shortEma[index] !== null && longEma[index] !== null ? shortEma[index]! - longEma[index]! : null,
  )
  const dea = calculateEma(
    dif.map((value) => value ?? 0),
    signalPeriod,
  )

  const histogram = dif.map((value, index) =>
    value !== null && dea[index] !== null ? (value - dea[index]!) * 2 : null,
  )

  return { dif, dea, histogram }
}

export function calculateRsi(values: number[], period: number) {
  const result: Array<number | null> = Array.from({ length: values.length }, () => null)
  let gainSum = 0
  let lossSum = 0

  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1]
    gainSum += Math.max(delta, 0)
    lossSum += Math.max(-delta, 0)

    if (index > period) {
      const previousDelta = values[index - period] - values[index - period - 1]
      gainSum -= Math.max(previousDelta, 0)
      lossSum -= Math.max(-previousDelta, 0)
    }

    if (index >= period) {
      if (lossSum === 0) {
        result[index] = 100
      } else {
        const rs = gainSum / lossSum
        result[index] = 100 - 100 / (1 + rs)
      }
    }
  }

  return result
}

export function calculateStdDev(values: number[], period: number) {
  const result: Array<number | null> = Array.from({ length: values.length }, () => null)

  for (let index = period - 1; index < values.length; index += 1) {
    const window = values.slice(index - period + 1, index + 1)
    const mean = window.reduce((sum, value) => sum + value, 0) / period
    const variance =
      window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period
    result[index] = Math.sqrt(variance)
  }

  return result
}

export function calculateBoll(values: number[], period = 20, deviation = 2) {
  const middle = calculateSma(values, period)
  const stdSeries = calculateStdDev(values, period)

  return {
    middle,
    upper: middle.map((value, index) =>
      value !== null && stdSeries[index] !== null ? value + deviation * stdSeries[index]! : null,
    ),
    lower: middle.map((value, index) =>
      value !== null && stdSeries[index] !== null ? value - deviation * stdSeries[index]! : null,
    ),
  }
}

export function calculateKdj(candles: RawCandle[], period = 9) {
  const kSeries: Array<number | null> = Array.from({ length: candles.length }, () => null)
  const dSeries: Array<number | null> = Array.from({ length: candles.length }, () => null)
  const jSeries: Array<number | null> = Array.from({ length: candles.length }, () => null)
  let previousK = 50
  let previousD = 50

  for (let index = period - 1; index < candles.length; index += 1) {
    const window = candles.slice(index - period + 1, index + 1)
    const lowest = Math.min(...window.map((item) => item.low))
    const highest = Math.max(...window.map((item) => item.high))
    const denominator = highest - lowest
    const rsv =
      denominator === 0 ? 50 : ((candles[index].close - lowest) / denominator) * 100
    const k = (2 * previousK + rsv) / 3
    const d = (2 * previousD + k) / 3
    const j = 3 * k - 2 * d

    kSeries[index] = k
    dSeries[index] = d
    jSeries[index] = j
    previousK = k
    previousD = d
  }

  return { k: kSeries, d: dSeries, j: jSeries }
}

export function calculateBias(values: number[], period: number) {
  const movingAverage = calculateSma(values, period)
  return movingAverage.map((value, index) =>
    value === null || value === 0 ? null : ((values[index] - value) / value) * 100,
  )
}

function buildTradingDayKey(timestamp: number) {
  return SHANGHAI_DAY_FORMATTER.format(new Date(timestamp))
}

export function calculateIntradayAverage(candles: RawCandle[]) {
  const result: Array<number | null> = Array.from({ length: candles.length }, () => null)
  let runningTotal = 0
  let runningCount = 0
  let currentDayKey = ''

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]
    const nextDayKey = buildTradingDayKey(candle.timestamp)

    if (nextDayKey !== currentDayKey) {
      currentDayKey = nextDayKey
      runningTotal = 0
      runningCount = 0
    }

    runningTotal += candle.close
    runningCount += 1
    result[index] = runningTotal / runningCount
  }

  return result
}

export function buildIndicatorSnapshot(candles: RawCandle[]): IndicatorSnapshot {
  const closes = candles.map((item) => item.close)
  const volumes = candles.map((item) => item.volume)
  const movingAveragePeriods = [5, 10, 20, 30, 60, 120]
  const intradayAverage = calculateIntradayAverage(candles)
  const movingAverages = Object.fromEntries(
    movingAveragePeriods.map((period) => [
      `MA${period}`,
      calculateSma(closes, period)[closes.length - 1] ?? null,
    ]),
  )
  const macd = calculateMacd(closes)
  const boll = calculateBoll(closes)
  const kdj = calculateKdj(candles)
  const rsi6 = calculateRsi(closes, 6)
  const rsi14 = calculateRsi(closes, 14)
  const rsi24 = calculateRsi(closes, 24)
  const bias5 = calculateBias(closes, 5)
  const bias10 = calculateBias(closes, 10)
  const bias20 = calculateBias(closes, 20)
  const volume5 = calculateSma(volumes, 5)
  const volume20 = calculateSma(volumes, 20)
  const lastIndex = closes.length - 1

  return {
    movingAverages,
    intradayAverage: intradayAverage[lastIndex] ?? null,
    macd: {
      dif: macd.dif[lastIndex] ?? null,
      dea: macd.dea[lastIndex] ?? null,
      histogram: macd.histogram[lastIndex] ?? null,
    },
    boll: {
      upper: boll.upper[lastIndex] ?? null,
      middle: boll.middle[lastIndex] ?? null,
      lower: boll.lower[lastIndex] ?? null,
    },
    kdj: {
      k: kdj.k[lastIndex] ?? null,
      d: kdj.d[lastIndex] ?? null,
      j: kdj.j[lastIndex] ?? null,
    },
    rsi: {
      rsi6: rsi6[lastIndex] ?? null,
      rsi14: rsi14[lastIndex] ?? null,
      rsi24: rsi24[lastIndex] ?? null,
    },
    bias: {
      BIAS5: bias5[lastIndex] ?? null,
      BIAS10: bias10[lastIndex] ?? null,
      BIAS20: bias20[lastIndex] ?? null,
    },
    volume: {
      current: volumes[lastIndex] ?? null,
      average5: volume5[lastIndex] ?? null,
      average20: volume20[lastIndex] ?? null,
    },
  }
}
