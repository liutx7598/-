import type {
  AlertRecord,
  ScreenerConfig,
  ScreenerResult,
  WebhookType,
} from '../shared/types'

async function postJson(url: string, payload: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`Webhook request failed with status ${response.status}`)
  }
}

async function sendWebhookMessage(
  webhookUrl: string,
  webhookType: WebhookType,
  message: string,
  extraPayload?: Record<string, unknown>,
) {
  if (webhookType === 'generic') {
    await postJson(webhookUrl, {
      text: message,
      ...extraPayload,
    })
    return
  }

  await postJson(webhookUrl, {
    msgtype: 'text',
    text: {
      content: message,
    },
  })
}

export function buildSignalAlertMessage(match: ScreenerResult) {
  const price = match.lastPrice.toFixed(match.lastPrice >= 100 ? 2 : 4)

  return [
    '[Gate 形态提醒] 发现新信号',
    '',
    `币种：${match.instId}`,
    `周期：${match.timeframeLabel}`,
    `最新价：${price}`,
    `MA5：${match.fastMa.toFixed(4)}`,
    `MA20：${match.slowMa.toFixed(4)}`,
    `MA距离：${match.convergencePct.toFixed(2)}%`,
    '信号：MA5/MA20 收拢 + MA5 抬头 + K 线实体上穿 MA5',
    `时间：${new Date(match.crossedAt).toLocaleString('zh-CN', { hour12: false })}`,
  ].join('\n')
}

export function buildPriceChangeAlertMessage(input: {
  instId: string
  timeframeLabel: string
  windowLabel: string
  directionLabel: string
  thresholdPct: number
  priceChangePct: number
  lastPrice: number
  ruleLabel?: string
  strategyName?: string | null
}) {
  const price = input.lastPrice.toFixed(input.lastPrice >= 100 ? 2 : 4)

  return [
    '[Gate 涨跌幅提醒] 触发价格变化阈值',
    '',
    `币种：${input.instId}`,
    `参考周期：${input.timeframeLabel}`,
    `监控窗口：${input.windowLabel}`,
    `触发条件：${input.directionLabel} ${input.thresholdPct}%`,
    `当前涨跌幅：${input.priceChangePct.toFixed(2)}%`,
    `最新价：${price}`,
    input.ruleLabel ? `规则名称：${input.ruleLabel}` : null,
    input.strategyName ? `来源策略：${input.strategyName}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

export async function sendWebhookAlert(
  config: ScreenerConfig,
  matches: ScreenerResult[],
  options?: {
    strategyPresetId?: string | null
    strategyPresetName?: string | null
  },
) {
  if (!config.webhookEnabled || !config.webhookUrl || matches.length === 0) {
    return [] as AlertRecord[]
  }

  const sentAt = new Date().toISOString()
  const records: AlertRecord[] = []

  for (const match of matches) {
    const message = buildSignalAlertMessage(match)

    await sendWebhookMessage(config.webhookUrl, config.webhookType, message, {
      match,
      sentAt,
    })

    records.push({
      id: `signal:${match.signalKey}:${sentAt}`,
      signalKey: match.signalKey,
      instId: match.instId,
      timeframe: match.timeframe,
      timeframeLabel: match.timeframeLabel,
      alertStatus: 'sent',
      webhookType: config.webhookType,
      message,
      sentAt,
      category: 'signal_match',
      strategyPresetId: options?.strategyPresetId ?? null,
      strategyPresetName: options?.strategyPresetName ?? null,
    })
  }

  return records
}

export async function sendWebhookPriceAlert(
  config: ScreenerConfig,
  payload: {
    signalKey: string
    instId: string
    timeframe: ScreenerResult['timeframe']
    timeframeLabel: string
    windowLabel: string
    directionLabel: string
    thresholdPct: number
    priceChangePct: number
    lastPrice: number
    ruleId: string
    ruleLabel?: string
    strategyPresetId?: string | null
    strategyPresetName?: string | null
  },
) {
  if (!config.webhookEnabled || !config.webhookUrl) {
    return null
  }

  const sentAt = new Date().toISOString()
  const message = buildPriceChangeAlertMessage({
    instId: payload.instId,
    timeframeLabel: payload.timeframeLabel,
    windowLabel: payload.windowLabel,
    directionLabel: payload.directionLabel,
    thresholdPct: payload.thresholdPct,
    priceChangePct: payload.priceChangePct,
    lastPrice: payload.lastPrice,
    ruleLabel: payload.ruleLabel,
    strategyName: payload.strategyPresetName ?? null,
  })

  await sendWebhookMessage(config.webhookUrl, config.webhookType, message, {
    sentAt,
    ruleId: payload.ruleId,
    instId: payload.instId,
  })

  const record: AlertRecord = {
    id: `price:${payload.ruleId}:${payload.signalKey}:${sentAt}`,
    signalKey: payload.signalKey,
    instId: payload.instId,
    timeframe: payload.timeframe,
    timeframeLabel: payload.timeframeLabel,
    alertStatus: 'sent',
    webhookType: config.webhookType,
    message,
    sentAt,
    category: 'price_change',
    strategyPresetId: payload.strategyPresetId ?? null,
    strategyPresetName: payload.strategyPresetName ?? null,
    priceWindowLabel: payload.windowLabel,
    priceChangePct: payload.priceChangePct,
  }

  return record
}

export async function sendTestWebhookAlert(config: ScreenerConfig) {
  if (!config.webhookEnabled || !config.webhookUrl) {
    throw new Error('请先开启 Webhook 并填写推送地址。')
  }

  const message = 'Gate 筛选助手测试消息'

  await sendWebhookMessage(config.webhookUrl, config.webhookType, message, {
    sentAt: new Date().toISOString(),
    test: true,
  })
}
