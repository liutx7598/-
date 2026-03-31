import type { PatternKey, PatternMatch } from '../shared/platform-types'
import type { RawCandle } from './gate'

const EPSILON = 1e-9

function bodySize(candle: RawCandle) {
  return Math.abs(candle.close - candle.open)
}

function candleRange(candle: RawCandle) {
  return Math.max(candle.high - candle.low, EPSILON)
}

function upperShadow(candle: RawCandle) {
  return candle.high - Math.max(candle.open, candle.close)
}

function lowerShadow(candle: RawCandle) {
  return Math.min(candle.open, candle.close) - candle.low
}

function isBullish(candle: RawCandle) {
  return candle.close > candle.open
}

function isBearish(candle: RawCandle) {
  return candle.close < candle.open
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function averageBody(candles: RawCandle[]) {
  return average(candles.map((candle) => bodySize(candle)))
}

function similarByRatio(left: number, right: number, maxRatio: number) {
  return Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), EPSILON) <= maxRatio
}

function calculateMovingAverage(candles: RawCandle[], period: number, offsetFromEnd = 0) {
  const endIndex = candles.length - 1 - offsetFromEnd

  if (endIndex < period - 1) {
    return null
  }

  const slice = candles.slice(endIndex - period + 1, endIndex + 1)
  return average(slice.map((candle) => candle.close))
}

function createPatternMatch(
  key: PatternKey,
  label: string,
  matched: boolean,
  confidence: number,
): PatternMatch {
  return {
    key,
    label,
    matched,
    confidence: matched ? confidence : 0.1,
  }
}

function detectLongUpperShadow(last: RawCandle) {
  const lastBody = Math.max(bodySize(last), EPSILON)
  const lastUpperShadow = upperShadow(last)
  return lastUpperShadow >= Math.max(lastBody * 1.8, candleRange(last) * 0.35)
}

function detectLongLowerShadow(last: RawCandle) {
  const lastBody = Math.max(bodySize(last), EPSILON)
  const lastLowerShadow = lowerShadow(last)
  return lastLowerShadow >= Math.max(lastBody * 1.8, candleRange(last) * 0.35)
}

function detectBullishEngulfing(previous: RawCandle, last: RawCandle) {
  return (
    isBearish(previous) &&
    isBullish(last) &&
    last.close >= previous.open &&
    last.open <= previous.close
  )
}

function detectBearishEngulfing(previous: RawCandle, last: RawCandle) {
  return (
    isBullish(previous) &&
    isBearish(last) &&
    last.open >= previous.close &&
    last.close <= previous.open
  )
}

function findSwingLowIndices(candles: RawCandle[]) {
  const indices: number[] = []

  for (let index = 1; index < candles.length - 1; index += 1) {
    if (candles[index].low <= candles[index - 1].low && candles[index].low <= candles[index + 1].low) {
      indices.push(index)
    }
  }

  return indices
}

function detectWBottom(candles: RawCandle[]) {
  const recent = candles.slice(-12)

  if (recent.length < 7) {
    return false
  }

  const swingLows = findSwingLowIndices(recent)
  const last = recent[recent.length - 1]

  for (let leftIndex = 0; leftIndex < swingLows.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < swingLows.length; rightIndex += 1) {
      const first = swingLows[leftIndex]
      const second = swingLows[rightIndex]
      const spacing = second - first

      if (spacing < 2 || spacing > 7) {
        continue
      }

      const firstLow = recent[first].low
      const secondLow = recent[second].low
      const neckline = Math.max(...recent.slice(first + 1, second).map((candle) => candle.high))
      const reboundPct = (neckline - Math.max(firstLow, secondLow)) / Math.max(firstLow, secondLow)

      if (
        similarByRatio(firstLow, secondLow, 0.02) &&
        reboundPct >= 0.015 &&
        last.close > neckline &&
        isBullish(last)
      ) {
        return true
      }
    }
  }

  return false
}

function detectDoubleNeedleBottom(candles: RawCandle[]) {
  const recent = candles.slice(-6)

  if (recent.length < 4) {
    return false
  }

  const needleIndices = recent
    .map((candle, index) => ({
      candle,
      index,
      matched:
        lowerShadow(candle) >= Math.max(bodySize(candle) * 1.8, candleRange(candle) * 0.35),
    }))
    .filter((item) => item.matched)
    .map((item) => item.index)

  if (needleIndices.length < 2) {
    return false
  }

  const first = needleIndices[needleIndices.length - 2]
  const second = needleIndices[needleIndices.length - 1]
  const firstLow = recent[first].low
  const secondLow = recent[second].low
  const neckline = Math.max(...recent.slice(first, second + 1).map((candle) => candle.high))
  const last = recent[recent.length - 1]

  return (
    second - first <= 4 &&
    similarByRatio(firstLow, secondLow, 0.015) &&
    last.close >= neckline * 0.998
  )
}

function detectThreeIncense(candles: RawCandle[]) {
  const recent = candles.slice(-3)

  if (recent.length < 3) {
    return false
  }

  return (
    recent.every(isBullish) &&
    recent[0].close < recent[1].close &&
    recent[1].close < recent[2].close &&
    recent[0].open <= recent[1].open + EPSILON &&
    recent[1].open <= recent[2].open + EPSILON &&
    upperShadow(recent[2]) <= bodySize(recent[2])
  )
}

function detectRoundedBottom(candles: RawCandle[]) {
  const recent = candles.slice(-9)

  if (recent.length < 9) {
    return false
  }

  const closes = recent.map((candle) => candle.close)
  const minClose = Math.min(...closes)
  const troughIndex = closes.findIndex((value) => value === minClose)
  const leftAverage = average(closes.slice(0, 3))
  const centerAverage = average(closes.slice(3, 6))
  const rightAverage = average(closes.slice(6))
  const last = recent[recent.length - 1]

  return (
    troughIndex >= 2 &&
    troughIndex <= 6 &&
    leftAverage > centerAverage * 1.01 &&
    rightAverage > centerAverage * 1.015 &&
    closes[recent.length - 1] > closes[troughIndex] * 1.03 &&
    closes[recent.length - 1] >= closes[0] * 0.995 &&
    isBullish(last)
  )
}

function detectBullFlagBreakout(candles: RawCandle[]) {
  const recent = candles.slice(-8)

  if (recent.length < 8) {
    return false
  }

  const pole = recent.slice(0, 4)
  const flag = recent.slice(4, 7)
  const breakout = recent[7]
  const poleGainPct = (pole[pole.length - 1].close - pole[0].open) / Math.max(pole[0].open, EPSILON)
  const flagHigh = Math.max(...flag.map((candle) => candle.high))
  const flagLow = Math.min(...flag.map((candle) => candle.low))
  const flagRangePct = (flagHigh - flagLow) / Math.max(flagLow, EPSILON)
  const driftDown = flag[flag.length - 1].close <= pole[pole.length - 1].close * 1.01

  return (
    poleGainPct >= 0.015 &&
    flagRangePct <= Math.max(0.012, poleGainPct * 0.7) &&
    driftDown &&
    breakout.close > flagHigh &&
    isBullish(breakout)
  )
}

function getMaBundle(candles: RawCandle[], offsetFromEnd = 0) {
  const ma5 = calculateMovingAverage(candles, 5, offsetFromEnd)
  const ma10 = calculateMovingAverage(candles, 10, offsetFromEnd)
  const ma20 = calculateMovingAverage(candles, 20, offsetFromEnd)

  if (ma5 === null || ma10 === null || ma20 === null) {
    return null
  }

  return [ma5, ma10, ma20]
}

function getSpreadPct(values: number[]) {
  return ((Math.max(...values) - Math.min(...values)) / Math.max(average(values), EPSILON)) * 100
}

function detectLotusBreakout(candles: RawCandle[]) {
  const last = candles[candles.length - 1]
  const previousBodies = candles.slice(-6, -1)
  const maBundle = getMaBundle(candles)
  const previousBundle = getMaBundle(candles, 1)

  if (!maBundle || previousBodies.length < 5) {
    return false
  }

  const minMa = Math.min(...maBundle)
  const maxMa = Math.max(...maBundle)
  const maSpreadPct = getSpreadPct(previousBundle ?? maBundle)
  const avgPreviousBody = Math.max(averageBody(previousBodies), EPSILON)

  return (
    isBullish(last) &&
    bodySize(last) >= avgPreviousBody * 1.5 &&
    last.open <= minMa &&
    last.close >= maxMa &&
    maSpreadPct <= 1.2
  )
}

function detectGuillotine(candles: RawCandle[]) {
  const last = candles[candles.length - 1]
  const previousBodies = candles.slice(-6, -1)
  const maBundle = getMaBundle(candles)
  const previousBundle = getMaBundle(candles, 1)

  if (!maBundle || previousBodies.length < 5) {
    return false
  }

  const minMa = Math.min(...maBundle)
  const maxMa = Math.max(...maBundle)
  const maSpreadPct = getSpreadPct(previousBundle ?? maBundle)
  const avgPreviousBody = Math.max(averageBody(previousBodies), EPSILON)

  return (
    isBearish(last) &&
    bodySize(last) >= avgPreviousBody * 1.5 &&
    last.open >= maxMa &&
    last.close <= minMa &&
    maSpreadPct <= 1.2
  )
}

export function detectPatterns(candles: RawCandle[]): PatternMatch[] {
  if (candles.length < 3) {
    return []
  }

  const last = candles[candles.length - 1]
  const previous = candles[candles.length - 2]
  const longUpperShadow = detectLongUpperShadow(last)
  const longLowerShadow = detectLongLowerShadow(last)
  const bullishEngulfing = detectBullishEngulfing(previous, last)
  const bearishEngulfing = detectBearishEngulfing(previous, last)
  const wBottom = detectWBottom(candles)
  const roundedBottom = detectRoundedBottom(candles)
  const bullFlagBreakout = detectBullFlagBreakout(candles)
  const lotusBreakout = detectLotusBreakout(candles)
  const guillotine = detectGuillotine(candles)
  const doubleNeedleBottom = detectDoubleNeedleBottom(candles)
  const threeIncense = detectThreeIncense(candles)

  return [
    createPatternMatch('long_upper_shadow', '长上影线', longUpperShadow, 0.72),
    createPatternMatch('long_lower_shadow', '长下影线', longLowerShadow, 0.72),
    createPatternMatch('bullish_engulfing', '阳线反包', bullishEngulfing, 0.8),
    createPatternMatch('bearish_engulfing', '阴线反包', bearishEngulfing, 0.8),
    createPatternMatch('double_bottom', 'W底', wBottom, 0.78),
    createPatternMatch('rounded_bottom', '圆弧底', roundedBottom, 0.74),
    createPatternMatch('bull_flag_breakout', '旗形突破', bullFlagBreakout, 0.76),
    createPatternMatch('lotus_breakout', '出水芙蓉', lotusBreakout, 0.73),
    createPatternMatch('guillotine', '断头铡', guillotine, 0.73),
    createPatternMatch('double_needle_bottom', '双针探底', doubleNeedleBottom, 0.76),
    createPatternMatch('three_incense', '三炷香', threeIncense, 0.68),
  ]
}
