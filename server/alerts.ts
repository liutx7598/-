import type { AlertRecord, ScreenerConfig, ScreenerResult } from '../shared/types'

export function buildAlertMessage(match: ScreenerResult) {
  const price = match.lastPrice.toFixed(match.lastPrice >= 100 ? 2 : 4)

  return [
    '[Gate形态提醒] 发现新信号',
    '',
    `币种：${match.instId}`,
    `周期：${match.timeframeLabel}`,
    `最新价：${price}`,
    `MA5：${match.fastMa.toFixed(4)}`,
    `MA20：${match.slowMa.toFixed(4)}`,
    `MA距离：${match.convergencePct.toFixed(2)}%`,
    '信号：MA5/MA20收拢 + MA5抬头 + K线上穿MA5',
    `时间：${new Date(match.crossedAt).toLocaleString('zh-CN', { hour12: false })}`,
  ].join('\n')
}

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

export async function sendWebhookAlert(
  config: ScreenerConfig,
  matches: ScreenerResult[],
) {
  if (!config.webhookEnabled || !config.webhookUrl || matches.length === 0) {
    return [] as AlertRecord[]
  }

  const sentAt = new Date().toISOString()
  const records: AlertRecord[] = []

  for (const match of matches) {
    const message = buildAlertMessage(match)

    if (config.webhookType === 'generic') {
      await postJson(config.webhookUrl, {
        text: message,
        match,
        sentAt,
      })
    } else {
      await postJson(config.webhookUrl, {
        msgtype: 'text',
        text: {
          content: message,
        },
      })
    }

    records.push({
      signalKey: match.signalKey,
      instId: match.instId,
      timeframe: match.timeframe,
      timeframeLabel: match.timeframeLabel,
      alertStatus: 'sent',
      webhookType: config.webhookType,
      message,
      sentAt,
    })
  }

  return records
}

export async function sendTestWebhookAlert(config: ScreenerConfig) {
  if (!config.webhookEnabled || !config.webhookUrl) {
    throw new Error('请先开启 Webhook 并填写推送地址。')
  }

  const message = 'Gate 筛选助手测试消息'

  if (config.webhookType === 'generic') {
    await postJson(config.webhookUrl, {
      text: message,
      sentAt: new Date().toISOString(),
      test: true,
    })
  } else {
    await postJson(config.webhookUrl, {
      msgtype: 'text',
      text: {
        content: message,
      },
    })
  }
}
