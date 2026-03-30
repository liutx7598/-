import Bottleneck from 'bottleneck'

import { TIMEFRAME_MAP, type TimeframeKey } from '../shared/timeframes'
import type {
  ChartCandle,
  MatchMode,
  ScreenerConfig,
  ScreenerResult,
  ScreenerStats,
} from '../shared/types'
import { buildIndicatorSnapshot } from './indicator-registry'
import {
  aggregateCandles,
  fetchCandles,
  fetchSwapInstruments,
  getRawBarsForSelection,
  type GateInstrument,
  type RawCandle,
} from './gate'
import { detectPatterns } from './pattern-detector'
import { buildAiRecommendation } from './recommendation-label'

interface ScreeningRun {
  allResults: ScreenerResult[]
  matchedResults: ScreenerResult[]
  stats: ScreenerStats
}

export function calculateMovingAverage(values: number[], period: number) {
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

export function buildChart(candles: RawCandle[], config: ScreenerConfig) {
  const chartCandles = candles.slice(-config.chartCandles)
  const closes = candles.map((candle) => candle.close)
  const fastMaSeries = calculateMovingAverage(closes, config.fastMaPeriod)
  const slowMaSeries = calculateMovingAverage(closes, config.slowMaPeriod)

  return chartCandles.map((candle, index) => {
    const sourceIndex = candles.length - chartCandles.length + index

    return {
      timestamp: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      isClosed: candle.confirmed,
      fastMa: fastMaSeries[sourceIndex],
      slowMa: slowMaSeries[sourceIndex],
    } satisfies ChartCandle
  })
}

function calculatePercentSlope(currentValue: number, previousValue: number) {
  if (previousValue === 0) {
    return currentValue === 0 ? 0 : Number.POSITIVE_INFINITY
  }

  return ((currentValue - previousValue) / previousValue) * 100
}

function hasBullishBodyCrossThroughMa(candle: RawCandle, movingAverage: number) {
  return candle.close > candle.open && candle.open < movingAverage && candle.close > movingAverage
}

export function resolveMatch(
  matchMode: MatchMode,
  flags: ScreenerResult['trendFlags'],
) {
  if (matchMode === 'A_B_C') {
    return flags.converging && flags.fastMaRising && flags.priceCrossedFastMa
  }

  if (matchMode === 'A_B') {
    return flags.converging && flags.fastMaRising
  }

  if (matchMode === 'B_C') {
    return flags.fastMaRising && flags.priceCrossedFastMa
  }

  return flags.converging
}

export function buildResult(
  instrument: GateInstrument,
  timeframe: TimeframeKey,
  candles: RawCandle[],
  config: ScreenerConfig,
): ScreenerResult | null {
  const confirmedCandles = candles.filter((candle) => candle.confirmed)
  const minimumCandles = Math.max(
    config.slowMaPeriod + 2,
    config.fastMaPeriod + 3,
    config.secondaryConvergenceEnabled ? config.secondaryFastMaPeriod + 1 : 0,
    config.secondaryConvergenceEnabled ? config.secondarySlowMaPeriod + 1 : 0,
    config.chartCandles,
  )

  if (confirmedCandles.length < minimumCandles || candles.length < config.chartCandles) {
    return null
  }

  const closes = confirmedCandles.map((candle) => candle.close)
  const fastMaSeries = calculateMovingAverage(closes, config.fastMaPeriod)
  const slowMaSeries = calculateMovingAverage(closes, config.slowMaPeriod)
  const secondaryFastMaSeries = config.secondaryConvergenceEnabled
    ? calculateMovingAverage(closes, config.secondaryFastMaPeriod)
    : null
  const secondarySlowMaSeries = config.secondaryConvergenceEnabled
    ? calculateMovingAverage(closes, config.secondarySlowMaPeriod)
    : null
  const latestIndex = confirmedCandles.length - 1
  const previousIndex = latestIndex - 1
  const earlierIndex = latestIndex - 2
  const latestFastMa = fastMaSeries[latestIndex]
  const latestSlowMa = slowMaSeries[latestIndex]
  const previousFastMa = fastMaSeries[previousIndex]
  const earlierFastMa = fastMaSeries[earlierIndex]
  const latestSecondaryFastMa = secondaryFastMaSeries?.[latestIndex] ?? null
  const latestSecondarySlowMa = secondarySlowMaSeries?.[latestIndex] ?? null

  if (
    latestFastMa === null ||
    latestSlowMa === null ||
    previousFastMa === null ||
    earlierFastMa === null ||
    (config.secondaryConvergenceEnabled &&
      (latestSecondaryFastMa === null || latestSecondarySlowMa === null))
  ) {
    return null
  }

  const latestCandle = confirmedCandles[latestIndex]
  const previousCandle = confirmedCandles[previousIndex]
  const distanceRatio = Math.abs(latestFastMa - latestSlowMa) / latestSlowMa
  const convergencePct = distanceRatio * 100
  const primaryConverging = convergencePct <= config.convergenceThresholdPct
  const secondaryDistanceRatio =
    config.secondaryConvergenceEnabled &&
    latestSecondaryFastMa !== null &&
    latestSecondarySlowMa !== null
      ? Math.abs(latestSecondaryFastMa - latestSecondarySlowMa) / latestSecondarySlowMa
      : null
  const secondaryConvergencePct =
    secondaryDistanceRatio === null ? null : secondaryDistanceRatio * 100
  const secondaryConverging =
    secondaryConvergencePct === null
      ? null
      : secondaryConvergencePct <= config.convergenceThresholdPct
  const converging =
    !config.secondaryConvergenceEnabled || secondaryConverging === null
      ? primaryConverging
      : config.convergenceRelation === 'and'
        ? primaryConverging && secondaryConverging
        : primaryConverging || secondaryConverging
  const rawPriceCrossedFastMa =
    latestCandle.close > previousCandle.close &&
    hasBullishBodyCrossThroughMa(latestCandle, latestFastMa)
  const crossSlopePct = calculatePercentSlope(latestFastMa, previousFastMa)
  const crossSlopeQualified =
    !config.crossSlopeEnabled || crossSlopePct >= config.crossSlopeThresholdPct
  const priceCrossedFastMa = rawPriceCrossedFastMa && crossSlopeQualified
  const fastMaRising =
    config.maUpStrategy === 'strict_positive'
      ? latestFastMa - previousFastMa > 0
      : latestFastMa > previousFastMa && previousFastMa >= earlierFastMa
  const maTrendDirection =
    latestFastMa > previousFastMa
      ? 'up'
      : latestFastMa < previousFastMa
        ? 'down'
        : 'flat'
  const trendFlags = {
    primaryConverging,
    secondaryConverging,
    converging,
    fastMaRising,
    rawPriceCrossedFastMa,
    crossSlopeQualified,
    priceCrossedFastMa,
  } as const
  const isMatch = resolveMatch(config.matchMode, trendFlags)
  const indicators = buildIndicatorSnapshot(confirmedCandles)
  const patternMatches = detectPatterns(confirmedCandles)
  const aiRecommendation = buildAiRecommendation(
    {
      signalKey: '',
      signature: '',
      instId: instrument.instId,
      instFamily: instrument.instFamily,
      instrumentName: `${instrument.baseCcy}-${instrument.quoteCcy}`,
      baseCcy: instrument.baseCcy,
      quoteCcy: instrument.quoteCcy,
      contractType: 'SWAP',
      timeframe,
      timeframeLabel: TIMEFRAME_MAP[timeframe].label,
      synthetic: Boolean(TIMEFRAME_MAP[timeframe].syntheticFrom),
      lastPrice: latestCandle.close,
      fastMa: latestFastMa,
      slowMa: latestSlowMa,
      distanceRatio,
      convergencePct,
      secondaryFastMa: latestSecondaryFastMa,
      secondarySlowMa: latestSecondarySlowMa,
      secondaryDistanceRatio,
      secondaryConvergencePct,
      priceVsFastMaPct: ((latestCandle.close - latestFastMa) / latestFastMa) * 100,
      fastMaSlopePct: calculatePercentSlope(latestFastMa, previousFastMa),
      crossSlopePct,
      maTrendDirection,
      crossedAt: new Date(latestCandle.timestamp).toISOString(),
      lastClosedTs: latestCandle.timestamp,
      analysisSource: 'rules',
      llmSummary: null,
      isMatch,
      alertStatus: isMatch ? 'ready' : 'not_matched',
      indicators,
      patternMatches,
      aiRecommendationLabel: null,
      aiRecommendationReason: null,
      trendFlags,
      chart: buildChart(candles, config),
    },
    indicators,
    patternMatches,
  )

  return {
    signalKey: `${instrument.instId}:${timeframe}:${latestCandle.timestamp}`,
    signature: `${instrument.instId}:${timeframe}`,
    instId: instrument.instId,
    instFamily: instrument.instFamily,
    instrumentName: `${instrument.baseCcy}-${instrument.quoteCcy}`,
    baseCcy: instrument.baseCcy,
    quoteCcy: instrument.quoteCcy,
    contractType: 'SWAP',
    timeframe,
    timeframeLabel: TIMEFRAME_MAP[timeframe].label,
    synthetic: Boolean(TIMEFRAME_MAP[timeframe].syntheticFrom),
    lastPrice: latestCandle.close,
    fastMa: latestFastMa,
    slowMa: latestSlowMa,
    distanceRatio,
    convergencePct,
    secondaryFastMa: latestSecondaryFastMa,
    secondarySlowMa: latestSecondarySlowMa,
    secondaryDistanceRatio,
    secondaryConvergencePct,
    priceVsFastMaPct: ((latestCandle.close - latestFastMa) / latestFastMa) * 100,
    fastMaSlopePct: calculatePercentSlope(latestFastMa, previousFastMa),
    crossSlopePct,
    maTrendDirection,
    crossedAt: new Date(latestCandle.timestamp).toISOString(),
    lastClosedTs: latestCandle.timestamp,
    analysisSource: 'rules',
    llmSummary: null,
    isMatch,
    alertStatus: isMatch ? 'ready' : 'not_matched',
    indicators,
    patternMatches,
    aiRecommendationLabel: aiRecommendation.label,
    aiRecommendationReason: aiRecommendation.reason,
    priceChanges: {},
    marketCap: null,
    watchlisted: false,
    trendFlags,
    chart: buildChart(candles, config),
  }
}

export function sortResults(results: ScreenerResult[]) {
  return [...results].sort((left, right) => {
    const matchDifference = Number(right.isMatch) - Number(left.isMatch)

    if (matchDifference !== 0) {
      return matchDifference
    }

    const timeframeDifference =
      TIMEFRAME_MAP[left.timeframe].sortOrder - TIMEFRAME_MAP[right.timeframe].sortOrder

    if (timeframeDifference !== 0) {
      return timeframeDifference
    }

    if (left.convergencePct !== right.convergencePct) {
      return left.convergencePct - right.convergencePct
    }

    if (left.fastMaSlopePct !== right.fastMaSlopePct) {
      return right.fastMaSlopePct - left.fastMaSlopePct
    }

    return left.instId.localeCompare(right.instId)
  })
}

export class ScreenerEngine {
  private limiter = new Bottleneck({
    reservoir: 38,
    reservoirRefreshAmount: 38,
    reservoirRefreshInterval: 2_000,
    maxConcurrent: 12,
  })

  async run(config: ScreenerConfig): Promise<ScreeningRun> {
    const startedAt = Date.now()
    const instruments = await fetchSwapInstruments()
    const rawBars = getRawBarsForSelection(config.selectedTimeframes)
    const candleLimit = Math.min(
      Math.max(config.fetchLimit, config.slowMaPeriod + 5, config.chartCandles + 5),
      300,
    )

    const perInstrumentRuns = await Promise.all(
      instruments.map(async (instrument) => {
        try {
          const rawEntries = await Promise.all(
            rawBars.map(async (bar) => [
              bar,
              await this.limiter.schedule(() =>
                fetchCandles(instrument.instId, bar, candleLimit),
              ),
            ] as const),
          )

          const rawMap = Object.fromEntries(rawEntries) as Record<string, RawCandle[]>

          return config.selectedTimeframes
            .map((timeframe) => {
              const definition = TIMEFRAME_MAP[timeframe]
              const source = rawMap[definition.apiBar] ?? []
              const timeframeCandles = definition.syntheticFrom
                ? aggregateCandles(source, timeframe)
                : source

              return buildResult(instrument, timeframe, timeframeCandles, config)
            })
            .filter((result): result is ScreenerResult => result !== null)
        } catch {
          return null
        }
      }),
    )

    const failures = perInstrumentRuns.filter((entry) => entry === null).length
    const allResults = sortResults(
      perInstrumentRuns.flatMap((entry) => (entry === null ? [] : entry)),
    )
    const matchedResults = allResults.filter((item) => item.isMatch)

    return {
      allResults,
      matchedResults,
      stats: {
        scannedInstruments: instruments.length,
        analyzedRows: allResults.length,
        matchedRows: matchedResults.length,
        rawBarsFetched: instruments.length * rawBars.length,
        failures,
        durationMs: Date.now() - startedAt,
      },
    }
  }
}
