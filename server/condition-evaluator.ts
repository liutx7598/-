import type {
  ConditionDefinition,
  IndicatorSnapshot,
  PatternMatch,
} from '../shared/platform-types'
import type { ScreenerResult } from '../shared/types'

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

function getMovingAverage(indicators: IndicatorSnapshot, period: number) {
  return indicators.movingAverages[`MA${period}`] ?? null
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
    const fast = getMovingAverage(indicators, toNumber(condition.params.fast, 5))
    const slow = getMovingAverage(indicators, toNumber(condition.params.slow, 20))

    if (fast === null || slow === null || slow === 0) {
      return false
    }

    return Math.abs((fast - slow) / slow) * 100 <= thresholdPct
  }

  if (condition.kind === 'ma_trend') {
    const direction = String(condition.params.direction ?? 'up')
    return direction === 'down'
      ? result.maTrendDirection === 'down'
      : result.maTrendDirection === 'up'
  }

  if (condition.kind === 'ma_slope') {
    return compareThreshold(
      result.fastMaSlopePct,
      toNumber(condition.params.thresholdPct, 0),
      String(condition.params.direction ?? 'gt'),
    )
  }

  if (condition.kind === 'price_cross_ma') {
    return String(condition.params.direction ?? 'up') === 'down'
      ? result.trendFlags.rawPriceCrossedFastMa === false &&
          result.lastPrice < result.fastMa
      : result.trendFlags.priceCrossedFastMa
  }

  if (condition.kind === 'ma_cross_ma') {
    const fast = getMovingAverage(indicators, toNumber(condition.params.fast, 5))
    const slow = getMovingAverage(indicators, toNumber(condition.params.slow, 20))

    if (fast === null || slow === null) {
      return false
    }

    return String(condition.params.direction ?? 'up') === 'down' ? fast < slow : fast > slow
  }

  if (condition.kind === 'price_above_ma') {
    const targetMa = getMovingAverage(indicators, toNumber(condition.params.period, 20))
    return targetMa !== null && result.lastPrice > targetMa
  }

  if (condition.kind === 'price_below_ma') {
    const targetMa = getMovingAverage(indicators, toNumber(condition.params.period, 20))
    return targetMa !== null && result.lastPrice < targetMa
  }

  if (condition.kind === 'ma_spread' || condition.kind === 'ma_adhesion') {
    const periods = (condition.params.periods as number[] | undefined) ?? [5, 10, 20]
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
    return result.maTrendDirection === 'up' && result.lastPrice < result.slowMa
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

  if (condition.kind === 'kdj_cross') {
    const k = indicators.kdj.k
    const d = indicators.kdj.d

    if (k === null || d === null) {
      return false
    }

    return String(condition.params.direction ?? 'up') === 'down' ? k < d : k > d
  }

  if (condition.kind === 'rsi_threshold') {
    const period = toNumber(condition.params.period, 14)
    const key = `rsi${period}` as keyof IndicatorSnapshot['rsi']
    return compareThreshold(
      indicators.rsi[key] ?? null,
      toNumber(condition.params.threshold, 50),
      String(condition.params.direction ?? 'gt'),
    )
  }

  if (condition.kind === 'bias_threshold') {
    const period = toNumber(condition.params.period, 5)
    return compareThreshold(
      indicators.bias[`BIAS${period}`] ?? null,
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

    return volume / baseline >= toNumber(condition.params.multiplier, 1.5)
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
