import type {
  ConditionDefinition,
  CrossDirection,
  IndicatorSnapshot,
  PatternMatch,
} from '../shared/platform-types'
import type { ScreenerResult } from '../shared/types'

type MovingAverageSelector = number | 'intraday'

function toNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function compareThreshold(currentValue: number | null | undefined, threshold: number, direction: string) {
  if (currentValue === null || currentValue === undefined) {
    return false
  }

  if (direction === 'gt') {
    return currentValue > threshold
  }

  if (direction === 'gte') {
    return currentValue >= threshold
  }

  if (direction === 'lt') {
    return currentValue < threshold
  }

  return currentValue <= threshold
}

function calculateMovingAverage(values: number[], period: number, offsetFromEnd = 0) {
  const endIndex = values.length - 1 - offsetFromEnd

  if (endIndex < period - 1) {
    return null
  }

  let total = 0
  for (let index = endIndex - period + 1; index <= endIndex; index += 1) {
    total += values[index]
  }

  return total / period
}

function normalizeMovingAverageSelector(
  value: unknown,
  fallback: MovingAverageSelector = 5,
): MovingAverageSelector {
  if (value === 'intraday') {
    return 'intraday'
  }

  if (typeof value === 'string') {
    if (value.trim().toLowerCase() === 'intraday') {
      return 'intraday'
    }

    const numericValue = Number(value)
    if (Number.isFinite(numericValue) && numericValue > 0) {
      return numericValue
    }
  }

  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }

  return fallback
}

function getClosedChartCandles(result: ScreenerResult) {
  return result.chart.filter((candle) => candle.isClosed)
}

function calculateIntradayAverage(
  result: ScreenerResult,
  offsetFromEnd = 0,
) {
  const closedCandles = getClosedChartCandles(result)
  const targetIndex = closedCandles.length - 1 - offsetFromEnd

  if (targetIndex < 0) {
    return null
  }

  const targetTimestamp = closedCandles[targetIndex].timestamp
  const targetDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(targetTimestamp))

  const sameDayCandles = closedCandles.filter((candle) => {
    const candleDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(candle.timestamp))

    return candleDate === targetDate && candle.timestamp <= targetTimestamp
  })

  if (sameDayCandles.length === 0) {
    return null
  }

  const total = sameDayCandles.reduce((sum, candle) => sum + candle.close, 0)
  return total / sameDayCandles.length
}

function getChartMovingAverage(
  result: ScreenerResult,
  selector: MovingAverageSelector,
  offsetFromEnd = 0,
) {
  if (selector === 'intraday') {
    return calculateIntradayAverage(result, offsetFromEnd)
  }

  const closes = getClosedChartCandles(result).map((candle) => candle.close)
  return calculateMovingAverage(closes, selector, offsetFromEnd)
}

function getLastClosedCandle(result: ScreenerResult) {
  const closedCandles = getClosedChartCandles(result)
  return closedCandles[closedCandles.length - 1] ?? null
}

function resolveMaDirection(
  result: ScreenerResult,
  selector: MovingAverageSelector,
): 'up' | 'down' | 'flat' {
  const currentMa = getChartMovingAverage(result, selector, 0)
  const previousMa = getChartMovingAverage(result, selector, 1)

  if (currentMa === null || previousMa === null) {
    return 'flat'
  }

  if (currentMa > previousMa) {
    return 'up'
  }

  if (currentMa < previousMa) {
    return 'down'
  }

  return 'flat'
}

function resolveMaSlopePct(result: ScreenerResult, selector: MovingAverageSelector) {
  const currentMa = getChartMovingAverage(result, selector, 0)
  const previousMa = getChartMovingAverage(result, selector, 1)

  if (currentMa === null || previousMa === null || previousMa === 0) {
    return null
  }

  return ((currentMa - previousMa) / previousMa) * 100
}

function hasBodyCrossThroughMa(
  result: ScreenerResult,
  selector: MovingAverageSelector,
  direction: CrossDirection,
) {
  const lastCandle = getLastClosedCandle(result)
  const movingAverage = getChartMovingAverage(result, selector, 0)

  if (!lastCandle || movingAverage === null) {
    return false
  }

  if (direction === 'down') {
    return (
      lastCandle.close < lastCandle.open &&
      lastCandle.open > movingAverage &&
      lastCandle.close < movingAverage
    )
  }

  return (
    lastCandle.close > lastCandle.open &&
    lastCandle.open < movingAverage &&
    lastCandle.close > movingAverage
  )
}

function compareRange(
  currentValue: number | null | undefined,
  minimum: number | null | undefined,
  maximum: number | null | undefined,
) {
  if (currentValue === null || currentValue === undefined) {
    return false
  }

  if (minimum !== null && minimum !== undefined && currentValue < minimum) {
    return false
  }

  if (maximum !== null && maximum !== undefined && currentValue > maximum) {
    return false
  }

  return true
}

function getMovingAverage(indicators: IndicatorSnapshot, selector: MovingAverageSelector) {
  if (selector === 'intraday') {
    return indicators.intradayAverage ?? null
  }

  return indicators.movingAverages[`MA${selector}`] ?? null
}

function getMacdValue(indicators: IndicatorSnapshot, line: string) {
  if (line === 'dif') {
    return indicators.macd.dif
  }

  if (line === 'dea') {
    return indicators.macd.dea
  }

  return indicators.macd.histogram
}

function getKdjValue(indicators: IndicatorSnapshot, line: string) {
  if (line === 'k') {
    return indicators.kdj.k
  }

  if (line === 'd') {
    return indicators.kdj.d
  }

  return indicators.kdj.j
}

export function evaluateCondition(
  result: ScreenerResult,
  indicators: IndicatorSnapshot,
  condition: ConditionDefinition,
  patterns: PatternMatch[],
) {
  if (!condition.enabled) {
    return true
  }

  if (condition.kind === 'ma_convergence') {
    const thresholdPct = toNumber(condition.params.thresholdPct, 0.8)
    const fast = getMovingAverage(
      indicators,
      normalizeMovingAverageSelector(condition.params.fast, 5),
    )
    const slow = getMovingAverage(
      indicators,
      normalizeMovingAverageSelector(condition.params.slow, 20),
    )

    if (fast === null || slow === null || slow === 0) {
      return false
    }

    return Math.abs((fast - slow) / slow) * 100 <= thresholdPct
  }

  if (condition.kind === 'ma_trend') {
    const direction = String(condition.params.direction ?? 'up')
    const selector = normalizeMovingAverageSelector(condition.params.period, 5)
    const currentDirection = resolveMaDirection(result, selector)
    return direction === 'down' ? currentDirection === 'down' : currentDirection === 'up'
  }

  if (condition.kind === 'ma_slope') {
    const selector = normalizeMovingAverageSelector(condition.params.period, 5)
    const slopePct = resolveMaSlopePct(result, selector)

    if (String(condition.params.mode ?? 'compare') === 'range') {
      return compareRange(
        slopePct,
        typeof condition.params.min === 'number' ? condition.params.min : toNumber(condition.params.min, -100),
        typeof condition.params.max === 'number' ? condition.params.max : toNumber(condition.params.max, 100),
      )
    }

    return compareThreshold(
      slopePct,
      toNumber(condition.params.thresholdPct, 0),
      String(condition.params.direction ?? 'gt'),
    )
  }

  if (condition.kind === 'price_cross_ma') {
    return hasBodyCrossThroughMa(
      result,
      normalizeMovingAverageSelector(condition.params.period, 5),
      String(condition.params.direction ?? 'up') === 'down' ? 'down' : 'up',
    )
  }

  if (condition.kind === 'ma_cross_ma') {
    const fastPeriod = normalizeMovingAverageSelector(condition.params.fast, 5)
    const slowPeriod = normalizeMovingAverageSelector(condition.params.slow, 20)
    const currentFast = getChartMovingAverage(result, fastPeriod, 0)
    const currentSlow = getChartMovingAverage(result, slowPeriod, 0)
    const previousFast = getChartMovingAverage(result, fastPeriod, 1)
    const previousSlow = getChartMovingAverage(result, slowPeriod, 1)

    if (
      currentFast === null ||
      currentSlow === null ||
      previousFast === null ||
      previousSlow === null
    ) {
      return false
    }

    return String(condition.params.direction ?? 'up') === 'down'
      ? previousFast >= previousSlow && currentFast < currentSlow
      : previousFast <= previousSlow && currentFast > currentSlow
  }

  if (condition.kind === 'price_above_ma') {
    const targetMa = getMovingAverage(
      indicators,
      normalizeMovingAverageSelector(condition.params.period, 20),
    )
    return targetMa !== null && result.lastPrice > targetMa
  }

  if (condition.kind === 'price_below_ma') {
    const targetMa = getMovingAverage(
      indicators,
      normalizeMovingAverageSelector(condition.params.period, 20),
    )
    return targetMa !== null && result.lastPrice < targetMa
  }

  if (condition.kind === 'ma_spread' || condition.kind === 'ma_adhesion') {
    const periods = ((condition.params.periods as Array<number | string> | undefined) ?? [
      5,
      10,
      20,
    ]).map((period) => normalizeMovingAverageSelector(period, 5))
    const values = periods
      .map((period) => getMovingAverage(indicators, period))
      .filter((value): value is number => value !== null)

    if (values.length < 2) {
      return false
    }

    const average = values.reduce((sum, value) => sum + value, 0) / values.length
    const spreadPct = ((Math.max(...values) - Math.min(...values)) / average) * 100
    const thresholdPct = toNumber(condition.params.thresholdPct, 1)

    return condition.kind === 'ma_adhesion'
      ? spreadPct <= thresholdPct
      : spreadPct >= thresholdPct
  }

  if (condition.kind === 'ma_conflict') {
    const referencePeriod = normalizeMovingAverageSelector(condition.params.referencePeriod, 5)
    const comparePeriod = normalizeMovingAverageSelector(condition.params.comparePeriod, 20)
    const referenceDirection = resolveMaDirection(result, referencePeriod)
    const compareDirection = resolveMaDirection(result, comparePeriod)

    return (
      referenceDirection !== 'flat' &&
      compareDirection !== 'flat' &&
      referenceDirection !== compareDirection
    )
  }

  if (condition.kind === 'macd_cross') {
    const dif = indicators.macd.dif
    const dea = indicators.macd.dea

    if (dif === null || dea === null) {
      return false
    }

    return String(condition.params.direction ?? 'up') === 'down' ? dif < dea : dif > dea
  }

  if (condition.kind === 'macd_above_zero') {
    return (indicators.macd.dif ?? -1) > 0
  }

  if (condition.kind === 'macd_threshold') {
    const currentValue = getMacdValue(indicators, String(condition.params.line ?? 'histogram'))

    if (String(condition.params.mode ?? 'compare') === 'range') {
      return compareRange(
        currentValue,
        typeof condition.params.min === 'number'
          ? condition.params.min
          : toNumber(condition.params.min, -1),
        typeof condition.params.max === 'number'
          ? condition.params.max
          : toNumber(condition.params.max, 1),
      )
    }

    return compareThreshold(
      currentValue,
      toNumber(condition.params.threshold, 0),
      String(condition.params.direction ?? 'gte'),
    )
  }

  if (condition.kind === 'boll_position') {
    const position = String(condition.params.position ?? 'middle_or_above')
    const { upper, middle, lower } = indicators.boll

    if (upper === null || middle === null || lower === null) {
      return false
    }

    if (position === 'upper_break') {
      return result.lastPrice > upper
    }

    if (position === 'lower_break') {
      return result.lastPrice < lower
    }

    return result.lastPrice >= middle
  }

  if (condition.kind === 'boll_bandwidth') {
    const { upper, middle, lower } = indicators.boll

    if (upper === null || middle === null || lower === null || middle === 0) {
      return false
    }

    const bandwidthPct = ((upper - lower) / middle) * 100

    if (String(condition.params.mode ?? 'compare') === 'range') {
      return compareRange(
        bandwidthPct,
        typeof condition.params.min === 'number'
          ? condition.params.min
          : toNumber(condition.params.min, 0),
        typeof condition.params.max === 'number'
          ? condition.params.max
          : toNumber(condition.params.max, 100),
      )
    }

    return compareThreshold(
      bandwidthPct,
      toNumber(condition.params.thresholdPct, 1),
      String(condition.params.direction ?? 'gte'),
    )
  }

  if (condition.kind === 'kdj_cross') {
    const k = indicators.kdj.k
    const d = indicators.kdj.d

    if (k === null || d === null) {
      return false
    }

    return String(condition.params.direction ?? 'up') === 'down' ? k < d : k > d
  }

  if (condition.kind === 'kdj_threshold') {
    const currentValue = getKdjValue(indicators, String(condition.params.line ?? 'k'))

    if (String(condition.params.mode ?? 'compare') === 'range') {
      return compareRange(
        currentValue,
        typeof condition.params.min === 'number'
          ? condition.params.min
          : toNumber(condition.params.min, 0),
        typeof condition.params.max === 'number'
          ? condition.params.max
          : toNumber(condition.params.max, 100),
      )
    }

    return compareThreshold(
      currentValue,
      toNumber(condition.params.threshold, 50),
      String(condition.params.direction ?? 'gte'),
    )
  }

  if (condition.kind === 'rsi_threshold') {
    const period = toNumber(condition.params.period, 14)
    const key = `rsi${period}` as keyof IndicatorSnapshot['rsi']
    const mode = String(condition.params.mode ?? 'compare')
    const currentValue = indicators.rsi[key] ?? null

    if (mode === 'range') {
      return compareRange(
        currentValue,
        typeof condition.params.min === 'number' ? condition.params.min : toNumber(condition.params.min, 0),
        typeof condition.params.max === 'number' ? condition.params.max : toNumber(condition.params.max, 100),
      )
    }

    return compareThreshold(
      currentValue,
      toNumber(condition.params.threshold, 50),
      String(condition.params.direction ?? 'gt'),
    )
  }

  if (condition.kind === 'bias_threshold') {
    const period = toNumber(condition.params.period, 5)
    const mode = String(condition.params.mode ?? 'compare')
    const currentValue = indicators.bias[`BIAS${period}`] ?? null

    if (mode === 'range') {
      return compareRange(
        currentValue,
        typeof condition.params.min === 'number' ? condition.params.min : toNumber(condition.params.min, -10),
        typeof condition.params.max === 'number' ? condition.params.max : toNumber(condition.params.max, 10),
      )
    }

    return compareThreshold(
      currentValue,
      toNumber(condition.params.threshold, 0),
      String(condition.params.direction ?? 'gt'),
    )
  }

  if (condition.kind === 'volume_spike') {
    const reference = String(condition.params.reference ?? 'average5')
    const volume = indicators.volume.current
    const baseline =
      reference === 'average20' ? indicators.volume.average20 : indicators.volume.average5

    if (volume === null || baseline === null || baseline === 0) {
      return false
    }

    const ratio = volume / baseline

    if (String(condition.params.mode ?? 'compare') === 'range') {
      return compareRange(
        ratio,
        typeof condition.params.minMultiplier === 'number'
          ? condition.params.minMultiplier
          : toNumber(condition.params.minMultiplier, 1),
        typeof condition.params.maxMultiplier === 'number'
          ? condition.params.maxMultiplier
          : toNumber(condition.params.maxMultiplier, 10),
      )
    }

    return compareThreshold(
      ratio,
      toNumber(condition.params.multiplier, 1.5),
      String(condition.params.direction ?? 'gte'),
    )
  }

  if (condition.kind === 'pattern_match') {
    const patternKey = String(condition.params.patternKey ?? '')
    return patterns.some((pattern) => pattern.key === patternKey && pattern.matched)
  }

  return true
}

export function evaluateConditions(
  result: ScreenerResult,
  indicators: IndicatorSnapshot,
  conditions: ConditionDefinition[],
  patterns: PatternMatch[],
) {
  return conditions.every((condition) =>
    evaluateCondition(result, indicators, condition, patterns),
  )
}
