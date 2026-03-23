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

function formatChartContext(chart: ChartCandle[]) {
  return chart
    .filter((candle) => candle.isClosed)
    .slice(-8)
    .map((candle) => ({
      close: Number(candle.close.toFixed(6)),
      ma5: candle.fastMa === null ? null : Number(candle.fastMa.toFixed(6)),
      ma20: candle.slowMa === null ? null : Number(candle.slowMa.toFixed(6)),
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

function sanitizeSummary(content: string) {
  return content.replace(/\s+/g, ' ').trim().slice(0, 220)
}

async function requestLlmSummary(
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  maxTokens: number,
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
        temperature: 0.2,
        max_tokens: maxTokens,
        stream: false,
        messages,
      }),
    })

    if (!response.ok) {
      throw new Error(`Qwen request failed with status ${response.status}`)
    }

    const payload = (await response.json()) as ChatCompletionResponse
    const summary = sanitizeSummary(extractTextContent(payload))

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
          '你是虚拟货币永续合约形态分析助手。你只能基于提供的数据做保守总结，不要编造外部信息，不要给出买卖建议，不要承诺收益。请直接输出两句中文：第一句写形态结论，第二句写主要风险，总长度不超过90个汉字。',
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            instrument: match.instId,
            timeframe: match.timeframeLabel,
            latestPrice: Number(match.lastPrice.toFixed(6)),
            ma5: Number(match.fastMa.toFixed(6)),
            ma20: Number(match.slowMa.toFixed(6)),
            convergencePct: Number(match.convergencePct.toFixed(4)),
            fastMaSlopePct: Number(match.fastMaSlopePct.toFixed(4)),
            priceVsFastMaPct: Number(match.priceVsFastMaPct.toFixed(4)),
            maTrendDirection: match.maTrendDirection,
            crossedAt: match.crossedAt,
            signalFlags: match.trendFlags,
            recentClosedCandles: formatChartContext(match.chart),
          },
          null,
          0,
        ),
      },
    ],
    160,
  )
}

export function createRuleBasedOverview(input: OverviewAnalysisInput) {
  const totalPart = `本轮共命中 ${input.totalMatches} 条`
  const changePart = `较上一轮新增 ${input.newMatches} 条、消失 ${input.removedMatches} 条`
  const timeframePart = input.leadingTimeframeLabel
    ? `信号主要集中在 ${input.leadingTimeframeLabel}`
    : '当前还没有明显的主导周期'
  const samplePart =
    input.sampleSignals.length > 0
      ? `代表标的：${input.sampleSignals
          .slice(0, 3)
          .map((item) => `${item.instId} ${item.timeframeLabel}`)
          .join('、')}`
      : '当前暂无代表标的'

  return `${totalPart}，${changePart}。${timeframePart}。${samplePart}。`
}

export async function analyzeOverviewWithLlm(input: OverviewAnalysisInput) {
  return requestLlmSummary(
    [
      {
        role: 'system',
        content:
          '你是虚拟货币永续合约筛选系统的15分钟总览助手。你只能基于给定统计数据输出简洁中文总结，不要给交易建议，不要承诺收益。请输出一段不超过140个汉字的中文，总结当前信号分布、相对上一轮变化和需要关注的方向。',
      },
      {
        role: 'user',
        content: JSON.stringify(input),
      },
    ],
    220,
  )
}
