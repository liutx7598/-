import Bottleneck from 'bottleneck'

import { getLlmEnvConfig } from './env'
import type {
  AiOverviewSignalRef,
  ChartCandle,
  ScreenerResult,
} from '../shared/types'

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{
            type?: string
            text?: string
          }>
    }
  }>
}

export interface OverviewAnalysisInput {
  totalMatches: number
  newMatches: number
  removedMatches: number
  refreshIntervalMinutes: number
  leadingTimeframeLabel: string | null
  timeframeStats: Array<{ label: string; count: number }>
  sampleSignals: AiOverviewSignalRef[]
  newSignalSamples: string[]
  removedSignalSamples: string[]
}

const limiter = new Bottleneck({
  maxConcurrent: 2,
  minTime: 250,
})

function getChatCompletionsUrl(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')

  if (normalizedBaseUrl.endsWith('/chat/completions')) {
    return normalizedBaseUrl
  }

  return `${normalizedBaseUrl}/chat/completions`
}

function round(value: number | null | undefined, digits = 4) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null
  }

  return Number(value.toFixed(digits))
}

function formatChartContext(chart: ChartCandle[]) {
  return chart
    .filter((candle) => candle.isClosed)
    .slice(-6)
    .map((candle) => ({
      close: round(candle.close, 6),
      ma5: round(candle.fastMa, 6),
      ma20: round(candle.slowMa, 6),
    }))
}

function extractTextContent(payload: ChatCompletionResponse) {
  const content = payload.choices?.[0]?.message?.content

  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => item.text ?? '')
      .join(' ')
      .trim()
  }

  return ''
}

function sanitizeSummary(content: string, maxLength: number) {
  return content
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”‘’\-•:：]+/, '')
    .replace(/^摘要[:：]\s*/i, '')
    .replace(/^[0-9一二三四五六七八九十]+[.、]\s*/u, '')
    .trim()
    .slice(0, maxLength)
}

function formatPriceChanges(match: ScreenerResult) {
  const changes = match.priceChanges ?? {}

  return {
    '1m': round(changes['1m'], 2),
    '5m': round(changes['5m'], 2),
    '1h': round(changes['1h'], 2),
    '4h': round(changes['4h'], 2),
    today: round(changes.today, 2),
  }
}

function formatPatternLabels(match: ScreenerResult) {
  return (match.patternMatches ?? [])
    .filter((item) => item.matched)
    .slice(0, 4)
    .map((item) => item.label)
}

function formatIndicatorContext(match: ScreenerResult) {
  const indicators = match.indicators

  if (!indicators) {
    return null
  }

  return {
    macd: {
      dif: round(indicators.macd.dif, 4),
      dea: round(indicators.macd.dea, 4),
      histogram: round(indicators.macd.histogram, 4),
    },
    rsi14: round(indicators.rsi.rsi14, 2),
    kdj: {
      k: round(indicators.kdj.k, 2),
      d: round(indicators.kdj.d, 2),
      j: round(indicators.kdj.j, 2),
    },
    boll: {
      upper: round(indicators.boll.upper, 6),
      middle: round(indicators.boll.middle, 6),
      lower: round(indicators.boll.lower, 6),
    },
    volume: {
      current: round(indicators.volume.current, 2),
      average5: round(indicators.volume.average5, 2),
      average20: round(indicators.volume.average20, 2),
    },
  }
}

async function requestLlmSummary(
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  maxTokens: number,
  maxLength: number,
) {
  const config = getLlmEnvConfig()

  if (!config.enabled) {
    return null
  }

  return limiter.schedule(async () => {
    const response = await fetch(getChatCompletionsUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        max_tokens: maxTokens,
        stream: false,
        messages,
      }),
    })

    if (!response.ok) {
      throw new Error(`Qwen request failed with status ${response.status}`)
    }

    const payload = (await response.json()) as ChatCompletionResponse
    const summary = sanitizeSummary(extractTextContent(payload), maxLength)

    if (!summary) {
      throw new Error('Qwen returned an empty summary.')
    }

    return summary
  })
}

export function isLlmAnalysisEnabled() {
  return getLlmEnvConfig().enabled
}

export async function analyzeMatchWithLlm(match: ScreenerResult) {
  return requestLlmSummary(
    [
      {
        role: 'system',
        content:
          '你是虚拟货币永续合约筛选结果解释助手。只能依据给定数据做保守说明，不补充外部消息，不给买卖建议，不承诺收益。请严格输出两句中文：第一句说明这条信号为什么会被筛出来，第二句指出还需要确认的风险或后续观察点。总长度不超过90个汉字，不要使用项目符号或编号。',
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            instrument: match.instId,
            timeframe: match.timeframeLabel,
            latestPrice: round(match.lastPrice, 6),
            ma5: round(match.fastMa, 6),
            ma20: round(match.slowMa, 6),
            convergencePct: round(match.convergencePct, 4),
            fastMaSlopePct: round(match.fastMaSlopePct, 4),
            crossSlopePct: round(match.crossSlopePct, 4),
            priceVsFastMaPct: round(match.priceVsFastMaPct, 4),
            maTrendDirection: match.maTrendDirection,
            crossedAt: match.crossedAt,
            trendFlags: match.trendFlags,
            matchedPatterns: formatPatternLabels(match),
            priceChanges: formatPriceChanges(match),
            indicators: formatIndicatorContext(match),
            recentClosedCandles: formatChartContext(match.chart),
          },
          null,
          0,
        ),
      },
    ],
    120,
    100,
  )
}

export function createRuleBasedOverview(input: OverviewAnalysisInput) {
  const leadingPart = input.leadingTimeframeLabel
    ? `信号以${input.leadingTimeframeLabel}为主`
    : '当前没有明显主导周期'
  const samplePart =
    input.sampleSignals.length > 0
      ? `代表标的：${input.sampleSignals
          .slice(0, 3)
          .map((item) => `${item.instId} ${item.timeframeLabel}`)
          .join('、')}`
      : '当前暂无代表标的'

  return sanitizeSummary(
    `本轮命中 ${input.totalMatches} 条，新增 ${input.newMatches} 条，移除 ${input.removedMatches} 条；${leadingPart}。${samplePart}。`,
    140,
  )
}

export async function analyzeOverviewWithLlm(input: OverviewAnalysisInput) {
  return requestLlmSummary(
    [
      {
        role: 'system',
        content:
          '你是虚拟货币永续合约筛选系统的15分钟总览助手。只能基于给定统计数据输出简洁中文，不给交易建议，不承诺收益。请输出一段不超过140个汉字的中文，优先说明命中数量变化、主导周期、代表标的以及下一轮值得继续盯盘的方向，不要使用项目符号或编号。',
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            totalMatches: input.totalMatches,
            newMatches: input.newMatches,
            removedMatches: input.removedMatches,
            refreshIntervalMinutes: input.refreshIntervalMinutes,
            leadingTimeframeLabel: input.leadingTimeframeLabel,
            timeframeStats: input.timeframeStats.slice(0, 5),
            sampleSignals: input.sampleSignals.slice(0, 3),
            newSignalSamples: input.newSignalSamples.slice(0, 3),
            removedSignalSamples: input.removedSignalSamples.slice(0, 3),
          },
          null,
          0,
        ),
      },
    ],
    160,
    150,
  )
}
